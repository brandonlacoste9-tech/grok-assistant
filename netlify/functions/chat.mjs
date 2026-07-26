/**
 * Netlify Function (web Request/Response): proxy chat to xAI Grok.
 * - JSON when body.stream is false/omitted
 * - SSE passthrough when body.stream === true (true token streaming)
 *
 * Env: XAI_API_KEY (required), XAI_MODEL (optional, default grok-4.3)
 */

const DEFAULT_SYSTEM =
  "You are Grok Assistant — a sharp, helpful companion powered by xAI Grok. Be clear, warm, and practical. Use short paragraphs. Prefer actionable answers. Don't invent personal facts about the user.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  const model = process.env.XAI_MODEL || process.env.GROK_MODEL || "grok-4.3";

  if (!apiKey) {
    return jsonResponse(503, {
      error:
        "Missing XAI_API_KEY. Set it in Netlify → Site settings → Environment variables, then redeploy.",
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const parsed = parseChatBody(body);
  if (parsed.error) return jsonResponse(400, { error: parsed.error });

  const { messages, system, temperature, max_tokens, stream } = parsed;

  try {
    const xaiRes = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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
        const msg =
          (typeof data?.error === "string" && data.error) ||
          data?.error?.message ||
          data?.message ||
          `xAI API error ${xaiRes.status}`;
        return jsonResponse(
          xaiRes.status >= 400 && xaiRes.status < 600 ? xaiRes.status : 502,
          { error: msg }
        );
      }

      // Pipe xAI SSE straight to the client
      return new Response(xaiRes.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...CORS,
        },
      });
    }

    const data = await xaiRes.json().catch(() => ({}));

    if (!xaiRes.ok) {
      const msg =
        (typeof data?.error === "string" && data.error) ||
        data?.error?.message ||
        data?.message ||
        `xAI API error ${xaiRes.status}`;
      return jsonResponse(
        xaiRes.status >= 400 && xaiRes.status < 600 ? xaiRes.status : 502,
        { error: msg }
      );
    }

    const content =
      data?.choices?.[0]?.message?.content ?? "(No response content from Grok.)";

    return jsonResponse(200, {
      content,
      model: data?.model ?? model,
      usage: data?.usage ?? null,
    });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : "Upstream request failed",
    });
  }
};

function parseChatBody(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) {
    return { error: "messages array is required" };
  }

  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return {
        error: 'Each message needs role "user"|"assistant" and string content',
      };
    }
  }

  const system =
    typeof body.system === "string" && body.system.trim()
      ? body.system.trim()
      : DEFAULT_SYSTEM;

  const temperature =
    typeof body.temperature === "number" && Number.isFinite(body.temperature)
      ? Math.min(2, Math.max(0, body.temperature))
      : 0.7;

  const max_tokens =
    typeof body.max_tokens === "number" && Number.isFinite(body.max_tokens)
      ? Math.min(8192, Math.max(16, Math.floor(body.max_tokens)))
      : 2048;

  const stream = body.stream === true;

  return { messages, system, temperature, max_tokens, stream };
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS,
    },
  });
}
