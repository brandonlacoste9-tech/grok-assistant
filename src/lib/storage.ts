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
  const trimmed = messages.slice(-80);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded — strip images from older messages, then drop oldest
    try {
      const slim = stripOldImages(trimmed, 2);
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      try {
        const textOnly = trimmed.slice(-20).map((m) => ({
          ...m,
          images: undefined,
        }));
        localStorage.setItem(KEY, JSON.stringify(textOnly));
      } catch {
        /* ignore */
      }
    }
  }
}

/** Keep images only on the newest `keep` user messages that have them. */
function stripOldImages(messages: ChatMessage[], keep: number): ChatMessage[] {
  let remaining = keep;
  const out: ChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.images?.length) {
      if (remaining > 0) {
        remaining -= 1;
        out.unshift(m);
      } else {
        out.unshift({ ...m, images: undefined });
      }
    } else {
      out.unshift(m);
    }
  }
  return out;
}

export function clearMessages() {
  localStorage.removeItem(KEY);
}
