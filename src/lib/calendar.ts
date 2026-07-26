import { scopedKey } from "./storageScope";

export type CalEvent = {
  id: string;
  title: string;
  start: string; // ISO local-ish datetime
  end?: string;
  location?: string;
  notes?: string;
  createdAt: number;
};

const KEY_BASE = "grok_assistant_calendar_v1";

function key() {
  return scopedKey(KEY_BASE);
}

function uid() {
  return (
    crypto.randomUUID?.() ??
    `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
}

export function loadEvents(): CalEvent[] {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return [];
    const p = JSON.parse(raw) as CalEvent[];
    if (!Array.isArray(p)) return [];
    return p
      .filter((e) => e && typeof e.title === "string" && e.start)
      .sort((a, b) => a.start.localeCompare(b.start));
  } catch {
    return [];
  }
}

export function saveEvents(events: CalEvent[]) {
  try {
    localStorage.setItem(key(), JSON.stringify(events.slice(-80)));
  } catch {
    /* ignore */
  }
}

export function addEvent(
  partial: Omit<CalEvent, "id" | "createdAt">
): CalEvent[] {
  const events = loadEvents();
  events.push({
    ...partial,
    title: partial.title.trim(),
    id: uid(),
    createdAt: Date.now(),
  });
  events.sort((a, b) => a.start.localeCompare(b.start));
  saveEvents(events);
  return events;
}

export function removeEvent(id: string): CalEvent[] {
  const events = loadEvents().filter((e) => e.id !== id);
  saveEvents(events);
  return events;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Format for Google Calendar template dates: YYYYMMDDTHHmmss */
export function toGoogleDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export function googleCalendarUrl(event: {
  title: string;
  start: string;
  end?: string;
  location?: string;
  notes?: string;
}): string {
  const start = toGoogleDate(event.start);
  let end = event.end ? toGoogleDate(event.end) : "";
  if (!end && start) {
    // default 1 hour
    const d = new Date(event.start);
    d.setHours(d.getHours() + 1);
    end = toGoogleDate(d.toISOString());
  }
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${start}/${end}`,
  });
  if (event.location) params.set("location", event.location);
  if (event.notes) params.set("details", event.notes);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Simple ICS for download / Apple Calendar */
