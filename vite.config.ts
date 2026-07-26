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
        messages?: Array<{ role: string; content: string }>;
        system?: string;
        temperature?: number;
        max_tokens?: number;
      };
      const key = apiKey();
      const model = env.XAI_MODEL || env.GROK_MODEL || "grok-4.3";
      if (!key) {
        return sendJson(res, 503, {
          error: "Missing XAI_API_KEY. Copy .env.example → .env and add your xAI key.",
        });
      }

      const messages = Array.isArray(body.messages) ? body.messages : [];
      const system =
        typeof body.system === "string" && body.system.trim()
          ? body.system.trim()
          : "You are Grok Assistant — a sharp, helpful companion powered by xAI Grok. Be clear, warm, and practical. Use short paragraphs. Prefer actionable answers.";

      const xaiRes = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
          max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : 2048,
          messages: [{ role: "system", content: system }, ...messages],
        }),
      });

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
