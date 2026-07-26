/**
 * Mint a short-lived xAI realtime client secret for browser WebSocket auth.
 * Never expose XAI_API_KEY to the client.
 *
 * POST /api/realtime-session
 * Body (optional): { voice?, instructions?, expires_seconds? }
 * Returns: { value, expires_at, voice, instructions, model }
 */
const DEFAULT_INSTRUCTIONS =
  "You are Grok Assistant, a warm, sharp voice companion powered by xAI Grok. Keep spoken answers clear and conversational. Prefer short paragraphs. Don't invent personal facts about the user.";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey) {
    return json(503, {
      error:
        "Missing XAI_API_KEY. Set it in Netlify environment variables and redeploy.",
    });
  }

  let body = {};
  if (event.httpMethod === "POST" && event.body) {
    try {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf8")
        : event.body;
      body = JSON.parse(raw || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }
  }

  const expiresSeconds = Math.min(
    600,
    Math.max(60, Number(body.expires_seconds) || 300)
  );
  const voice =
    typeof body.voice === "string" && body.voice.trim()
      ? body.voice.trim()
      : "eve";
  const instructions =
    typeof body.instructions === "string" && body.instructions.trim()
      ? body.instructions.trim()
      : DEFAULT_INSTRUCTIONS;
  const model =
    process.env.XAI_VOICE_MODEL ||
    process.env.GROK_VOICE_MODEL ||
    "grok-voice-latest";

  try {
    const r = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { seconds: expiresSeconds },
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json(r.status, {
        error:
          data?.error?.message ||
          data?.error ||
          data?.message ||
          `Failed to mint realtime token (${r.status})`,
      });
    }

    // xAI returns { value, expires_at } — also accept nested client_secret
    const value = data?.value || data?.client_secret?.value;
    const expires_at = data?.expires_at || data?.client_secret?.expires_at;

    if (!value) {
      return json(502, {
        error: "Unexpected token response from xAI",
        raw: data,
      });
    }

    return json(200, {
      value,
      expires_at,
      client_secret: { value, expires_at },
      voice,
      instructions,
      model,
    });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "Token mint failed",
    });
  }
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...cors() },
    body: JSON.stringify(payload),
  };
}
