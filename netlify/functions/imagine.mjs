/**
 * Grok Imagine — image generation proxy (classic Netlify handler).
 * POST { prompt, n?, aspect_ratio? }
 * → { images: [{ url }], model }
 *
 * Env: XAI_API_KEY, XAI_IMAGE_MODEL (optional)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_MODELS = [
  "grok-imagine-image-quality",
  "grok-imagine-image",
  "grok-2-image",
];

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (!apiKey) {
    return json(503, {
      error:
        "Missing XAI_API_KEY. Set it in Netlify → Site settings → Environment variables.",
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return json(400, {
      error: "prompt is required — type a description, then tap ✨ Imagine",
    });
  }
  if (prompt.length > 4000) {
    return json(400, { error: "prompt too long (max 4000 chars)" });
  }

  const preferred =
    process.env.XAI_IMAGE_MODEL ||
    (typeof body.model === "string" && body.model) ||
    DEFAULT_MODELS[0];

  const models = [preferred, ...DEFAULT_MODELS.filter((m) => m !== preferred)];

  const n =
    typeof body.n === "number" && Number.isFinite(body.n)
      ? Math.min(4, Math.max(1, Math.floor(body.n)))
      : 1;

  let lastError = "Imagine API failed";

  for (const model of models) {
    try {
      const payload = {
        model,
        prompt,
        n,
      };
      if (typeof body.aspect_ratio === "string" && body.aspect_ratio) {
        payload.aspect_ratio = body.aspect_ratio;
      }

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
        lastError =
          (typeof data?.error === "string" && data.error) ||
          data?.error?.message ||
          data?.message ||
          `Imagine API error ${xaiRes.status} (${model})`;
        // try next model on model-not-found style errors
        if (xaiRes.status === 404 || /model|not found|invalid/i.test(lastError)) {
          continue;
        }
        return json(
          xaiRes.status >= 400 && xaiRes.status < 600 ? xaiRes.status : 502,
          { error: lastError }
        );
      }

      const images = [];
      for (const item of data?.data || []) {
        if (item?.url) {
          images.push({
            url: item.url,
            revised_prompt: item.revised_prompt,
          });
        } else if (item?.b64_json) {
          images.push({
            url: `data:image/jpeg;base64,${item.b64_json}`,
            revised_prompt: item.revised_prompt,
          });
        }
      }

      if (!images.length) {
        lastError = `No images in response from ${model}`;
        continue;
      }

      // Optionally inline the first image so the UI always has a stable src
      // (imgen URLs can be short-lived or blocked by strict privacy modes).
      let stable = images;
      try {
        if (images[0].url.startsWith("http") && body.inline !== false) {
          const imgRes = await fetch(images[0].url);
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            // Cap ~2.5MB base64 payload
            if (buf.length < 2_500_000) {
              const mime = imgRes.headers.get("content-type") || "image/jpeg";
              const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
              stable = [{ ...images[0], url: dataUrl, remote_url: images[0].url }, ...images.slice(1)];
            }
          }
        }
      } catch {
        // keep remote URLs
      }

      return json(200, {
        images: stable,
        model: data?.model || model,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Imagine request failed";
    }
  }

  return json(502, { error: lastError });
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...CORS,
    },
    body: JSON.stringify(payload),
  };
}