export function toIcs(event: CalEvent): string {
  const dt = (iso: string) => {
    const g = toGoogleDate(iso);
    return g || iso.replace(/[-:]/g, "").slice(0, 15);
  };
  const end =
    event.end ||
    new Date(new Date(event.start).getTime() + 3600000).toISOString();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Grok Assistant//EN",
    "BEGIN:VEVENT",
    `UID:${event.id}@grok-assistant`,
    `DTSTAMP:${dt(new Date().toISOString())}`,
    `DTSTART:${dt(event.start)}`,
    `DTEND:${dt(end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
  ];
  if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
  if (event.notes) lines.push(`DESCRIPTION:${escapeIcs(event.notes)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

function escapeIcs(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export function downloadIcs(event: CalEvent) {
  const blob = new Blob([toIcs(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.replace(/\s+/g, "-").slice(0, 40) || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function formatCalendarBlock(events: CalEvent[]): string {
  const now = Date.now();
  const upcoming = events.filter((e) => {
    const t = new Date(e.start).getTime();
    return !Number.isNaN(t) && t >= now - 3600000;
  });
  if (!upcoming.length) return "CALENDAR: (no upcoming events)";
  const lines = ["CALENDAR (upcoming):"];
  for (const e of upcoming.slice(0, 12)) {
    const when = new Date(e.start).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    lines.push(`  • ${when} — ${e.title}${e.location ? ` @ ${e.location}` : ""}`);
  }
  return lines.join("\n");
}

/**
 * Parse natural-ish commands:
 * - schedule meeting with Sam tomorrow at 3pm
 * - add event Dentist on 2026-08-01 at 10:00
 * - show calendar / my events
 */
export function handleCalendarCommand(
  text: string
):
  | { handled: true; reply: string; events: CalEvent[]; openGoogleUrl?: string }
  | { handled: false } {
  const t = text.trim();

  if (/^(show calendar|my (calendar|events)|list events|upcoming)\??$/i.test(t)) {
    const events = loadEvents();
    const upcoming = events.filter((e) => new Date(e.start).getTime() >= Date.now() - 3600000);
    if (!upcoming.length) {
      return {
        handled: true,
        reply:
          'No upcoming events. Try: “schedule Dentist tomorrow at 10am” or “add event Lunch Friday at 12:30”.',
        events,
      };
    }
    const lines = upcoming.slice(0, 20).map((e) => {
      const when = new Date(e.start).toLocaleString();
      return `• ${when} — ${e.title}`;
    });
    return { handled: true, reply: lines.join("\n"), events };
  }

  const m = t.match(
    /^(?:schedule|add event|calendar|book)\s+(.+?)(?:\s+(?:on|at|for)\s+.+)?$/i
  );
  // Richer parse
  const parsed = parseSchedulePhrase(t);
  if (parsed) {
    const events = addEvent(parsed);
    const latest =
      [...events].reverse().find((e) => e.title === parsed.title) ||
      events[events.length - 1];
    const gcal = googleCalendarUrl(latest);
    const when = new Date(latest.start).toLocaleString();
    return {
      handled: true,
      reply: `Added **${latest.title}** for ${when}.\n\n• [Open in Google Calendar](${gcal})\n• Say “show calendar” to list events.\n• ICS download is available from Settings → Calendar.`,
      events,
      openGoogleUrl: gcal,
    };
  }

  // fallback: schedule X
  if (m && !/^(schedule|add event)\s*$/i.test(t)) {
    // try simpler: "add event Title"
    const simple = t.match(/^(?:add event|schedule)\s+(.+)$/i);
    if (simple?.[1] && !parseSchedulePhrase(t)) {
      const start = defaultTomorrowAt(10, 0);
      const events = addEvent({ title: simple[1].trim(), start });
      const latest = events[events.length - 1];
      const gcal = googleCalendarUrl(latest);
      return {
        handled: true,
        reply: `Added “${latest.title}” tomorrow 10:00 (default time). Edit by removing and re-adding with a time.\n[Google Calendar](${gcal})`,
        events,
        openGoogleUrl: gcal,
      };
    }
  }

  return { handled: false };
}

export function looksLikeCalendarCmd(text: string): boolean {
  const t = text.trim();
  return (
    /^(?:schedule|add event|book|calendar)\b/i.test(t) ||
    /^(show calendar|my (calendar|events)|list events|upcoming)\??$/i.test(t)
  );
}

function defaultTomorrowAt(h: number, min: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, min, 0, 0);
  return d.toISOString();
}

function parseSchedulePhrase(
  text: string
): Omit<CalEvent, "id" | "createdAt"> | null {
  const t = text.trim();
  if (
    !/^(?:schedule|add event|book|calendar)\b/i.test(t) &&
    !/\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i.test(
      t
    )
  ) {
    if (!/^(?:schedule|add event)\b/i.test(t)) return null;
  }
  if (!/^(?:schedule|add event|book)\b/i.test(t)) return null;

  // strip command verb
  let rest = t
    .replace(/^(?:schedule|add event|book|calendar)\s+/i, "")
    .trim();
  if (!rest) return null;

  // extract time like 3pm, 15:00, at 10am
  let hour = 10;
  let minute = 0;
  const timeM = rest.match(
    /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
  );
  if (timeM) {
    hour = parseInt(timeM[1], 10);
    minute = timeM[2] ? parseInt(timeM[2], 10) : 0;
    const ap = (timeM[3] || "").toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    if (!ap && hour <= 7) hour += 12; // bare "3" → 3pm-ish for meetings? skip, keep 24h if >= 8
    rest = rest.replace(timeM[0], " ").replace(/\s+/g, " ").trim();
  }

  const day = new Date();
  day.setSeconds(0, 0);
  if (/\btomorrow\b/i.test(rest)) {
    day.setDate(day.getDate() + 1);
    rest = rest.replace(/\btomorrow\b/i, " ").trim();
  } else if (/\btoday\b/i.test(rest)) {
    rest = rest.replace(/\btoday\b/i, " ").trim();
  } else {
    const isoD = rest.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoD) {
      const [y, m, d] = isoD[1].split("-").map(Number);
      day.setFullYear(y, m - 1, d);
      rest = rest.replace(isoD[0], " ").trim();
    } else {
      const weekdays = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      for (let i = 0; i < 7; i++) {
        const re = new RegExp(`\\b${weekdays[i]}\\b`, "i");
        if (re.test(rest)) {
          const target = i;
          const cur = day.getDay();
          let add = (target - cur + 7) % 7;
          if (add === 0) add = 7;
          day.setDate(day.getDate() + add);
          rest = rest.replace(re, " ").trim();
          break;
        }
      }
      // if no day keyword, default tomorrow
      if (!timeM && !isoD) {
        // still allow "schedule X at 3pm" → today or tomorrow
      }
      if (
        !/\b(today|tomorrow)\b/i.test(text) &&
        !isoD &&
        !weekdays.some((w) => new RegExp(w, "i").test(text))
      ) {
        day.setDate(day.getDate() + 1);
      }
    }
  }

  day.setHours(hour, minute, 0, 0);

  // clean title
  let title = rest
    .replace(/\b(on|at|for)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  title = title.replace(/^with\s+/i, "with ");
  if (!title) title = "Event";

  const end = new Date(day.getTime() + 60 * 60 * 1000);

  return {
    title,
    start: day.toISOString(),
    end: end.toISOString(),
  };
}
