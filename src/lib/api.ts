import type { ChatApiResponse, ChatMessage } from "./types";

export async function sendChat(
  messages: ChatMessage[],
  options?: { signal?: AbortSignal }
): Promise<ChatApiResponse> {
  const payload = {
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
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
  onModel?: (model: string) => void;
};

/**
 * Stream a Grok chat completion via SSE (OpenAI-compatible chunks).
 * Calls onDelta with the growing full content after each token.
 */
export async function streamChat(
  messages: ChatMessage[],
  handlers: StreamChatHandlers
): Promise<{ content: string; model?: string; error?: string }> {
  const payload = {
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
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
          choices?: Array<{ delta?: { content?: string } }>;
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

        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length) {
          content += delta;
          handlers.onDelta(content);
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  return { content, model };
}
