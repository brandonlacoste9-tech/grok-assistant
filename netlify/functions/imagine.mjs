/**
 * Netlify Function: Grok Imagine image generation.
 * POST { prompt, n?, aspect_ratio? } → { images: [{ url }], model }
 * Env: XAI_API_KEY, XAI_IMAGE_MODEL (optional)
 */

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
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey) {
    return json(503, { error: "Missing XAI_API_KEY" });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return json(400, { error: "prompt is required" });
  if (prompt.length > 4000) {
    return json(400, { error: "prompt too long (max 4000 chars)" });
  }

  const model =
    process.env.XAI_IMAGE_MODEL ||
    body.model ||
    "grok-imagine-image-quality";

  const n =
    typeof body.n === "number" && Number.isFinite(body.n)
      ? Math.min(4, Math.max(1, Math.floor(body.n)))
      : 1;

  const payload = {
    model,
    prompt,
    n,
  };
  if (typeof body.aspect_ratio === "string" && body.aspect_ratio) {
    payload.aspect_ratio = body.aspect_ratio;
  }

  try {
    const xaiRes = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await xaiRes.json().catch(() => ({}));
    if (!xaiRes.ok) {
      const msg =
        (typeof data?.error === "string" && data.error) ||
        data?.error?.message ||
        data?.message ||
        `Imagine API error ${xaiRes.status}`;
      return json(xaiRes.status >= 400 && xaiRes.status < 600 ? xaiRes.status : 502, {
        error: msg,
      });
    }

    const images = (data?.data || [])
      .map((item) => ({
        url: item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : null),
        revised_prompt: item.revised_prompt,
      }))
      .filter((i) => i.url);

    if (!images.length) {
      return json(502, { error: "No images returned from Grok Imagine" });
    }

    return json(200, { images, model: data?.model || model });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "Imagine request failed",
    });
  }
};

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
