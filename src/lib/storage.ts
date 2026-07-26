import type { ChatMessage } from "./types";

const KEY = "grok_assistant_messages_v1";

export function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    );
  } catch {
    return [];
  }
}

export function saveMessages(messages: ChatMessage[]) {
  try {
    // Cap storage size
    const trimmed = messages.slice(-80);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // quota exceeded — drop oldest
    try {
      localStorage.setItem(KEY, JSON.stringify(messages.slice(-20)));
    } catch {
      /* ignore */
    }
  }
}

export function clearMessages() {
  localStorage.removeItem(KEY);
}
