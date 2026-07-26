/**
 * Grok Speech-to-Text proxy
 * POST multipart: file=@audio.webm|wav|mp3 → { text }
 * Or POST application/json { audio_base64, mime_type }
 */
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

  try {
    let formData;

    const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";

    if (contentType.includes("application/json")) {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body || "", "base64").toString("utf8")
        : event.body || "{}";
      const body = JSON.parse(raw);
      const b64 = body.audio_base64;
      const mime = body.mime_type || "audio/webm";
      if (!b64 || typeof b64 !== "string") {
        return json(400, { error: "audio_base64 is required" });
      }
      const bytes = Buffer.from(b64, "base64");
      const blob = new Blob([bytes], { type: mime });
      formData = new FormData();
      const ext = mime.includes("wav")
        ? "wav"
        : mime.includes("mp3") || mime.includes("mpeg")
          ? "mp3"
          : "webm";
      formData.append("file", blob, `recording.${ext}`);
    } else if (contentType.includes("multipart/form-data")) {
      // Netlify may not parse multipart natively the same way — prefer JSON path from client
      return json(400, {
        error: "Send JSON { audio_base64, mime_type } for STT",
      });
    } else {
      return json(400, { error: "Use application/json with audio_base64" });
    }

    const xaiRes = await fetch("https://api.x.ai/v1/stt", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    const data = await xaiRes.json().catch(() => ({}));
    if (!xaiRes.ok) {
      return json(xaiRes.status, {
        error:
          (typeof data?.error === "string" && data.error) ||
          data?.error?.message ||
          data?.message ||
          `STT failed (${xaiRes.status})`,
      });
    }

    const text = data?.text ?? data?.transcript ?? "";
    return json(200, { text, raw: data });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "STT upstream error",
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
