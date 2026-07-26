/**
 * Realtime Grok speech-to-speech via xAI WebSocket + ephemeral tokens.
 * Protocol adapted from xAI cookbook voice web agent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { base64PCM16ToFloat32, float32ToPCM16Base64 } from "../lib/pcm";

const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime";
const CHUNK_MS = 100;

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "live"
  | "error"
  | "ended";

export type TranscriptLine = {
  id: string;
  role: "user" | "assistant";
  content: string;
  partial?: boolean;
};

type SessionPayload = {
  value?: string;
  expires_at?: number;
  client_secret?: { value: string; expires_at?: number };
  voice?: string;
  instructions?: string;
  model?: string;
  error?: string;
};

export function useRealtimeVoice(options?: {
  voice?: string;
  instructions?: string;
  onError?: (msg: string) => void;
  onTranscript?: (line: TranscriptLine) => void;
}) {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [userPartial, setUserPartial] = useState("");
  const [assistantPartial, setAssistantPartial] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionReadyRef = useRef(false);
  const sampleRateRef = useRef(24000);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playQueueRef = useRef<Float32Array[]>([]);
  const playingRef = useRef(false);
  const playSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const assistantBufRef = useRef("");
  const userBufRef = useRef("");
  const optsRef = useRef(options);
  optsRef.current = options;

  const stopPlayback = useCallback(() => {
    if (playSourceRef.current) {
      try {
        playSourceRef.current.stop();
        playSourceRef.current.disconnect();
      } catch {
        /* ignore */
      }
      playSourceRef.current = null;
    }
    playQueueRef.current = [];
    playingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const playNext = useCallback((ctx: AudioContext) => {
    if (playQueueRef.current.length === 0) {
      playingRef.current = false;
      playSourceRef.current = null;
      setIsSpeaking(false);
      return;
    }
    setIsSpeaking(true);
    const chunk = playQueueRef.current.shift()!;
    const buffer = ctx.createBuffer(1, chunk.length, ctx.sampleRate);
    buffer.getChannelData(0).set(chunk);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    playSourceRef.current = src;
    src.onended = () => {
      if (playSourceRef.current === src) playSourceRef.current = null;
      playNext(ctx);
    };
    src.start();
  }, []);

  const enqueueAudio = useCallback(
    (b64: string) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const f32 = base64PCM16ToFloat32(b64);
      playQueueRef.current.push(f32);
      if (!playingRef.current) {
        playingRef.current = true;
        playNext(ctx);
      }
    },
    [playNext]
  );

  const stopCapture = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setAudioLevel(0);
  }, []);

  const disconnect = useCallback(() => {
    stopCapture();
    stopPlayback();
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
    sessionReadyRef.current = false;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setStatus((s) => (s === "error" ? "error" : "ended"));
    setUserPartial("");
    setAssistantPartial("");
  }, [stopCapture, stopPlayback]);

  const startCapture = useCallback(
    async (ws: WebSocket) => {
      const ctx = audioCtxRef.current!;
      if (ctx.state === "suspended") await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      sampleRateRef.current = ctx.sampleRate;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      let buffers: Float32Array[] = [];
      let total = 0;
      const chunkSamples = (ctx.sampleRate * CHUNK_MS) / 1000;

      processor.onaudioprocess = (ev) => {
        if (!sessionReadyRef.current || ws.readyState !== WebSocket.OPEN) return;
        const input = ev.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        setAudioLevel(Math.sqrt(sum / input.length));

        buffers.push(new Float32Array(input));
        total += input.length;

        while (total >= chunkSamples) {
          const chunk = new Float32Array(chunkSamples);
          let offset = 0;
          while (offset < chunkSamples && buffers.length) {
            const buf = buffers[0];
            const need = chunkSamples - offset;
            if (buf.length <= need) {
              chunk.set(buf, offset);
              offset += buf.length;
              total -= buf.length;
              buffers.shift();
            } else {
              chunk.set(buf.subarray(0, need), offset);
              buffers[0] = buf.subarray(need);
              offset += need;
              total -= need;
            }
          }
          const audio = float32ToPCM16Base64(chunk);
          ws.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio,
            })
          );
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);
    },
    []
  );

  const configureSession = useCallback(
    (ws: WebSocket, voice: string, instructions: string, sampleRate: number) => {
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            instructions,
            voice,
            audio: {
              input: { format: { type: "audio/pcm", rate: sampleRate } },
              output: { format: { type: "audio/pcm", rate: sampleRate } },
            },
            turn_detection: { type: "server_vad" },
          },
        })
      );
    },
    []
  );

  const greet = useCallback((ws: WebSocket) => {
    ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Say a short friendly hello and that you're ready to talk.",
            },
          ],
        },
      })
    );
    ws.send(JSON.stringify({ type: "response.create" }));
  }, []);

  const connect = useCallback(async () => {
    if (status === "connecting" || status === "live") return;
    setStatus("connecting");
    optsRef.current?.onError?.("");

    try {
      const voice = optsRef.current?.voice || "eve";
      const instructions =
        optsRef.current?.instructions ||
        "You are Grok Assistant, a warm voice companion powered by xAI Grok. Keep answers spoken-friendly and concise.";

      const res = await fetch("/api/realtime-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice, instructions, expires_seconds: 300 }),
      });
      const data = (await res.json()) as SessionPayload;
      if (!res.ok || data.error) {
        throw new Error(data.error || `Session failed (${res.status})`);
      }

      const token = data.value || data.client_secret?.value;
      if (!token) throw new Error("No ephemeral token in session response");

      const model = data.model || "grok-voice-latest";
      const url = `${XAI_REALTIME_URL}?model=${encodeURIComponent(model)}`;

      // Browser auth: subprotocol carries the client secret (no Authorization header)
      const ws = new WebSocket(url, [
        "realtime",
        `openai-insecure-api-key.${token}`,
        "openai-beta.realtime-v1",
      ]);

      // Fallback protocol if first form fails — some docs use xai-client-secret.
      // We rely on cookbook-tested form above.

      wsRef.current = ws;
      sessionReadyRef.current = false;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate;

      await new Promise<void>((resolve, reject) => {
        const t = window.setTimeout(
          () => reject(new Error("WebSocket connect timeout")),
          15000
        );
        ws.onopen = () => {
          window.clearTimeout(t);
          resolve();
        };
        ws.onerror = () => {
          window.clearTimeout(t);
          reject(new Error("WebSocket connection failed"));
        };
      });

      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        const type = String(msg.type || "");

        if (
          (type === "conversation.created" || type === "session.created") &&
          !sessionReadyRef.current
        ) {
          configureSession(
            ws,
            data.voice || voice,
            data.instructions || instructions,
            sampleRateRef.current
          );
        }

        if (type === "session.updated" && !sessionReadyRef.current) {
          sessionReadyRef.current = true;
          setStatus("live");
          void startCapture(ws).then(() => greet(ws)).catch((e) => {
            optsRef.current?.onError?.(
              e instanceof Error ? e.message : "Mic failed"
            );
          });
        }

        if (type === "input_audio_buffer.speech_started") {
          stopPlayback();
          userBufRef.current = "";
          setUserPartial("…");
        }

        if (type === "conversation.item.input_audio_transcription.delta") {
          const d = String(msg.delta || "");
          userBufRef.current += d;
          setUserPartial(userBufRef.current);
        }

        if (
          type === "conversation.item.input_audio_transcription.completed" ||
          type === "conversation.item.input_audio_transcription.done"
        ) {
          const text =
            String(msg.transcript || msg.text || userBufRef.current || "").trim();
          if (text) {
            optsRef.current?.onTranscript?.({
              id: `u_${Date.now()}`,
              role: "user",
              content: text,
            });
          }
          userBufRef.current = "";
          setUserPartial("");
        }

        if (type === "response.output_audio.delta" && typeof msg.delta === "string") {
          enqueueAudio(msg.delta);
        }

        if (type === "response.output_audio_transcript.delta") {
          const d = String(msg.delta || "");
          assistantBufRef.current += d;
          setAssistantPartial(assistantBufRef.current);
        }

        if (
          type === "response.output_audio_transcript.done" ||
          type === "response.done"
        ) {
          const text = assistantBufRef.current.trim();
          if (text && type === "response.done") {
            optsRef.current?.onTranscript?.({
              id: `a_${Date.now()}`,
              role: "assistant",
              content: text,
            });
            assistantBufRef.current = "";
            setAssistantPartial("");
          }
        }

        if (type === "error") {
          const err = msg.error as { message?: string } | undefined;
          const message =
            err?.message || String(msg.message || "Realtime voice error");
          optsRef.current?.onError?.(message);
        }
      };

      ws.onclose = () => {
        stopCapture();
        sessionReadyRef.current = false;
        setStatus((s) => (s === "connecting" ? "error" : "ended"));
      };

      ws.onerror = () => {
        optsRef.current?.onError?.("Realtime connection error");
      };
    } catch (err) {
      setStatus("error");
      optsRef.current?.onError?.(
        err instanceof Error ? err.message : "Failed to start live voice"
      );
      disconnect();
    }
  }, [
    status,
    configureSession,
    startCapture,
    greet,
    enqueueAudio,
    stopPlayback,
    stopCapture,
    disconnect,
  ]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    audioLevel,
    userPartial,
    assistantPartial,
    isSpeaking,
    connect,
    disconnect,
  };
}
