import { useCallback, useEffect, useRef, useState } from "react";
import { streamChat } from "./lib/api";
import { fileToDataUrl, isImageFile, MAX_IMAGES } from "./lib/images";
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
  const [reasoning, setReasoning] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setReasoning(false);
  }, []);

  const send = useCallback(
    async (text: string, images?: string[]) => {
      const content = text.trim();
      const imgs = images ?? pendingImages;
      if ((!content && imgs.length === 0) || loading) return;

      setError(null);
      setInput("");
      setPendingImages([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: content || (imgs.length ? "What's in this image?" : ""),
        images: imgs.length ? imgs : undefined,
        createdAt: Date.now(),
      };

      const assistantId = uid();
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };

      const next = [...messages, userMsg];
      setMessages([...next, assistantPlaceholder]);
      setLoading(true);
      setReasoning(false);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await streamChat(next, {
          signal: controller.signal,
          onModel: (m) => setModel(m),
          onReasoning: () => setReasoning(true),
          onDelta: (partial) => {
            setReasoning(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: partial } : m
              )
            );
          },
        });

        if (res.error) {
          setError(res.error);
          setMessages((prev) =>
            prev.filter((m) => m.id !== assistantId || m.content.trim())
          );
          return;
        }

        if (res.model) setModel(res.model);

        const finalText = res.content?.trim() || "(Empty reply)";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: finalText } : m
          )
        );

        if (autoSpeak && finalText && finalText !== "(Empty reply)") {
          void playSpeech(finalText, assistantId);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : "Request failed");
        setMessages((prev) =>
          prev.filter((m) => m.id !== assistantId || m.content.trim())
        );
      } finally {
        setLoading(false);
        setReasoning(false);
        abortRef.current = null;
      }
    },
    [loading, messages, autoSpeak, playSpeech, pendingImages]
  );

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(isImageFile);
    if (!list.length) {
      setError("Please choose JPG, PNG, or WebP images.");
      return;
    }
    setAttaching(true);
    setError(null);
    try {
      const room = MAX_IMAGES - pendingImages.length;
      if (room <= 0) {
        setError(`Max ${MAX_IMAGES} images per message.`);
        return;
      }
      const next: string[] = [];
      for (const file of list.slice(0, room)) {
        next.push(await fileToDataUrl(file));
      }
      setPendingImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read image");
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) {
      void addFiles(e.dataTransfer.files);
    }
  };

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
    setPendingImages([]);
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
                Text chat, attach images for vision, hold 🎙 for push-to-talk, or hit{" "}
                <strong>Live</strong> for realtime speech-to-speech. API keys stay on
                the server.
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
            {messages.map((m) => {
              const isStreaming =
                loading &&
                m.role === "assistant" &&
                m.id === messages[messages.length - 1]?.id;
              return (
                <article
                  key={m.id}
                  className={`bubble-row ${m.role}`}
                  data-role={m.role}
                >
                  <div className="avatar" aria-hidden="true">
                    {m.role === "assistant" ? "✦" : "You"}
                  </div>
                  <div className={`bubble ${isStreaming && !m.content ? "thinking" : ""}`}>
                    <div className="bubble-label-row">
                      <div className="bubble-label">
                        {m.role === "assistant" ? "Grok" : "You"}
                      </div>
                      {m.role === "assistant" && m.content ? (
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
                          disabled={isStreaming}
                        >
                          {speakingId === m.id ? "⏹" : "🔊"}
                        </button>
                      ) : null}
                    </div>
                    {isStreaming && !m.content ? (
                      <>
                        <span className="dot" />
                        <span className="dot" />
                        <span className="dot" />
                        {reasoning ? (
                          <span className="thinking-label">Thinking…</span>
                        ) : null}
                      </>
                    ) : (
                      <div className="bubble-body">
                        {m.images?.length ? (
                          <div className="msg-images">
                            {m.images.map((src, i) => (
                              <a
                                key={i}
                                href={src}
                                target="_blank"
                                rel="noreferrer"
                                className="msg-image-link"
                              >
                                <img src={src} alt={`Attachment ${i + 1}`} className="msg-image" />
                              </a>
                            ))}
                          </div>
                        ) : null}
                        {m.content ? formatContent(m.content) : null}
                        {isStreaming ? <span className="stream-cursor" aria-hidden="true" /> : null}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
            {transcribing ? (
              <article className="bubble-row assistant">
                <div className="avatar" aria-hidden="true">
                  ✦
                </div>
                <div className="bubble thinking">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="thinking-label">Transcribing…</span>
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
        {pendingImages.length > 0 ? (
          <div className="attach-preview" aria-label="Attached images">
            {pendingImages.map((src, i) => (
              <div key={i} className="attach-thumb">
                <img src={src} alt={`Pending ${i + 1}`} />
                <button
                  type="button"
                  className="attach-remove"
                  aria-label={`Remove image ${i + 1}`}
                  onClick={() =>
                    setPendingImages((prev) => prev.filter((_, j) => j !== i))
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
            }}
          />
          <button
            type="button"
            className="btn ghost icon-btn"
            disabled={loading || attaching || pendingImages.length >= MAX_IMAGES}
            onClick={() => fileInputRef.current?.click()}
            title="Attach image for vision"
            aria-label="Attach image"
          >
            {attaching ? "…" : "🖼"}
          </button>
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
            onPaste={onPaste}
            placeholder={
              recording
                ? "Listening…"
                : pendingImages.length
                  ? "Ask about the image…"
                  : "Message Grok… attach 🖼 or hold 🎙"
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
              disabled={
                transcribing ||
                attaching ||
                (!input.trim() && pendingImages.length === 0)
              }
            >
              Send
            </button>
          )}
        </form>
        <p className="fineprint">
          🖼 vision · Live S2S · Hold 🎙 STT · 🔊 TTS · Grok (xAI)
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
