import { formatCalendarBlock, loadEvents } from "./calendar";
import { formatEmailBlock, loadDrafts } from "./email";
import { buildMemoryBlock, loadMemory } from "./memory";
import { formatTasksBlock, loadTasks } from "./tasks";
import {
  getDefaultCity,
  resolveWeatherForMessage,
} from "./weather";

export function looksLikeBriefing(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /^(good\s+)?morning\b/.test(t) ||
    /^(brief me|briefing|daily briefing|morning briefing|morning brief)\b/.test(
      t
    ) ||
    /^(start my day|catch me up|what's on today|whats on today)\??$/.test(t) ||
    /\b(morning briefing|daily briefing|brief me for today)\b/.test(t)
  );
}

export function timeOfDayLabel(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "late night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

/**
 * Gather local + live data for a morning / daily briefing.
 */
export async function assembleBriefing(signal?: AbortSignal): Promise<{
  contextBlock: string;
  systemExtra: string;
  userPrompt: string;
  weatherOk: boolean;
  weatherError?: string;
}> {
  const now = new Date();
  const mem = loadMemory();
  const tasks = loadTasks().filter((t) => !t.done);
  const events = loadEvents().filter((e) => {
    const t = new Date(e.start).getTime();
    return t >= now.getTime() - 3600000;
  });
  const drafts = loadDrafts();
  const city = getDefaultCity();

  let weatherSummary = "";
  let weatherOk = false;
  let weatherError: string | undefined;

  const wxQuery = city
    ? `weather in ${city}`
    : "what's the weather today";
  try {
    const wx = await resolveWeatherForMessage(wxQuery, signal);
    if (wx?.summary) {
      weatherSummary = wx.summary;
      weatherOk = true;
    } else if (wx?.error) {
      weatherError = wx.error;
    }
  } catch (e) {
    weatherError = e instanceof Error ? e.message : "Weather unavailable";
  }

  const localDate = now.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const parts = [
    `BRIEFING SNAPSHOT`,
    `Local time: ${localDate} (${timeOfDayLabel(now)})`,
    mem.displayName ? `User name: ${mem.displayName}` : "User name: (unknown)",
    "",
    buildMemoryBlock(mem),
    "",
    formatTasksBlock(tasks),
    "",
    formatCalendarBlock(events),
    "",
    formatEmailBlock(drafts),
  ];

  if (weatherSummary) {
    parts.push("", "--- LIVE WEATHER ---", weatherSummary, "--- END WEATHER ---");
  } else if (weatherError) {
    parts.push("", `WEATHER: unavailable (${weatherError})`);
  } else {
    parts.push(
      "",
      "WEATHER: not loaded — suggest setting a default city in Settings."
    );
  }

  const systemExtra = [
    "You are delivering a concise daily briefing.",
    "Structure:",
    "1) Warm greeting (use name if known)",
    "2) Weather (use live data only; say if missing)",
    "3) Today's calendar / upcoming events",
    "4) Open tasks (prioritize 3 max)",
    "5) Email drafts waiting (if any)",
    "6) One clear suggested next action",
    "Keep it scannable with short bullets. No fluff. Under ~200 words unless they ask for more.",
  ].join("\n");

  const nameBit = mem.displayName ? ` for ${mem.displayName}` : "";
  const userPrompt = `Give me my ${timeOfDayLabel(now)} briefing${nameBit}. Use the BRIEFING SNAPSHOT as ground truth.`;

  return {
    contextBlock: parts.join("\n"),
    systemExtra,
    userPrompt,
    weatherOk,
    weatherError,
  };
}
