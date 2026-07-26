/**
 * Netlify Function: proxy chat to xAI Grok.
 *
 * Modes:
 * - tools off → /v1/chat/completions (streaming SSE, vision image_url)
 * - tools on  → /v1/responses with built-in web_search + x_search
 *
 * Env: XAI_API_KEY, XAI_MODEL
 */

const DEFAULT_SYSTEM =
  "You are Grok Assistant — a sharp, helpful companion powered by xAI Grok. Be clear, warm, and practical. Use short paragraphs. Prefer actionable answers. Don't invent personal facts about the user. When the user shares images, describe and reason about what you see accurately. When search tools are available, use them for timely facts and cite sources. When live weather data is provided in the system context, use it as ground truth for current conditions and the short forecast — do not invent temperatures. Mention the place and that data is from Open-Meteo when relevant.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_BODY_CHARS = 12_000_000;

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

  let rawText;
  try {
    rawText = await request.text();
  } catch {
    return jsonResponse(400, { error: "Could not read body" });
  }
  if (rawText.length > MAX_BODY_CHARS) {
    return jsonResponse(413, {
      error: "Payload too large. Use fewer or smaller images.",
    });
  }

  let body;
  try {
    body = JSON.parse(rawText || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const parsed = parseChatBody(body);
  if (parsed.error) return jsonResponse(400, { error: parsed.error });

  const { messages, system, temperature, max_tokens, stream, tools } = parsed;

  try {
    if (tools) {
      return await handleResponses({
        apiKey,
        model,
        messages,
        system,
        temperature,
        max_tokens,
        stream,
      });
    }

    return await handleChatCompletions({
      apiKey,
      model,
      messages,
      system,
      temperature,
      max_tokens,
      stream,
    });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : "Upstream request failed",
    });
  }
};

async function handleChatCompletions({
  apiKey,
  model,
  messages,
  system,
  temperature,
  max_tokens,
  stream,
}) {
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
      return errorFromXai(xaiRes);
    }
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
    return errorJson(data, xaiRes.status);
  }

  return jsonResponse(200, {
    content: data?.choices?.[0]?.message?.content ?? "(No response content from Grok.)",
    model: data?.model ?? model,
    usage: data?.usage ?? null,
  });
}

/**
 * Built-in tools path via Responses API.
 * Streams OpenAI-compatible responses events; non-stream returns final text.
 */
async function handleResponses({
  apiKey,
  model,
  messages,
  system,
  temperature,
  max_tokens,
  stream,
}) {
  const input = toResponsesInput(messages);

  const xaiRes = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

  if (stream) {
    if (!xaiRes.ok) {
      return errorFromXai(xaiRes);
    }
    // Transform responses SSE → chat.completion.chunk shape for the client
    const transformed = transformResponsesStream(xaiRes.body);
    return new Response(transformed, {
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
    return errorJson(data, xaiRes.status);
  }

  const content = extractResponsesText(data);
  const citations = extractCitations(data);

  return jsonResponse(200, {
    content: content || "(No response content from Grok.)",
    model: data?.model ?? model,
    usage: data?.usage ?? null,
    citations,
  });
}

function toResponsesInput(messages) {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    if (!Array.isArray(m.content)) {
      return { role: m.role, content: String(m.content ?? "") };
    }
    // Convert chat-completions parts → responses parts
    const parts = m.content.map((part) => {
      if (part.type === "text") {
        return { type: "input_text", text: part.text };
      }
      if (part.type === "image_url" && part.image_url?.url) {
        return {
          type: "input_image",
          image_url: part.image_url.url,
          detail: part.image_url.detail || "auto",
        };
      }
      return null;
    }).filter(Boolean);
    return { role: m.role, content: parts.length ? parts : "" };
  });
}

function extractResponsesText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const output = data?.output;
  if (!Array.isArray(output)) return "";
  const chunks = [];
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "output_text" && c.text) chunks.push(c.text);
        if (c.type === "text" && c.text) chunks.push(c.text);
      }
    }
  }
  return chunks.join("");
}

