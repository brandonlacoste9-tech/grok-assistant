import type { ChatMessage, ChatThread } from "./types";

const THREADS_KEY = "grok_assistant_threads_v1";
const ACTIVE_KEY = "grok_assistant_active_v1";
const LEGACY_MESSAGES_KEY = "grok_assistant_messages_v1";

function uid() {
  return (
    crypto.randomUUID?.() ??
    `t_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  );
}

function emptyThread(title = "New chat"): ChatThread {
  const now = Date.now();
  return {
    id: uid(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

/** Title from first user message, truncated. */
export function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.content.trim());
  if (!first) return "New chat";
  const t = first.content.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t;
}

export function loadThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ChatThread[];
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map(normalizeThread).filter(Boolean) as ChatThread[];
      }
    }
  } catch {
    /* fall through */
  }

  // Migrate single-thread legacy storage
  try {
    const legacy = localStorage.getItem(LEGACY_MESSAGES_KEY);
    if (legacy) {
      const messages = JSON.parse(legacy) as ChatMessage[];
      if (Array.isArray(messages) && messages.length) {
        const t = emptyThread(titleFromMessages(messages));
        t.messages = messages.filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string"
        );
        t.updatedAt = t.messages[t.messages.length - 1]?.createdAt || Date.now();
        saveThreads([t]);
        localStorage.removeItem(LEGACY_MESSAGES_KEY);
        return [t];
      }
    }
  } catch {
    /* ignore */
  }

  const t = emptyThread();
  saveThreads([t]);
  return [t];
}

function normalizeThread(t: ChatThread): ChatThread | null {
  if (!t || typeof t.id !== "string") return null;
  return {
    id: t.id,
    title: typeof t.title === "string" ? t.title : "Chat",
    createdAt: t.createdAt || Date.now(),
    updatedAt: t.updatedAt || Date.now(),
    messages: Array.isArray(t.messages) ? t.messages : [],
  };
}

export function saveThreads(threads: ChatThread[]) {
  const trimmed = threads.slice(0, 40).map((t) => ({
    ...t,
    messages: slimMessages(t.messages.slice(-80)),
  }));
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(trimmed));
  } catch {
    try {
      const lighter = trimmed.map((t) => ({
        ...t,
        messages: t.messages.map((m) => ({
          ...m,
          images: undefined,
          generatedImages: m.generatedImages?.slice(0, 1),
        })),
      }));
      localStorage.setItem(THREADS_KEY, JSON.stringify(lighter));
    } catch {
      /* ignore */
    }
  }
}

function slimMessages(messages: ChatMessage[]): ChatMessage[] {
  // Keep images only on last 2 user messages that have them
  let remaining = 2;
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

export function loadActiveThreadId(threads: ChatThread[]): string {
  try {
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id && threads.some((t) => t.id === id)) return id;
  } catch {
    /* ignore */
  }
  return threads[0]?.id ?? "";
}

export function saveActiveThreadId(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function createThread(threads: ChatThread[]): {
  threads: ChatThread[];
  thread: ChatThread;
} {
  const thread = emptyThread();
  const next = [thread, ...threads];
  saveThreads(next);
  saveActiveThreadId(thread.id);
  return { threads: next, thread };
}

export function deleteThread(
  threads: ChatThread[],
  id: string
): { threads: ChatThread[]; activeId: string } {
  let next = threads.filter((t) => t.id !== id);
  if (next.length === 0) {
    const t = emptyThread();
    next = [t];
  }
  saveThreads(next);
  const activeId = next[0].id;
  saveActiveThreadId(activeId);
  return { threads: next, activeId };
}

export function upsertThreadMessages(
  threads: ChatThread[],
  threadId: string,
  messages: ChatMessage[]
): ChatThread[] {
  const next = threads.map((t) => {
    if (t.id !== threadId) return t;
    const autoTitle =
      t.title === "New chat" || t.title === "Chat"
        ? titleFromMessages(messages)
        : t.title;
    return {
      ...t,
      title: autoTitle,
      messages,
      updatedAt: Date.now(),
    };
  });
  saveThreads(next);
  return next;
}

export function renameThread(
  threads: ChatThread[],
  id: string,
  title: string
): ChatThread[] {
  const next = threads.map((t) =>
    t.id === id ? { ...t, title: title.trim() || t.title, updatedAt: Date.now() } : t
  );
  saveThreads(next);
  return next;
}
