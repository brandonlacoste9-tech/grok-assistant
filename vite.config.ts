import { defineConfig, loadEnv, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

/** Local /api/* so `npm run dev` works without Netlify CLI */
function grokDevApi(env: Record<string, string>): Plugin {
  const apiKey = () => env.XAI_API_KEY || env.GROK_API_KEY || "";

  const chat: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/chat")) return next();
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

    try {
      const body = (await readJsonBody(req)) as {
        messages?: Array<{ role: string; content: unknown }>;
        system?: string;
        temperature?: number;
        max_tokens?: number;
        stream?: boolean;
        tools?: boolean;
      };
      const key = apiKey();
      const model = env.XAI_MODEL || env.GROK_MODEL || "grok-4.3";
      if (!key) {
        return sendJson(res, 503, {
          error: "Missing XAI_API_KEY. Copy .env.example → .env and add your xAI key.",
        });
      }

      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (messages.length === 0) {
        return sendJson(res, 400, { error: "messages array is required" });
      }
      const system =
        typeof body.system === "string" && body.system.trim()
          ? body.system.trim()
          : "You are Grok Assistant — a sharp, helpful companion powered by xAI Grok. Be clear, warm, and practical. Use short paragraphs. Prefer actionable answers. When the user shares images, describe and reason about what you see accurately.";
      const stream = body.stream === true;
      const tools = body.tools === true;
      const temperature = typeof body.temperature === "number" ? body.temperature : 0.7;
      const max_tokens = typeof body.max_tokens === "number" ? body.max_tokens : 2048;

      // Proxy to the Netlify-style handler logic inline
      if (tools) {
        const input = messages.map((m) => {
          if (typeof m.content === "string") return { role: m.role, content: m.content };
          if (!Array.isArray(m.content)) return { role: m.role, content: String(m.content ?? "") };
          const parts = (m.content as Array<Record<string, unknown>>).map((part) => {
            if (part.type === "text") return { type: "input_text", text: part.text };
            if (part.type === "image_url" && (part.image_url as { url?: string })?.url) {
              return {
                type: "input_image",
                image_url: (part.image_url as { url: string }).url,
              };
            }
            return null;
          }).filter(Boolean);
          return { role: m.role, content: parts.length ? parts : "" };
        });

        const xaiRes = await fetch("https://api.x.ai/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature,
            max_output_tokens: max_tokens,
            stream,
            instructions: system,
            input,
            tools: [{ type: "web_search" }, { type: "x_search" }],
          }),
        });

        if (!stream) {
          const data = await xaiRes.json();
          if (!xaiRes.ok) {
            return sendJson(res, xaiRes.status, {
              error: data?.error || data?.message || `xAI error ${xaiRes.status}`,
            });
          }
          let content = typeof data?.output_text === "string" ? data.output_text : "";
          if (!content && Array.isArray(data?.output)) {
            for (const item of data.output) {
              if (item?.type === "message" && Array.isArray(item.content)) {
                for (const c of item.content) {
                  if ((c.type === "output_text" || c.type === "text") && c.text) {
                    content += c.text;
                  }
                }
              }
            }
          }
          return sendJson(res, 200, {
            content: content || "(No response)",
            model: data?.model ?? model,
          });
        }

        if (!xaiRes.ok) {
          const data = await xaiRes.json().catch(() => ({}));
          return sendJson(res, xaiRes.status, {
            error: data?.error || data?.message || `xAI error ${xaiRes.status}`,
          });
        }

        // Transform responses stream → chat.completion.chunk
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        if (!xaiRes.body) {
          res.end();
          return;
        }
        const reader = xaiRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const raw of lines) {
              const line = raw.trim();
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              try {
                const event = JSON.parse(data);
                let deltaText: string | null = null;
                if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
                  deltaText = event.delta;
                } else if (event.type === "response.content_part.delta" && typeof event.delta === "string") {
                  deltaText = event.delta;
                }
                if (deltaText) {
                  res.write(
                    `data: ${JSON.stringify({
                      object: "chat.completion.chunk",
                      model: event.model || model,
                      choices: [{ index: 0, delta: { content: deltaText } }],
                    })}\n\n`
                  );
                }
              } catch {
                /* skip */
              }
            }
          }
          res.write("data: [DONE]\n\n");
        } finally {
          res.end();
        }
        return;
      }

      const xaiRes = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens,
          stream,
          messages: [{ role: "system", content: system }, ...messages],
        }),
      });

      if (stream) {
        if (!xaiRes.ok) {
          const data = await xaiRes.json().catch(() => ({}));
          return sendJson(res, xaiRes.status, {
            error: data?.error || data?.message || `xAI error ${xaiRes.status}`,
          });
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        if (!xaiRes.body) {
          res.end();
          return;
        }
        const reader = xaiRes.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
        } finally {
          res.end();
        }
        return;
      }

      const data = await xaiRes.json();
      if (!xaiRes.ok) {
        return sendJson(res, xaiRes.status, {
          error: data?.error || data?.message || `xAI error ${xaiRes.status}`,
        });
      }

      return sendJson(res, 200, {
        content: data?.choices?.[0]?.message?.content ?? "(No response content from Grok.)",
        model: data?.model ?? model,
        usage: data?.usage ?? null,
      });
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : "Server error",
      });
    }
  };

  const imagine: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/imagine")) return next();
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    try {
      const body = (await readJsonBody(req)) as { prompt?: string; n?: number };
      const key = apiKey();
      if (!key) return sendJson(res, 503, { error: "Missing XAI_API_KEY" });
      const prompt = (body.prompt || "").trim();
      if (!prompt) {
        return sendJson(res, 400, {
          error: "prompt is required — type a description, then tap ✨ Imagine",
        });
      }
      const models = [
        env.XAI_IMAGE_MODEL || "grok-imagine-image-quality",
        "grok-imagine-image",
        "grok-2-image",
      ];
      let lastError = "Imagine failed";
      for (const model of [...new Set(models)]) {
        const xaiRes = await fetch("https://api.x.ai/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            prompt,
            n: typeof body.n === "number" ? Math.min(4, Math.max(1, body.n)) : 1,
          }),
        });
        const data = await xaiRes.json().catch(() => ({}));
        if (!xaiRes.ok) {
          lastError =
            data?.error?.message || data?.error || data?.message || `Imagine ${xaiRes.status}`;
          if (xaiRes.status === 404 || /model|not found/i.test(String(lastError))) continue;
          return sendJson(res, xaiRes.status, { error: lastError });
        }
        const images = (data?.data || [])
          .map((item: { url?: string; b64_json?: string }) => ({
            url: item.url || (item.b64_json ? `data:image/jpeg;base64,${item.b64_json}` : null),
          }))
          .filter((i: { url: string | null }) => i.url);
        if (!images.length) {
          lastError = "No images returned";
          continue;
        }
        // Inline first image for reliable display
        try {
          if (images[0].url.startsWith("http")) {
            const imgRes = await fetch(images[0].url);
            if (imgRes.ok) {
              const buf = Buffer.from(await imgRes.arrayBuffer());
              if (buf.length < 2_500_000) {
                const mime = imgRes.headers.get("content-type") || "image/jpeg";
                images[0].url = `data:${mime};base64,${buf.toString("base64")}`;
              }
            }
          }
        } catch {
          /* keep remote */
        }
        return sendJson(res, 200, { images, model: data?.model || model });
      }
      return sendJson(res, 502, { error: lastError });
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : "Imagine error",
      });
    }
  };

  const tts: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/tts")) return next();
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

    try {
      const body = (await readJsonBody(req)) as {
        text?: string;
        voice_id?: string;
        language?: string;
      };
      const key = apiKey();
      if (!key) return sendJson(res, 503, { error: "Missing XAI_API_KEY" });

      const text = (body.text || "").trim();
      if (!text) return sendJson(res, 400, { error: "text is required" });

      const xaiRes = await fetch("https://api.x.ai/v1/tts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text.slice(0, 5000),
          voice_id: body.voice_id || "eve",
          language: body.language || "en",
        }),
      });

      if (!xaiRes.ok) {
        const errText = await xaiRes.text();
        return sendJson(res, xaiRes.status, { error: errText.slice(0, 300) });
      }

      const buf = Buffer.from(await xaiRes.arrayBuffer());
      res.statusCode = 200;
      res.setHeader("Content-Type", "audio/mpeg");
      res.end(buf);
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : "TTS error",
      });
    }
  };

  const realtimeSession: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/realtime-session")) return next();
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST" && req.method !== "GET") {
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    try {
      let body: {
        voice?: string;
        instructions?: string;
        expires_seconds?: number;
      } = {};
      if (req.method === "POST") {
        body = (await readJsonBody(req)) as typeof body;
      }
      const key = apiKey();
      if (!key) return sendJson(res, 503, { error: "Missing XAI_API_KEY" });

      const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_after: {
            seconds: Math.min(600, Math.max(60, body.expires_seconds || 300)),
          },
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return sendJson(res, r.status, {
          error: data?.error || data?.message || `Token ${r.status}`,
        });
      }
      const value = data?.value || data?.client_secret?.value;
      const expires_at = data?.expires_at || data?.client_secret?.expires_at;
      return sendJson(res, 200, {
        value,
        expires_at,
        client_secret: { value, expires_at },
        voice: body.voice || "eve",
        instructions:
          body.instructions ||
          "You are Grok Assistant, a warm voice companion powered by xAI Grok. Keep answers spoken-friendly and concise.",
        model: env.XAI_VOICE_MODEL || "grok-voice-latest",
      });
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : "Session error",
      });
    }
  };

  const stt: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith("/api/stt")) return next();
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

    try {
      const body = (await readJsonBody(req)) as {
        audio_base64?: string;
        mime_type?: string;
      };
      const key = apiKey();
      if (!key) return sendJson(res, 503, { error: "Missing XAI_API_KEY" });
      if (!body.audio_base64) return sendJson(res, 400, { error: "audio_base64 required" });

      const mime = body.mime_type || "audio/webm";
      const bytes = Buffer.from(body.audio_base64, "base64");
      const blob = new Blob([bytes], { type: mime });
      const form = new FormData();
      const ext = mime.includes("wav") ? "wav" : mime.includes("mp3") ? "mp3" : "webm";
      form.append("file", blob, `recording.${ext}`);

      const xaiRes = await fetch("https://api.x.ai/v1/stt", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });

      const data = await xaiRes.json().catch(() => ({}));
      if (!xaiRes.ok) {
        return sendJson(res, xaiRes.status, {
          error: data?.error || data?.message || `STT ${xaiRes.status}`,
        });
      }

      return sendJson(res, 200, {
        text: data?.text ?? data?.transcript ?? "",
      });
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : "STT error",
      });
    }
  };

  return {
    name: "grok-dev-api",
    configureServer(server) {
      // Order: specific routes first
      server.middlewares.use(realtimeSession);
      server.middlewares.use(imagine);
      server.middlewares.use(tts);
      server.middlewares.use(stt);
      server.middlewares.use(chat);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), grokDevApi(env)],
    server: {
      port: 5173,
    },
  };
});
