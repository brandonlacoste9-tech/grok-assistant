import { loadMemory, saveMemory, type UserMemory } from "./memory";
import { loadTasks, saveTasks, type Task } from "./tasks";
import {
  loadThreads,
  saveThreads,
  loadActiveThreadId,
  saveActiveThreadId,
} from "./threads";
import type { ChatThread } from "./types";
import { getDefaultCity, setDefaultCity } from "./weather";

export type BackupPayload = {
  version: 1;
  exportedAt: string;
  memory: UserMemory;
  tasks: Task[];
  threads: ChatThread[];
  activeThreadId: string;
  defaultCity: string;
  toolsOn?: boolean;
  imagineMode?: boolean;
  voiceId?: string;
  autoSpeak?: boolean;
};

export function exportBackup(): BackupPayload {
  const threads = loadThreads();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    memory: loadMemory(),
    tasks: loadTasks(),
    threads,
    activeThreadId: loadActiveThreadId(threads),
    defaultCity: getDefaultCity(),
    toolsOn: localStorage.getItem("grok_assistant_tools_on") === "1",
    imagineMode: localStorage.getItem("grok_assistant_imagine_mode") === "1",
    voiceId: localStorage.getItem("grok_assistant_voice_id") || undefined,
    autoSpeak: localStorage.getItem("grok_assistant_auto_speak") !== "0",
  };
}

export function downloadBackupFile() {
  const data = exportBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `grok-assistant-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function importBackup(raw: unknown): { ok: true } | { ok: false; error: string } {
  try {
    const data = raw as BackupPayload;
    if (!data || data.version !== 1) {
      return { ok: false, error: "Unsupported backup format" };
    }
    if (data.memory) saveMemory(data.memory);
    if (Array.isArray(data.tasks)) saveTasks(data.tasks);
    if (Array.isArray(data.threads) && data.threads.length) {
      saveThreads(data.threads);
      if (data.activeThreadId) saveActiveThreadId(data.activeThreadId);
    }
    if (typeof data.defaultCity === "string") setDefaultCity(data.defaultCity);
    if (typeof data.toolsOn === "boolean") {
      localStorage.setItem("grok_assistant_tools_on", data.toolsOn ? "1" : "0");
    }
    if (typeof data.imagineMode === "boolean") {
      localStorage.setItem(
        "grok_assistant_imagine_mode",
        data.imagineMode ? "1" : "0"
      );
    }
    if (data.voiceId) localStorage.setItem("grok_assistant_voice_id", data.voiceId);
    if (typeof data.autoSpeak === "boolean") {
      localStorage.setItem(
        "grok_assistant_auto_speak",
        data.autoSpeak ? "1" : "0"
      );
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Import failed",
    };
  }
}

export async function importBackupFile(file: File) {
  const text = await file.text();
  const json = JSON.parse(text);
  return importBackup(json);
}
