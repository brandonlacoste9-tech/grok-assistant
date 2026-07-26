import type { ApiMessage, ChatApiResponse, ChatMessage, ContentPart } from "./types";

/** Build OpenAI-compatible messages; attach images as multimodal content. */
export function toApiMessages(messages: ChatMessage[]): ApiMessage[] {
  return messages.map((m) => {
    if (m.role === "assistant" || !m.images?.length) {
      // Include note about generated images for follow-ups
      if (m.role === "assistant" && m.generatedImages?.length) {
        const note = m.content
          ? `${m.content}\n\n[Generated image: ${m.generatedImages[0]}]`
          : `[Generated image: ${m.generatedImages[0]}]`;
        return { role: m.role, content: note };
      }
      return { role: m.role, content: m.content };
    }

    const parts: ContentPart[] = [];
    for (const url of m.images) {
      if (typeof url === "string" && (url.startsWith("data:image") || url.startsWith("http"))) {
        parts.push({
          type: "image_url",
          image_url: { url, detail: "auto" },
        });
      }
    }
    parts.push({
      type: "text",
      text: m.content.trim() || "What's in this image? Describe it clearly.",
    });
    return { role: "user", content: parts };
  });
}

export type StreamChatHandlers = {
  signal?: AbortSignal;
  tools?: boolean;
  onDelta: (text: string) => void;
  onReasoning?: () => void;
  onModel?: (model: string) => void;
  onCitations?: (urls: string[]) => void;
};

/**
 * Stream a Grok chat completion via SSE.
 * tools:true enables server-side web_search + x_search (Responses API).
 */
export async function streamChat(
  messages: ChatMessage[],
  handlers: StreamChatHandlers
): Promise<{ content: string; model?: string; error?: string; citations?: string[] }> {
  const payload = {
    messages: toApiMessages(messages),
    temperature: 0.75,
    max_tokens: 2048,
    stream: true,
    tools: handlers.tools === true,
  };

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: handlers.signal,
  });

  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ChatApiResponse;
    return {
      content: "",
      error:
        data.error ||
        `Request failed (${res.status}). Check XAI_API_KEY on the server.`,
    };
  }

  if (contentType.includes("application/json") && !contentType.includes("event-stream")) {
    const data = (await res.json()) as ChatApiResponse;
    if (data.error) return { content: "", error: data.error };
    const content = data.content || "";
    if (content) handlers.onDelta(content);
    if (data.model) handlers.onModel?.(data.model);
    if (data.citations?.length) handlers.onCitations?.(data.citations);
    return { content, model: data.model, citations: data.citations };
  }

  if (!res.body) {
    return { content: "", error: "No response body from server" };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let model: string | undefined;
  let sawReasoning = false;
  let citations: string[] | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;

      try {
        const chunk = JSON.parse(data) as {
          model?: string;
          choices?: Array<{
            delta?: { content?: string; reasoning_content?: string };
          }>;
          citations?: string[];
          error?: { message?: string } | string;
        };

        if (chunk.model && !model) {
          model = chunk.model;
          handlers.onModel?.(model);
        }

        if (typeof chunk.error === "string") {
          return { content, model, error: chunk.error, citations };
        }
        if (chunk.error && typeof chunk.error === "object" && chunk.error.message) {
          return { content, model, error: chunk.error.message, citations };
        }

        if (Array.isArray(chunk.citations) && chunk.citations.length) {
          citations = chunk.citations;
          handlers.onCitations?.(chunk.citations);
        }

        const delta = chunk.choices?.[0]?.delta;
        const reasoning = delta?.reasoning_content;
        if (typeof reasoning === "string" && reasoning.length && !content) {
          if (!sawReasoning) {
            sawReasoning = true;
            handlers.onReasoning?.();
          }
        }

        const text = delta?.content;
        if (typeof text === "string" && text.length) {
          content += text;
          handlers.onDelta(content);
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  return { content, model, citations };
}

export async function generateImage(
  prompt: string,
  options?: { signal?: AbortSignal; n?: number }
): Promise<{ images?: { url: string }[]; model?: string; error?: string }> {
  const cleaned = prompt.trim();
  if (!cleaned) {
    return { error: "Type a description first, then tap ✨ Imagine." };
  }

  let res: Response;
  try {
    res = await fetch("/api/imagine", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        prompt: cleaned,
        n: options?.n ?? 1,
      }),
      signal: options?.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return {
      error:
        err instanceof Error
          ? err.message
          : "Network error calling /api/imagine",
    };
  }

  const text = await res.text();
  let data: {
    images?: { url: string }[];
    model?: string;
    error?: string;
  } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // SPA fallback HTML or empty body
    return {
      error: res.ok
        ? "Imagine returned non-JSON (check Netlify /api/imagine redirect)."
        : `Imagine failed (${res.status})`,
    };
  }

  if (!res.ok) {
    return {
      error:
        (typeof data.error === "string" && data.error) ||
        `Imagine failed (${res.status})`,
    };
  }

  const images = (data.images || []).filter(
    (i) => i && typeof i.url === "string" && i.url.length > 0
  );
  if (!images.length) {
    return { error: "No image URL returned from Grok Imagine." };
  }

  return { images, model: data.model };
}
