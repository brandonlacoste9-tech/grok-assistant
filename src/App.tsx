import { useCallback, useEffect, useRef, useState } from "react";
import { sendChat } from "./lib/api";
import { clearMessages, loadMessages, saveMessages } from "./lib/storage";
import type { ChatMessage } from "./lib/types";
import "./App.css";

function uid() {
  return crypto.randomUUID?.() ?? `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const STARTERS = [
  "What can you help me with today?",
  "Explain something complex simply",
  "Help me plan my day",
  "Write a short email draft",
];

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || loading) return;

      setError(null);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content,
        createdAt: Date.now(),
      };

      const next = [...messages, userMsg];
      setMessages(next);
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await sendChat(next, { signal: controller.signal });
        if (res.error) {
          setError(res.error);
          return;
        }
        if (res.model) setModel(res.model);
        const assistantMsg: ChatMessage = {
          id: uid(),
          role: "assistant",
          content: res.content || "(Empty reply)",
          createdAt: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [loading, messages]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const onInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const reset = () => {
    if (loading) stop();
    if (messages.length && !confirm("Clear this conversation?")) return;
    clearMessages();
    setMessages([]);
    setError(null);
    setModel(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ✦
          </span>
          <div>
            <h1>Grok Assistant</h1>
            <p className="tag">
              Powered by xAI Grok
              {model ? <span className="model"> · {model}</span> : null}
            </p>
          </div>
        </div>
        <div className="top-actions">
          <button type="button" className="btn ghost" onClick={reset} disabled={loading && messages.length === 0}>
            New chat
          </button>
        </div>
      </header>

      <main className="chat">
        {messages.length === 0 ? (
          <section className="empty">
            <div className="empty-card">
              <div className="empty-icon" aria-hidden="true">
                ✦
              </div>
              <h2>What do you need?</h2>
              <p>
                A clean personal assistant backed by Grok. Your messages stay in this
                browser; the API key never touches the client.
              </p>
              <div className="starters">
                {STARTERS.map((s) => (
                  <button key={s} type="button" className="starter" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <div className="thread" role="log" aria-live="polite">
            {messages.map((m) => (
              <article
                key={m.id}
                className={`bubble-row ${m.role}`}
                data-role={m.role}
              >
                <div className="avatar" aria-hidden="true">
                  {m.role === "assistant" ? "✦" : "You"}
                </div>
                <div className="bubble">
                  <div className="bubble-label">
                    {m.role === "assistant" ? "Grok" : "You"}
                  </div>
                  <div className="bubble-body">{formatContent(m.content)}</div>
                </div>
              </article>
            ))}
            {loading ? (
              <article className="bubble-row assistant">
                <div className="avatar" aria-hidden="true">
                  ✦
                </div>
                <div className="bubble thinking">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </article>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </main>

      <footer className="composer-wrap">
        {error ? (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" className="btn ghost sm" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInput}
            onKeyDown={onKeyDown}
            placeholder="Message Grok…"
            rows={1}
            disabled={loading}
            aria-label="Message"
          />
          {loading ? (
            <button type="button" className="btn primary" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={!input.trim()}>
              Send
            </button>
          )}
        </form>
        <p className="fineprint">
          Enter to send · Shift+Enter for newline · Local history only
        </p>
      </footer>
    </div>
  );
}

/** Minimal safe formatting: paragraphs + inline code */
function formatContent(text: string) {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const inner = part.slice(3, -3).replace(/^\w+\n/, "");
      return (
        <pre key={i} className="code-block">
          <code>{inner}</code>
        </pre>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part.split("\n").map((line, j, arr) => (
      <span key={`${i}-${j}`}>
        {line}
        {j < arr.length - 1 ? <br /> : null}
      </span>
    ));
  });
}
