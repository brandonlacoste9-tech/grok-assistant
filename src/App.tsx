import { useCallback, useEffect, useRef, useState } from "react";
import { generateImage, streamChat } from "./lib/api";
import { downloadBackupFile, importBackupFile } from "./lib/backup";
import { fileToDataUrl, isImageFile, MAX_IMAGES } from "./lib/images";
import { copyImage, downloadImage, openImage } from "./lib/mediaActions";
import {
  buildMemoryBlock,
  handleMemoryCommand,
  loadMemory,
  setDisplayName,
  setStyle,
  type UserMemory,
} from "./lib/memory";
import {
  autoRoute,
  looksLikeImagine,
} from "./lib/routing";
import {
  formatTasksBlock,
  handleTaskCommand,
  loadTasks,
  looksLikePlanDay,
} from "./lib/tasks";
import {
  createThread,
  deleteThread,
  loadActiveThreadId,
  loadThreads,
  renameThread,
  saveActiveThreadId,
  upsertThreadMessages,
} from "./lib/threads";
import type { ChatMessage, ChatThread } from "./lib/types";
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
import {
  getDefaultCity,
  resolveWeatherForMessage,
  setDefaultCity,
} from "./lib/weather";
import { useRealtimeVoice } from "./hooks/useRealtimeVoice";
import "./App.css";

