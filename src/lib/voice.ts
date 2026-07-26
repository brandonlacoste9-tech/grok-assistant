const VOICE_KEY = "grok_assistant_voice_id";
const AUTO_SPEAK_KEY = "grok_assistant_auto_speak";

export const VOICES = [
  { id: "eve", label: "Eve" },
  { id: "ara", label: "Ara" },
  { id: "rex", label: "Rex" },
  { id: "sal", label: "Sal" },
  { id: "leo", label: "Leo" },
] as const;

export function getVoiceId(): string {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    if (v && VOICES.some((x) => x.id === v)) return v;
  } catch {
    /* ignore */
  }
  return "eve";
}

export function setVoiceId(id: string) {
  localStorage.setItem(VOICE_KEY, id);
}

export function getAutoSpeak(): boolean {
  try {
    return localStorage.getItem(AUTO_SPEAK_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAutoSpeak(on: boolean) {
  localStorage.setItem(AUTO_SPEAK_KEY, on ? "1" : "0");
}

/** Speak text via Grok TTS (/api/tts). Returns HTMLAudioElement. */
export async function speakText(
  text: string,
  options?: { voice_id?: string; signal?: AbortSignal }
): Promise<HTMLAudioElement> {
  const clean = text.trim().slice(0, 4500);
  if (!clean) throw new Error("Nothing to speak");

  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: clean,
      voice_id: options?.voice_id || getVoiceId(),
      language: "en",
    }),
    signal: options?.signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error || `TTS failed (${res.status})`
    );
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  audio.onerror = () => URL.revokeObjectURL(url);
  await audio.play();
  return audio;
}

/** Transcribe mic audio via Grok STT */
export async function transcribeBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const audio_base64 = btoa(binary);

  const res = await fetch("/api/stt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audio_base64,
      mime_type: blob.type || "audio/webm",
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error || `STT failed (${res.status})`);
  }

  return (data.text || "").trim();
}

export function createRecorder(): Promise<{
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
}> {
  return navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    return { recorder, stream, chunks };
  });
}
