/**
 * Legacy single-thread helpers — multi-thread storage lives in threads.ts.
 * Kept for any leftover imports; new code should use threads.ts.
 */
import type { ChatMessage } from "./types";
import { loadThreads, loadActiveThreadId, upsertThreadMessages } from "./threads";

export function loadMessages(): ChatMessage[] {
  const threads = loadThreads();
  const active = loadActiveThreadId(threads);
  return threads.find((t) => t.id === active)?.messages ?? threads[0]?.messages ?? [];
}

export function saveMessages(messages: ChatMessage[]) {
  const threads = loadThreads();
  const active = loadActiveThreadId(threads);
  if (!active) return;
  upsertThreadMessages(threads, active, messages);
}

export function clearMessages() {
  // no-op for multi-thread; use delete/create thread
}
