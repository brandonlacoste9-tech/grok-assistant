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