function extractCitations(data) {
  const urls = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.url === "string" && /^https?:\/\//i.test(node.url)) {
      urls.add(node.url);
    }
    if (Array.isArray(node.citations)) {
      for (const c of node.citations) {
        if (typeof c === "string") urls.add(c);
        else if (c?.url) urls.add(c.url);
      }
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(data);
  return [...urls].slice(0, 20);
}

/**
 * Map Responses API SSE events to chat.completion.chunk lines
 * so the existing client stream parser keeps working.
 */
function transformResponsesStream(body) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let model = "grok";

  return new ReadableStream({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;

            let event;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }

            if (event.model) model = event.model;

            // Text deltas (several possible shapes)
            const deltaText =
              event.type === "response.output_text.delta"
                ? event.delta
                : event.type === "response.output_text.delta" ||
                    event.delta?.content
                  ? event.delta?.content || event.delta
                  : typeof event.delta === "string"
                    ? event.delta
                    : null;

            if (typeof deltaText === "string" && deltaText.length) {
              const chunk = {
                id: event.item_id || event.response?.id || "resp",
                object: "chat.completion.chunk",
                model,
                choices: [{ index: 0, delta: { content: deltaText } }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }

            // Some SDKs emit content on response.output_item.delta
            if (
              event.type === "response.content_part.delta" &&
              typeof event.delta === "string"
            ) {
              const chunk = {
                object: "chat.completion.chunk",
                model,
                choices: [{ index: 0, delta: { content: event.delta } }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }

            if (event.type === "response.completed" || event.type === "response.done") {
              const citations = extractCitations(event.response || event);
              if (citations.length) {
                const chunk = {
                  object: "chat.completion.chunk",
                  model,
                  choices: [{ index: 0, delta: {} }],
                  citations,
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "stream error";
        const chunk = {
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {} }],
          error: msg,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
}

async function errorFromXai(xaiRes) {
  const data = await xaiRes.json().catch(() => ({}));
  return errorJson(data, xaiRes.status);
}

function errorJson(data, status) {
  const msg =
    (typeof data?.error === "string" && data.error) ||
    data?.error?.message ||
    data?.message ||
    `xAI API error ${status}`;
  return jsonResponse(status >= 400 && status < 600 ? status : 502, { error: msg });
}

function isValidContent(content) {
  if (typeof content === "string") return true;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((part) => {
    if (!part || typeof part !== "object") return false;
    if (part.type === "text" && typeof part.text === "string") return true;
    if (
      part.type === "image_url" &&
      part.image_url &&
      typeof part.image_url.url === "string" &&
      (part.image_url.url.startsWith("data:image/") ||
        part.image_url.url.startsWith("https://") ||
        part.image_url.url.startsWith("http://"))
    ) {
      return true;
    }
    return false;
  });
}

function parseChatBody(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) {
    return { error: "messages array is required" };
  }

  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) {
      return { error: 'Each message needs role "user"|"assistant"' };
    }
    if (!isValidContent(m.content)) {
      return {
        error:
          "Each message needs string content or multimodal parts (text / image_url)",
      };
    }
  }

  let system =
    typeof body.system === "string" && body.system.trim()
      ? body.system.trim()
      : DEFAULT_SYSTEM;

  // Durable memory / tasks / plan context from the client
  if (typeof body.memory_context === "string" && body.memory_context.trim()) {
    system +=
      "\n\n--- USER CONTEXT ---\n" +
      body.memory_context.trim() +
      "\n--- END USER CONTEXT ---";
  }

  // Live weather snapshot (from Open-Meteo via the client /api/weather)
  if (typeof body.weather_context === "string" && body.weather_context.trim()) {
    system +=
      "\n\n--- LIVE WEATHER DATA (Open-Meteo) ---\n" +
      body.weather_context.trim() +
      "\n--- END WEATHER DATA ---";
  }

  const temperature =
    typeof body.temperature === "number" && Number.isFinite(body.temperature)
      ? Math.min(2, Math.max(0, body.temperature))
      : 0.7;

  const max_tokens =
    typeof body.max_tokens === "number" && Number.isFinite(body.max_tokens)
      ? Math.min(8192, Math.max(16, Math.floor(body.max_tokens)))
      : 2048;

  const stream = body.stream === true;
  const tools = body.tools === true;

  return { messages, system, temperature, max_tokens, stream, tools };
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
