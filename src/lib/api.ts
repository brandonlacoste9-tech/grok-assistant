import type { ApiMessage, ChatApiResponse, ChatMessage, ContentPart } from "./types";

/** Build OpenAI-compatible messages; attach images as multimodal content. */
export function toApiMessages(messages: ChatMessage[]): ApiMessage[] {
  return messages.map((m) => {
    if (m.role === "assistant" || !m.images?.length) {
      return { role: m.role, content: m.content };
    }

    const parts: ContentPart[] = [];
    for (const url of m.images) {
      if (typeof url === "string" && url.startsWith("data:image")) {
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

export async function sendChat(
  messages: ChatMessage[],
  options?: { signal?: AbortSignal }
): Promise<ChatApiResponse> {
  const payload = {
    messages: toApiMessages(messages),
    temperature: 0.75,
    max_tokens: 2048,
    stream: false,
  };

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options?.signal,
  });

  const data = (await res.json().catch(() => ({}))) as ChatApiResponse;

  if (!res.ok) {
    return {
      error:
        data.error ||
        `Request failed (${res.status}). Check XAI_API_KEY on the server.`,
    };
  }

  return data;
}

export type StreamChatHandlers = {
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  /** Fires when the model is streaming internal reasoning before visible text. */
  onReasoning?: () => void;
  onModel?: (model: string) => void;
};

/**
 * Stream a Grok chat completion via SSE (OpenAI-compatible chunks).
 * Calls onDelta with the growing full content after each token.
 * grok-4.3 may emit reasoning_content first; those stay off the bubble.
 */
export async function streamChat(
  messages: ChatMessage[],
  handlers: StreamChatHandlers
): Promise<{ content: string; model?: string; error?: string }> {
  const payload = {
    messages: toApiMessages(messages),
    temperature: 0.75,
    max_tokens: 2048,
    stream: true,
  };

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: handlers.signal,
  });

  const contentType = res.headers.get("content-type") || "";

  // Error as JSON
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as ChatApiResponse;
    return {
      content: "",
      error:
        data.error ||
        `Request failed (${res.status}). Check XAI_API_KEY on the server.`,
    };
  }

  // Unexpected non-stream JSON (fallback)
  if (contentType.includes("application/json") && !contentType.includes("event-stream")) {
    const data = (await res.json()) as ChatApiResponse;
    if (data.error) return { content: "", error: data.error };
    const content = data.content || "";
    if (content) handlers.onDelta(content);
    if (data.model) handlers.onModel?.(data.model);
    return { content, model: data.model };
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
          error?: { message?: string } | string;
        };

        if (chunk.model && !model) {
          model = chunk.model;
          handlers.onModel?.(model);
        }

        if (typeof chunk.error === "string") {
          return { content, model, error: chunk.error };
        }
        if (chunk.error && typeof chunk.error === "object" && chunk.error.message) {
          return { content, model, error: chunk.error.message };
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

  return { content, model };
}
