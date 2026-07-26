/**
 * Grok Text-to-Speech proxy
 * POST { text, voice_id?, language? } → audio/mpeg
 */
const VOICES = new Set([
  "eve",
  "ara",
  "rex",
  "sal",
  "leo",
]);

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey) {
    return json(503, { error: "Missing XAI_API_KEY on the server." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json(400, { error: "text is required" });
  if (text.length > 5000) return json(400, { error: "text too long (max 5000 chars)" });

  let voice_id = typeof body.voice_id === "string" ? body.voice_id.trim() : "eve";
  if (!VOICES.has(voice_id)) voice_id = "eve";
  const language = typeof body.language === "string" ? body.language : "en";

  try {
    const xaiRes = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, voice_id, language }),
    });

    if (!xaiRes.ok) {
      const errText = await xaiRes.text();
      return json(xaiRes.status, {
        error: errText.slice(0, 300) || `TTS failed (${xaiRes.status})`,
      });
    }

    const buf = Buffer.from(await xaiRes.arrayBuffer());
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        ...cors(),
      },
      body: buf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "TTS upstream error",
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
    headers: { "Content-Type": "application/json", ...cors() },
    body: JSON.stringify(payload),
  };
}