function uid() {
  return (
    crypto.randomUUID?.() ??
    `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  );
}

const STARTERS = [
  "Plan my day",
  "What's the weather?",
  "Remember that I prefer short answers",
  "Draw a red apple on a wooden table",
];

const TOOLS_KEY = "grok_assistant_tools_on";
const IMAGINE_MODE_KEY = "grok_assistant_imagine_mode";

export default function App() {
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads());
  const [activeId, setActiveId] = useState(() =>
    loadActiveThreadId(loadThreads())
  );
  const activeThread = threads.find((t) => t.id === activeId) ?? threads[0];
  const messages = activeThread?.messages ?? [];

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
  const [toolsOn, setToolsOn] = useState(() => {
    try {
      return localStorage.getItem(TOOLS_KEY) === "1";
    } catch {
      return false;
    }
  });
  /** When on, Send always calls Grok Imagine (image gen) instead of chat. */
  const [imagineMode, setImagineMode] = useState(() => {
    try {
      return localStorage.getItem(IMAGINE_MODE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imagining, setImagining] = useState(false);
  const [defaultCity, setDefaultCityState] = useState(() => getDefaultCity());
  const [memory, setMemory] = useState<UserMemory>(() => loadMemory());
  const [taskCount, setTaskCount] = useState(
    () => loadTasks().filter((t) => !t.done).length
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // Desktop: sidebar open by default
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const apply = () => setSidebarOpen(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setThreads((prevThreads) => {
        const tid = activeId || prevThreads[0]?.id;
        if (!tid) return prevThreads;
        const current = prevThreads.find((t) => t.id === tid)?.messages ?? [];
        const nextMsgs =
          typeof updater === "function" ? updater(current) : updater;
        return upsertThreadMessages(prevThreads, tid, nextMsgs);
      });
    },
    [activeId]
  );

  const appendTranscript = useCallback(
    (line: { id: string; role: "user" | "assistant"; content: string }) => {
      setMessages((prev) => {
        if (
          prev.some(
            (m) =>
              m.content === line.content &&
              m.role === line.role &&
              Date.now() - m.createdAt < 2000
          )
        ) {
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
    },
    [setMessages]
  );

  const runImagineRef = useRef<(p: string) => Promise<void>>(async () => {});

  const realtime = useRealtimeVoice({
    voice: voiceId,
    instructions: (() => {
      const mem = loadMemory();
      const name = mem.displayName ? ` The user's name is ${mem.displayName}.` : "";
      const notes = mem.notes.length
        ? ` Remember: ${mem.notes.slice(-8).join("; ")}.`
        : "";
      return `You are Grok Assistant, a warm voice companion powered by xAI Grok. Keep spoken answers clear, friendly, and concise.${name}${notes} Don't invent personal facts.`;
    })(),
    onError: (msg) => {
      if (msg) setError(msg);
    },
    onTranscript: (line) => {
      appendTranscript(line);
      // Voice → Imagine: spoken “draw a …” triggers image gen
      if (line.role === "user" && looksLikeImagine(line.content)) {
        void runImagineRef.current(line.content);
      }
    },
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, recording, imagining]);

  useEffect(() => {
    try {
      localStorage.setItem(TOOLS_KEY, toolsOn ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [toolsOn]);

  useEffect(() => {
    try {
      localStorage.setItem(IMAGINE_MODE_KEY, imagineMode ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [imagineMode]);

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
    setImagining(false);
  }, []);

  const extractImaginePrompt = (text: string) => {
    let t = text.trim();
    if (/^\/imagine\b/i.test(t)) {
      t = t.replace(/^\/imagine\s*/i, "").trim();
    }
    t = t
      .replace(/^imagine:\s*/i, "")
      .replace(
        /^(draw|paint|sketch|imagine)\s+(me\s+)?(a\s+|an\s+|the\s+)?/i,
        ""
      )
      .replace(
        /^(generate|create|make)\s+(me\s+)?(an?\s+)?(image|picture|photo|art|illustration)\s+(of\s+)?/i,
        ""
      )
      .trim();
    return t || text.trim();
  };

  const runImagine = useCallback(
    async (prompt: string) => {
      const p = prompt.trim();
      if (!p) {
        setError("Type a description first, then tap ✨ Imagine.");
        return;
      }
      if (loading || imagining) return;

      setError(null);
      setInput("");
      setPendingImages([]);

      const cleanPrompt = extractImaginePrompt(p);
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: `Imagine: ${cleanPrompt}`,
        createdAt: Date.now(),
      };
      const assistantId = uid();

      // Functional updates avoid stale thread messages
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: assistantId,
          role: "assistant",
          content: "Generating image with Grok Imagine…",
          createdAt: Date.now(),
        },
      ]);
      setImagining(true);
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await generateImage(cleanPrompt, {
          signal: controller.signal,
        });
        if (res.error) {
          setError(res.error);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `Couldn't generate image: ${res.error}` }
                : m
            )
          );
          return;
        }
        const urls = (res.images || []).map((i) => i.url).filter(Boolean);
        if (res.model) setModel(res.model);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: urls.length
                    ? "Here's what I imagined:"
                    : "(No image returned)",
                  generatedImages: urls.length ? urls : undefined,
                }
              : m
          )
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Imagine failed");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `Couldn't generate image: ${
                    err instanceof Error ? err.message : "failed"
                  }`,
                }
              : m
          )
        );
      } finally {
        setImagining(false);
        setLoading(false);
        abortRef.current = null;
      }
    },
    [loading, imagining, setMessages]
  );

  useEffect(() => {
    runImagineRef.current = runImagine;
  }, [runImagine]);

  const pushLocalReply = useCallback(
    (userText: string, reply: string) => {
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        content: userText,
        createdAt: Date.now(),
      };
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: reply,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
    },
    [setMessages]
  );

  const buildMemoryContext = useCallback((extra?: string) => {
    const mem = loadMemory();
    const tasks = loadTasks();
    const parts = [buildMemoryBlock(mem), formatTasksBlock(tasks)];
    if (extra?.trim()) parts.push(extra.trim());
    return parts.join("\n\n");
  }, []);

  const send = useCallback(
    async (text: string, images?: string[], opts?: { history?: ChatMessage[] }) => {
      const content = text.trim();
      const imgs = images ?? pendingImages;
      if ((!content && imgs.length === 0) || loading) return;

      const historyBase = opts?.history ?? messages;

      // Auto-route (modes still override)
      const route = autoRoute(content, {
        imagineMode,
        searchMode: toolsOn,
        hasImages: imgs.length > 0,
      });

      // --- Local commands (no LLM) ---
      if (content && imgs.length === 0 && route === "memory") {
        const r = handleMemoryCommand(content);
        if (r.handled) {
          setMemory(r.memory);
          setError(null);
          setInput("");
          pushLocalReply(content, r.reply);
          return;
        }
      }
      if (content && imgs.length === 0 && route === "task") {
        const r = handleTaskCommand(content);
        if (r.handled) {
          setTaskCount(r.tasks.filter((t) => !t.done).length);
          setError(null);
          setInput("");
          pushLocalReply(content, r.reply);
          return;
        }
      }

      // Imagine (mode or intent) — keep attached images out of pure image gen
      if (
        content &&
        imgs.length === 0 &&
        (route === "imagine" || imagineMode)
      ) {
        await runImagine(content);
        return;
      }

      setError(null);
      setInput("");
      // Keep images when coming from voice if caller passed them explicitly;
      // clear composer pending after send
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
      const next = [...historyBase, userMsg];
      setMessages([
        ...next,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: Date.now(),
        },
      ]);
      setLoading(true);
      setReasoning(false);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        let weatherContext: string | undefined;
        let planExtra = "";

        const needWeather =
          imgs.length === 0 &&
          (route === "weather" || route === "plan" || looksLikePlanDay(content));

        if (needWeather) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      route === "plan"
                        ? "Planning your day…"
                        : "Checking the weather…",
                  }
                : m
            )
          );
          const wx = await resolveWeatherForMessage(
            content || "weather",
            controller.signal
          );
          if (wx?.error && !wx.summary) {
            if (route === "weather") setError(wx.error);
          } else if (wx?.summary) {
            weatherContext = wx.summary;
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: "" } : m
            )
          );
        }

        if (route === "plan") {
          planExtra =
            "The user asked to plan their day. Use TASKS + WEATHER (if present) to propose a practical schedule. Be concrete and encouraging.";
        }

        // Auto-enable search tools when route says so (or Search mode)
        const useTools = toolsOn || route === "search";

        // Multimodal voice note for the model
        let visionExtra = "";
        if (imgs.length) {
          visionExtra =
            "The user attached image(s). Describe and answer using what you see.";
        }

        const memoryContext = buildMemoryContext(
          [planExtra, visionExtra].filter(Boolean).join("\n")
        );

        let citations: string[] | undefined;
        const res = await streamChat(next, {
          signal: controller.signal,
          tools: useTools,
          weatherContext,
          memoryContext,
          onModel: (m) => setModel(m),
          onReasoning: () => setReasoning(true),
          onCitations: (c) => {
            citations = c;
          },
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
          setError(res.error + " — tap Regenerate on the last reply to retry.");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: m.content.trim()
                      ? m.content
                      : `Something went wrong: ${res.error}`,
                  }
                : m
            )
          );
          return;
        }

        if (res.model) setModel(res.model);
        const finalText = res.content?.trim() || "(Empty reply)";
        const cites = res.citations || citations;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: finalText,
                  citations: cites?.length ? cites : undefined,
                }
              : m
          )
        );

        if (autoSpeak && finalText && finalText !== "(Empty reply)") {
          void playSpeech(finalText, assistantId);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Request failed");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content.trim()
                    ? m.content
                    : "Request failed — try Regenerate.",
                }
              : m
          )
        );
      } finally {
        setLoading(false);
        setReasoning(false);
        abortRef.current = null;
      }
    },
    [
      loading,
      messages,
      autoSpeak,
      playSpeech,
      pendingImages,
      toolsOn,
      imagineMode,
      setMessages,
      runImagine,
      pushLocalReply,
      buildMemoryContext,
    ]
  );

  /** Regenerate last assistant reply from last user message. */
  const regenerate = useCallback(async () => {
    if (loading) return;
    const list = messages;
    let lastUserIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;
    const userMsg = list[lastUserIdx];
    const history = list.slice(0, lastUserIdx);
    setMessages(history);
    await send(userMsg.content, userMsg.images, { history });
  }, [loading, messages, setMessages, send]);

  /** Edit last user message: put text in box, drop later turns. */
  const editLastUser = useCallback(() => {
    if (loading) return;
    const list = messages;
    let lastUserIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;
    const userMsg = list[lastUserIdx];
    setInput(userMsg.content);
    if (userMsg.images?.length) setPendingImages(userMsg.images);
    setMessages(list.slice(0, lastUserIdx));
    textareaRef.current?.focus();
  }, [loading, messages, setMessages]);

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
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
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
      // Keep pending images for multimodal voice+vision
      const imgs = pendingImages.length ? [...pendingImages] : undefined;
      await send(text, imgs);
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

  const switchThread = (id: string) => {
    if (loading) stop();
    stopAudio();
    if (realtime.status === "live" || realtime.status === "connecting") {
      realtime.disconnect();
    }
    setActiveId(id);
    saveActiveThreadId(id);
    setPendingImages([]);
    setError(null);
    setSidebarOpen(false);
  };

  const newChat = () => {
    if (loading) stop();
    stopAudio();
    if (realtime.status === "live" || realtime.status === "connecting") {
      realtime.disconnect();
    }
    const { threads: next, thread } = createThread(threads);
    setThreads(next);
    setActiveId(thread.id);
    setPendingImages([]);
    setError(null);
    setModel(null);
    setSidebarOpen(false);
  };

  const removeThread = (id: string) => {
    if (!confirm("Delete this chat?")) return;
    if (loading) stop();
    const { threads: next, activeId: nextActive } = deleteThread(threads, id);
    setThreads(next);
    setActiveId(nextActive);
  };

  const onRename = (id: string) => {
    const t = threads.find((x) => x.id === id);
    const name = prompt("Rename chat", t?.title || "");
    if (name == null) return;
    setThreads(renameThread(threads, id, name));
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

  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

  const setMode = (mode: "chat" | "imagine" | "search") => {
    if (mode === "imagine") {
      setImagineMode(true);
      setToolsOn(false);
    } else if (mode === "search") {
      setToolsOn(true);
      setImagineMode(false);
    } else {
      setImagineMode(false);
      setToolsOn(false);
    }
  };

  const activeMode: "chat" | "imagine" | "search" = imagineMode
    ? "imagine"
    : toolsOn
      ? "search"
      : "chat";

  return (
    <div className={`app ${sidebarOpen ? "sidebar-open" : ""}`}>
      <aside className="sidebar" aria-label="Navigation">
        <div className="sidebar-brand">
          <span className="logo" aria-hidden="true">
            ✦
          </span>
          <div>
            <div className="sidebar-brand-title">Grok</div>
            <div className="sidebar-brand-sub">Assistant</div>
          </div>
        </div>

        <button type="button" className="btn new-chat-btn" onClick={newChat}>
          <span aria-hidden="true">＋</span> New chat
        </button>

        <div className="sidebar-section-label">Chats</div>
        <ul className="thread-list">
          {sortedThreads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={`thread-item ${t.id === activeId ? "active" : ""}`}
                onClick={() => switchThread(t.id)}
                onDoubleClick={() => onRename(t.id)}
                title="Double-click to rename"
              >
                <span className="thread-title">{t.title}</span>
              </button>
              <button
                type="button"
                className="thread-del"
                aria-label="Delete chat"
                onClick={() => removeThread(t.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <div className="sidebar-foot">
          <button
            type="button"
            className={`settings-toggle ${settingsOpen ? "open" : ""}`}
            onClick={() => setSettingsOpen((o) => !o)}
            aria-expanded={settingsOpen}
          >
            <span>⚙ Settings</span>
            <span className="chevron" aria-hidden="true">
              {settingsOpen ? "▾" : "▸"}
            </span>
          </button>

          {settingsOpen ? (
            <div className="settings-panel">
              <label className="settings-row">
                <span>Voice</span>
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

              <label className="settings-row switch-row">
                <span>Auto-speak replies</span>
                <input
                  type="checkbox"
                  checked={autoSpeak}
                  onChange={toggleAutoSpeak}
                  disabled={realtime.status === "live"}
                />
              </label>

              <label className="settings-row switch-row">
                <span>Imagine mode default</span>
                <input
                  type="checkbox"
                  checked={imagineMode}
                  onChange={() =>
                    setMode(imagineMode ? "chat" : "imagine")
                  }
                />
              </label>

              <label className="settings-row switch-row">
                <span>Web / X search default</span>
                <input
                  type="checkbox"
                  checked={toolsOn}
                  onChange={() => setMode(toolsOn ? "chat" : "search")}
                  disabled={imagineMode}
                />
              </label>

              <label className="settings-row city-row">
                <span>Default city (weather)</span>
                <input
                  type="text"
                  className="settings-city"
                  placeholder="e.g. Toronto"
                  value={defaultCity}
                  onChange={(e) => setDefaultCityState(e.target.value)}
                  onBlur={() => setDefaultCity(defaultCity)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setDefaultCity(defaultCity);
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
              </label>
              <p className="settings-meta">
                Weather without a place · {taskCount} open tasks
              </p>

              <label className="settings-row">
                <span>Answer style</span>
                <select
                  value={memory.style}
                  onChange={(e) => {
                    const s = e.target.value as UserMemory["style"];
                    setMemory(setStyle(s));
                  }}
                >
                  <option value="balanced">Balanced</option>
                  <option value="concise">Concise</option>
                  <option value="detailed">Detailed</option>
                  <option value="witty">Witty</option>
                </select>
              </label>

              <label className="settings-row city-row">
                <span>Your name</span>
                <input
                  type="text"
                  className="settings-city"
                  placeholder="Optional"
                  value={memory.displayName}
                  onChange={(e) =>
                    setMemory((m) => ({ ...m, displayName: e.target.value }))
                  }
                  onBlur={() => {
                    setMemory(setDisplayName(memory.displayName));
                  }}
                />
              </label>

              {memory.notes.length > 0 ? (
                <p className="settings-meta">
                  Memory notes: {memory.notes.length} · say “show memory”
                </p>
              ) : (
                <p className="settings-meta">
                  Say “remember that …” to teach me
                </p>
              )}

              <div className="settings-backup">
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => downloadBackupFile()}
                >
                  Export backup
                </button>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => importRef.current?.click()}
                >
                  Import
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const r = await importBackupFile(f);
                    if (!r.ok) {
                      setError(r.error);
                    } else {
                      setMemory(loadMemory());
                      setDefaultCityState(getDefaultCity());
                      setTaskCount(loadTasks().filter((t) => !t.done).length);
                      setThreads(loadThreads());
                      setActiveId(loadActiveThreadId(loadThreads()));
                      setError(null);
                      window.location.reload();
                    }
                    e.target.value = "";
                  }}
                />
              </div>

              <button
                type="button"
                className={`btn live settings-live ${
                  realtime.status === "live"
                    ? "live-on"
                    : realtime.status === "connecting"
                      ? "live-connecting"
                      : ""
                }`}
                onClick={() => void toggleLiveVoice()}
              >
                {realtime.status === "live"
                  ? "● End Live voice"
                  : realtime.status === "connecting"
                    ? "Connecting…"
                    : "🎙 Start Live voice"}
              </button>

              {model ? (
                <p className="settings-meta">Model · {model}</p>
              ) : null}
              <p className="settings-meta">History saved on this device</p>
            </div>
          ) : null}
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className="main-col">
        <header className="topbar">
          <button
            type="button"
            className="btn ghost icon-btn menu-btn"
            aria-label="Open menu"
            onClick={() => setSidebarOpen((o) => !o)}
          >
            ☰
          </button>
          <div className="topbar-title">
            <span className="topbar-thread">{activeThread?.title || "Grok"}</span>
            {model ? <span className="model"> · {model}</span> : null}
          </div>
          <div className="topbar-spacer" />
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
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => realtime.disconnect()}
            >
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
                <h2>What do you want to know?</h2>
                <p>
                  Chat, search the web, generate images, or talk live — pick a
                  mode below the box.
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
                  !imagining &&
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
                    <div
                      className={`bubble ${
                        isStreaming && !m.content ? "thinking" : ""
                      }`}
                    >
                      <div className="bubble-label-row">
                        <div className="bubble-label">
                          {m.role === "assistant" ? "Grok" : "You"}
                        </div>
                        <div className="bubble-actions">
                          {m.role === "assistant" && m.content ? (
                            <button
                              type="button"
                              className="speak-btn"
                              onClick={() => {
                                if (speakingId === m.id) stopAudio();
                                else void playSpeech(m.content, m.id);
                              }}
                              aria-label={
                                speakingId === m.id
                                  ? "Stop speaking"
                                  : "Speak reply"
                              }
                              disabled={isStreaming || loading}
                            >
                              {speakingId === m.id ? "⏹" : "🔊"}
                            </button>
                          ) : null}
                          {m.role === "assistant" &&
                          m.id === messages[messages.length - 1]?.id &&
                          !isStreaming ? (
                            <button
                              type="button"
                              className="speak-btn"
                              onClick={() => void regenerate()}
                              disabled={loading}
                              title="Regenerate"
                            >
                              ↻
                            </button>
                          ) : null}
                          {m.role === "user" &&
                          m.id ===
                            [...messages].reverse().find((x) => x.role === "user")
                              ?.id ? (
                            <button
                              type="button"
                              className="speak-btn"
                              onClick={() => editLastUser()}
                              disabled={loading}
                              title="Edit & resend"
                            >
                              ✎
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {isStreaming && !m.content ? (
                        <>
                          <span className="dot" />
                          <span className="dot" />
                          <span className="dot" />
                          {reasoning ? (
                            <span className="thinking-label">
                              {toolsOn ? "Searching…" : "Thinking…"}
                            </span>
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
                                  <img
                                    src={src}
                                    alt={`Attachment ${i + 1}`}
                                    className="msg-image"
                                  />
                                </a>
                              ))}
                            </div>
                          ) : null}
                          {m.generatedImages?.length ? (
                            <div className="msg-images gen">
                              {m.generatedImages.map((src, i) => (
                                <GeneratedImageCard
                                  key={i}
                                  src={src}
                                  index={i}
                                  onNotice={(msg) => setError(msg)}
                                />
                              ))}
                            </div>
                          ) : null}
                          {m.content ? formatContent(m.content) : null}
                          {m.citations?.length ? (
                            <ul className="citations">
                              {m.citations.slice(0, 6).map((url) => (
                                <li key={url}>
                                  <a href={url} target="_blank" rel="noreferrer">
                                    {prettyHost(url)}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {isStreaming ? (
                            <span className="stream-cursor" aria-hidden="true" />
                          ) : null}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
              {transcribing || imagining ? (
                <article className="bubble-row assistant">
                  <div className="avatar" aria-hidden="true">
                    ✦
                  </div>
                  <div className="bubble thinking">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                    <span className="thinking-label">
                      {imagining ? "Imagining…" : "Transcribing…"}
                    </span>
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

          <div className="mode-pills" role="tablist" aria-label="Mode">
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "chat"}
              className={`mode-pill ${activeMode === "chat" ? "active" : ""}`}
              onClick={() => setMode("chat")}
            >
              Chat
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "imagine"}
              className={`mode-pill ${activeMode === "imagine" ? "active" : ""}`}
              onClick={() => setMode("imagine")}
            >
              ✨ Imagine
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "search"}
              className={`mode-pill ${activeMode === "search" ? "active" : ""}`}
              onClick={() => setMode("search")}
            >
              🔍 Search
            </button>
            <button
              type="button"
              className={`mode-pill live-pill ${
                realtime.status === "live" ? "active live" : ""
              }`}
              onClick={() => void toggleLiveVoice()}
            >
              {realtime.status === "live"
                ? "● Live"
                : realtime.status === "connecting"
                  ? "…"
                  : "🎙 Voice"}
            </button>
          </div>

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
                    : imagineMode
                      ? "Describe an image to generate…"
                      : toolsOn
                        ? "Ask with live web & X search…"
                        : "What do you want to know?"
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
                className={`btn primary ${imagineMode ? "imagine-submit" : ""}`}
                disabled={
                  transcribing ||
                  attaching ||
                  (!input.trim() && pendingImages.length === 0)
                }
              >
                {imagineMode ? "Generate" : "Send"}
              </button>
            )}
          </form>
        </footer>
      </div>
    </div>
  );
}

function prettyHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

function GeneratedImageCard({
  src,
  index,
  onNotice,
}: {
  src: string;
  index: number;
  onNotice: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState<"dl" | "copy" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const flashMsg = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2000);
  };

  const onDownload = async () => {
    setBusy("dl");
    onNotice(null);
    try {
      await downloadImage(src, `grok-imagine-${index + 1}`);
      flashMsg("Downloaded");
    } catch (err) {
      onNotice(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(null);
    }
  };

  const onCopy = async () => {
    setBusy("copy");
    onNotice(null);
    try {
      const kind = await copyImage(src);
      flashMsg(kind === "image" ? "Copied image" : "Copied link");
    } catch (err) {
      onNotice(
        err instanceof Error
          ? err.message
          : "Copy failed — try Download instead"
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="gen-card">
      <button
        type="button"
        className="msg-image-link gen"
        onClick={() => openImage(src)}
        title="Open full size"
      >
        <img
          src={src}
          alt={`Generated ${index + 1}`}
          className="msg-image"
          loading="lazy"
          onError={(e) => {
            const el = e.currentTarget;
            el.style.opacity = "0.4";
            el.alt = "Image failed to load";
          }}
        />
      </button>
      <div className="gen-actions">
        <button
          type="button"
          className="btn ghost sm gen-action"
          onClick={() => void onDownload()}
          disabled={busy !== null}
          title="Download image"
        >
          {busy === "dl" ? "…" : "⬇ Download"}
        </button>
        <button
          type="button"
          className="btn ghost sm gen-action"
          onClick={() => void onCopy()}
          disabled={busy !== null}
          title="Copy image to clipboard"
        >
          {busy === "copy" ? "…" : "⧉ Copy"}
        </button>
        <button
          type="button"
          className="btn ghost sm gen-action"
          onClick={() => openImage(src)}
          title="Open full size"
        >
          ↗ Open
        </button>
        {flash ? <span className="gen-flash">{flash}</span> : null}
      </div>
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
