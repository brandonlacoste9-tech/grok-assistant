import { useCallback, useEffect, useRef, useState } from "react";
import { sendChat } from "./lib/api";
import { clearMessages, loadMessages, saveMessages } from "./lib/storage";
import type { ChatMessage } from "./lib/types";
import {
  VOICES,
  createRecorder,
  getAutoSpeak,
  getVoiceId,
  setAutoSpeak,
  setVoiceId,
  speakText,
  transcribeBlob,
} from "./lib/voice";
import { useRealtimeVoice } from "./hooks/useRealtimeVoice";
import "./App.css";

function uid() {
  return (
    crypto.randomUUID?.() ??
    `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  );
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
  const [voiceId, setVoiceIdState] = useState(() => getVoiceId());
  const [autoSpeak, setAutoSpeakState] = useState(() => getAutoSpeak());
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const appendTranscript = useCallback((line: {
    id: string;
    role: "user" | "assistant";
    content: string;
  }) => {
    setMessages((prev) => {
      // de-dupe rapid partial finals
      if (prev.some((m) => m.content === line.content && m.role === line.role && Date.now() - m.createdAt < 2000)) {
        return prev;
      }
      return [
        ...prev,
        {
          id: line.id,
          role: line.role,
          content: line.content,
          createdAt: Date.now(),
        },
      ];
    });
  }, []);

  const realtime = useRealtimeVoice({
    voice: voiceId,
    instructions:
      "You are Grok Assistant, a warm voice companion powered by xAI Grok. Keep spoken answers clear, friendly, and concise. Don't invent personal facts.",
    onError: (msg) => {
      if (msg) setError(msg);
    },
    onTranscript: appendTranscript,
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, recording]);

  const stopAudio = useCallback(() => {
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeakingId(null);
  }, []);

  const playSpeech = useCallback(
    async (text: string, messageId: string) => {
      stopAudio();
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      setSpeakingId(messageId);
      try {
        const audio = await speakText(text, {
          voice_id: voiceId,
          signal: controller.signal,
        });
        audioRef.current = audio;
        audio.onended = () => {
          setSpeakingId(null);
          audioRef.current = null;
        };
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Voice playback failed");
        setSpeakingId(null);
      }
    },
    [stopAudio, voiceId]
  );

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

        if (autoSpeak && assistantMsg.content) {
          void playSpeech(assistantMsg.content, assistantMsg.id);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [loading, messages, autoSpeak, playSpeech]
  );

  const startRecording = async () => {
    if (recording || loading || transcribing) return;
    setError(null);
    try {
      stopAudio();
      const { recorder, stream, chunks } = await createRecorder();
      recorderRef.current = recorder;
      streamRef.current = stream;
      chunksRef.current = chunks;
      recorder.start(200);
      setRecording(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Microphone access denied. Allow mic in the browser."
      );
    }
  };

  const stopRecordingAndSend = async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      return;
    }

    setRecording(false);
    setTranscribing(true);

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;

    try {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      if (blob.size < 500) {
        setError("Recording too short — hold the mic and try again.");
        return;
      }
      const text = await transcribeBlob(blob);
      if (!text) {
        setError("Couldn't catch that — try speaking again.");
        return;
      }
      await send(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice input failed");
    } finally {
      setTranscribing(false);
    }
  };

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
    stopAudio();
    if (realtime.status === "live" || realtime.status === "connecting") {
      realtime.disconnect();
    }
    if (messages.length && !confirm("Clear this conversation?")) return;
    clearMessages();
    setMessages([]);
    setError(null);
    setModel(null);
  };

  const toggleLiveVoice = async () => {
    setError(null);
    if (realtime.status === "live" || realtime.status === "connecting") {
      realtime.disconnect();
      return;
    }
    stopAudio();
    if (loading) stop();
    await realtime.connect();
  };

  const onVoiceChange = (id: string) => {
    setVoiceIdState(id);
    setVoiceId(id);
  };

  const toggleAutoSpeak = () => {
    const next = !autoSpeak;
    setAutoSpeakState(next);
    setAutoSpeak(next);
    if (!next) stopAudio();
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
              Powered by xAI Grok Voice
              {model ? <span className="model"> · {model}</span> : null}
            </p>
          </div>
        </div>
        <div className="top-actions">
          <label className="voice-select">
            <span className="sr-only">Voice</span>
            <select
              value={voiceId}
              onChange={(e) => onVoiceChange(e.target.value)}
              aria-label="Grok voice"
            >
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`btn ghost ${autoSpeak ? "active-toggle" : ""}`}
            onClick={toggleAutoSpeak}
            title="Auto-speak text replies (TTS)"
            disabled={realtime.status === "live"}
          >
            {autoSpeak ? "🔊 Auto" : "🔇 Mute"}
          </button>
          <button
            type="button"
            className={`btn live ${
              realtime.status === "live"
                ? "live-on"
                : realtime.status === "connecting"
                  ? "live-connecting"
                  : ""
            }`}
            onClick={() => void toggleLiveVoice()}
            title="Realtime speech-to-speech with Grok Voice"
          >
            {realtime.status === "live"
              ? "● Live"
              : realtime.status === "connecting"
                ? "…"
                : "🎙 Live"}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={reset}
            disabled={loading && messages.length === 0}
          >
            New chat
          </button>
        </div>
      </header>

      {realtime.status === "live" || realtime.status === "connecting" ? (
        <div className="live-banner" role="status">
          <div className="live-meter" aria-hidden="true">
            <div
              className="live-meter-fill"
              style={{
                transform: `scaleY(${Math.min(1, realtime.audioLevel * 8)})`,
              }}
            />
          </div>
          <div className="live-copy">
            <strong>
              {realtime.status === "connecting"
                ? "Connecting to Grok Voice…"
                : realtime.isSpeaking
                  ? "Grok is speaking"
                  : "Listening — just talk"}
            </strong>
            {(realtime.userPartial || realtime.assistantPartial) && (
              <p className="live-partial">
                {realtime.userPartial
                  ? `You: ${realtime.userPartial}`
                  : `Grok: ${realtime.assistantPartial}`}
              </p>
            )}
          </div>
          <button type="button" className="btn ghost sm" onClick={() => realtime.disconnect()}>
            End call
          </button>
        </div>
      ) : null}

      <main className="chat">
        {messages.length === 0 ? (
          <section className="empty">
            <div className="empty-card">
              <div className="empty-icon" aria-hidden="true">
                ✦
              </div>
              <h2>Talk with Grok</h2>
              <p>
                Text chat, hold 🎙 for push-to-talk, or hit <strong>Live</strong> for
                realtime speech-to-speech. API keys stay on the server.
              </p>
              <div className="starters">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="starter"
                    onClick={() => void send(s)}
                  >
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
                  <div className="bubble-label-row">
                    <div className="bubble-label">
                      {m.role === "assistant" ? "Grok" : "You"}
                    </div>
                    {m.role === "assistant" ? (
                      <button
                        type="button"
                        className="speak-btn"
                        onClick={() => {
                          if (speakingId === m.id) stopAudio();
                          else void playSpeech(m.content, m.id);
                        }}
                        aria-label={
                          speakingId === m.id ? "Stop speaking" : "Speak reply"
                        }
                      >
                        {speakingId === m.id ? "⏹" : "🔊"}
                      </button>
                    ) : null}
                  </div>
                  <div className="bubble-body">{formatContent(m.content)}</div>
                </div>
              </article>
            ))}
            {loading || transcribing ? (
              <article className="bubble-row assistant">
                <div className="avatar" aria-hidden="true">
                  ✦
                </div>
                <div className="bubble thinking">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  {transcribing ? (
                    <span className="thinking-label">Transcribing…</span>
                  ) : null}
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
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setError(null)}
            >
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
          <button
            type="button"
            className={`btn mic ${recording ? "recording" : ""}`}
            disabled={loading || transcribing}
            onMouseDown={() => void startRecording()}
            onMouseUp={() => void stopRecordingAndSend()}
            onMouseLeave={() => {
              if (recording) void stopRecordingAndSend();
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              void startRecording();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              void stopRecordingAndSend();
            }}
            aria-label={recording ? "Release to send" : "Hold to talk"}
            title="Hold to talk (Grok STT)"
          >
            {recording ? "●" : "🎙"}
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onInput}
            onKeyDown={onKeyDown}
            placeholder={
              recording ? "Listening…" : "Message Grok… or hold 🎙"
            }
            rows={1}
            disabled={loading || recording || transcribing}
            aria-label="Message"
          />
          {loading ? (
            <button type="button" className="btn primary" onClick={stop}>
              Stop
            </button>
          ) : speakingId ? (
            <button type="button" className="btn primary" onClick={stopAudio}>
              Stop 🔊
            </button>
          ) : (
            <button
              type="submit"
              className="btn primary"
              disabled={!input.trim() || transcribing}
            >
              Send
            </button>
          )}
        </form>
        <p className="fineprint">
          Live = realtime S2S · Hold 🎙 = STT · 🔊 = TTS · Grok Voice (xAI)
        </p>
      </footer>
    </div>
  );
}

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
