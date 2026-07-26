/**
 * Netlify Function: proxy chat to xAI Grok (keeps API key off the client).
 * Env: XAI_API_KEY (required), XAI_MODEL (optional, default grok-4.3)
 */
const DEFAULT_SYSTEM =
  "You are Grok Assistant — a sharp, helpful companion powered by xAI Grok. Be clear, warm, and practical. Use short paragraphs. Prefer actionable answers. Don't invent personal facts about the user.";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  const model = process.env.XAI_MODEL || process.env.GROK_MODEL || "grok-4.3";

  if (!apiKey) {
    return json(503, {
      error:
        "Missing XAI_API_KEY. Set it in Netlify → Site settings → Environment variables, then redeploy.",
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return json(400, { error: "messages array is required" });
  }

  // Basic shape validation
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return json(400, {
        error: 'Each message needs role "user"|"assistant" and string content',
      });
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
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });

    const data = await xaiRes.json().catch(() => ({}));

    if (!xaiRes.ok) {
      const msg =
        (typeof data?.error === "string" && data.error) ||
        data?.error?.message ||
        data?.message ||
        `xAI API error ${xaiRes.status}`;
      return json(xaiRes.status >= 400 && xaiRes.status < 600 ? xaiRes.status : 502, {
        error: msg,
      });
    }

    const content =
      data?.choices?.[0]?.message?.content ?? "(No response content from Grok.)";

    return json(200, {
      content,
      model: data?.model ?? model,
      usage: data?.usage ?? null,
    });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "Upstream request failed",
    });
  }
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...cors(),
    },
    body: JSON.stringify(payload),
  };
}
