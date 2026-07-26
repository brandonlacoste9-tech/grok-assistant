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
  partial: Omit<CalEvent, "id" | "createdAt">,
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

export type EventLike = {
  id?: string;
  title: string;
  start: string;
  end?: string;
  location?: string;
  notes?: string;
};

function ensureEndIso(start: string, end?: string): string {
  if (end) return end;
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return start;
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

/** ISO without milliseconds/Z for Outlook deeplink (local-ish) */
function toOutlookDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function googleCalendarUrl(event: EventLike): string {
  const start = toGoogleDate(event.start);
  let end = event.end ? toGoogleDate(event.end) : "";
  if (!end && start) {
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

/**
 * Outlook on the web — works for outlook.live.com / Microsoft 365 accounts.
 * Opens “add event” compose with fields filled in.
 */
export function outlookCalendarUrl(event: EventLike): string {
  const end = ensureEndIso(event.start, event.end);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: toOutlookDate(event.start),
    enddt: toOutlookDate(end),
  });
  if (event.location) params.set("location", event.location);
  if (event.notes) params.set("body", event.notes);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

export function outlookOfficeCalendarUrl(event: EventLike): string {
  const end = ensureEndIso(event.start, event.end);
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: toOutlookDate(event.start),
    enddt: toOutlookDate(end),
  });
  if (event.location) params.set("location", event.location);
  if (event.notes) params.set("body", event.notes);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

export function eventExportLinks(event: EventLike) {
  return {
    google: googleCalendarUrl(event),
    outlook: outlookCalendarUrl(event),
    outlookOffice: outlookOfficeCalendarUrl(event),
  };
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
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function downloadIcs(event: CalEvent | EventLike) {
  const full: CalEvent = {
    id: "id" in event && event.id ? event.id : `tmp_${Date.now()}`,
    title: event.title,
    start: event.start,
    end: event.end,
    location: event.location,
    notes: event.notes,
    createdAt: Date.now(),
  };
  const blob = new Blob([toIcs(full)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.replace(/\s+/g, "-").slice(0, 40) || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function eventAddedReply(latest: CalEvent): {
  reply: string;
  openGoogleUrl: string;
  openOutlookUrl: string;
  event: CalEvent;
} {
  const links = eventExportLinks(latest);
  const when = new Date(latest.start).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    event: latest,
    openGoogleUrl: links.google,
    openOutlookUrl: links.outlook,
    reply: [
      `Got it — “${latest.title}” is set for ${when}.`,
      "",
      "Tap a button below to open it in your calendar (pre-filled):",
      "• Google Calendar",
      "• Outlook",
      "• Outlook 365",
      "• Download .ics (Apple / desktop)",
      "",
      "Say “show calendar” anytime to list upcoming events.",
    ].join("\n"),
  };
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
    lines.push(
      `  • ${when} — ${e.title}${e.location ? ` @ ${e.location}` : ""}`,
    );
  }
  return lines.join("\n");
}

/**
 * Parse natural-ish commands:
 * - schedule meeting with Sam tomorrow at 3pm
 * - i need to make an appointment for tomorrow at 5pm dentist
 * - dentist tomorrow 5pm
 * - show calendar / my events
 */
export function handleCalendarCommand(
  text: string,
):
  | {
      handled: true;
      reply: string;
      events: CalEvent[];
      openGoogleUrl?: string;
      openOutlookUrl?: string;
      event?: CalEvent;
    }
  | { handled: false } {
  const t = text.trim();

  if (/^(show calendar|my (calendar|events)|list events|upcoming)\??$/i.test(t)) {
    const events = loadEvents();
    const upcoming = events.filter(
      (e) => new Date(e.start).getTime() >= Date.now() - 3600000,
    );
    if (!upcoming.length) {
      return {
        handled: true,
        reply:
          'No upcoming events. Try: “dentist tomorrow at 5pm” or “schedule lunch Friday at 12:30”.',
        events,
      };
    }
    const lines = upcoming.slice(0, 12).map((e) => {
      const when = new Date(e.start).toLocaleString();
      const links = eventExportLinks(e);
      return `• ${when} — ${e.title}\n  [Google](${links.google}) · [Outlook](${links.outlook})`;
    });
    return {
      handled: true,
      reply:
        lines.join("\n\n") +
        "\n\nUse the buttons under a message to open Google or Outlook.",
      events,
      event: upcoming[0],
      openGoogleUrl: eventExportLinks(upcoming[0]).google,
      openOutlookUrl: eventExportLinks(upcoming[0]).outlook,
    };
  }

  const parsed = parseSchedulePhrase(t);
  if (parsed) {
    const events = addEvent(parsed);
    const latest =
      [...events].reverse().find((e) => e.title === parsed.title) ||
      events[events.length - 1];
    return { handled: true, events, ...eventAddedReply(latest) };
  }

  // Calendar-ish intent but couldn't parse time — still help
  if (looksLikeCalendarCmd(t)) {
    return {
      handled: true,
      reply: [
        "I can drop this on your calendar — I just need a clearer time.",
        "",
        "Examples that work well:",
        "• dentist tomorrow at 5pm",
        "• schedule meeting with Sam Friday at 3pm",
        "• appointment today at 10:30am",
        "",
        "I'll save it here and give you one-tap Google / Outlook buttons.",
      ].join("\n"),
      events: loadEvents(),
    };
  }

  return { handled: false };
}

export function looksLikeCalendarCmd(text: string): boolean {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (
    /^(?:schedule|add event|book|calendar)\b/i.test(t) ||
    /^(show calendar|my (calendar|events)|list events|upcoming)\??$/i.test(t)
  ) {
    return true;
  }

  const hasWhen =
    /\b(tom+or+ow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|\d{4}-\d{2}-\d{2})\b/i.test(
      lower,
    ) ||
    /\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(lower) ||
    /\bat\s+\d{1,2}\b/i.test(lower);

  if (!hasWhen) return false;

  if (
    /\b(appointment|appt|dentist|doctor|doctor'?s|checkup|check-up|haircut|interview|meeting|clinic|orthodontist|hygienist)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (
    /\b(make|set up|book|schedule|create|add)\b.{0,48}\b(appointment|meeting|event|visit)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (
    /\b(add|put)\b.{0,24}\b(on )?(my )?(calendar|agenda|schedule)\b/i.test(lower)
  ) {
    return true;
  }
  if (
    /\bi (need|want|have) to (go to|see|visit|meet|get)\b/i.test(lower) &&
    hasWhen
  ) {
    return true;
  }
  return false;
}

function defaultTomorrowAt(h: number, min: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, min, 0, 0);
  return d.toISOString();
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function parseSchedulePhrase(
  text: string,
): Omit<CalEvent, "id" | "createdAt"> | null {
  const t = text.trim();
  if (!t) return null;

  // Require some calendar signal (when and/or appointment language)
  const hasCmd = /^(?:schedule|add event|book|calendar)\b/i.test(t);
  const hasAppt = looksLikeCalendarCmd(t);
  if (!hasCmd && !hasAppt) return null;

  // Need a parseable time or day for a real event
  const hasTime =
    /\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i.test(t) ||
    /\b(noon|midnight)\b/i.test(t);
  const hasDay =
    /\b(tom+or+ow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|\d{4}-\d{2}-\d{2})\b/i.test(
      t,
    );
  if (!hasTime && !hasDay && !hasCmd) return null;

  let rest = t
    .replace(/^(?:please\s+)?/i, "")
    .replace(/^(?:can you\s+|could you\s+)?/i, "")
    .replace(/^(?:schedule|add event|book|calendar)\s+/i, "")
    .replace(
      /^(?:i\s+(?:need|want|have)\s+to\s+)/i,
      "",
    )
    .replace(/\bmake\s+(?:an?\s+)?appointment\b/gi, " ")
    .replace(/\bset\s+up\s+(?:an?\s+)?(?:appointment|meeting)\b/gi, " ")
    .replace(/\bbook\s+(?:an?\s+)?(?:appointment|meeting)\b/gi, " ")
    .replace(/\bcreate\s+(?:an?\s+)?(?:appointment|meeting|event)\b/gi, " ")
    .replace(/\badd\s+(?:to\s+)?(?:my\s+)?calendar\b/gi, " ")
    .replace(/\bput\s+(?:it\s+)?on\s+(?:my\s+)?calendar\b/gi, " ")
    .replace(/\bfor\s+(?:an?\s+)?appointment\b/gi, " ")
    .trim();

  if (!rest) rest = t;

  // extract time like 3pm, 15:00, at 10am, 5 pm
  let hour = 10;
  let minute = 0;
  let foundTime = false;

  if (/\bnoon\b/i.test(rest)) {
    hour = 12;
    minute = 0;
    foundTime = true;
    rest = rest.replace(/\bnoon\b/i, " ").replace(/\s+/g, " ").trim();
  } else if (/\bmidnight\b/i.test(rest)) {
    hour = 0;
    minute = 0;
    foundTime = true;
    rest = rest.replace(/\bmidnight\b/i, " ").replace(/\s+/g, " ").trim();
  } else {
    const timeM = rest.match(
      /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
    );
    if (timeM) {
      hour = parseInt(timeM[1], 10);
      minute = timeM[2] ? parseInt(timeM[2], 10) : 0;
      const ap = (timeM[3] || "").toLowerCase();
      if (ap === "pm" && hour < 12) hour += 12;
      if (ap === "am" && hour === 12) hour = 0;
      // bare 1–7 without am/pm → treat as PM for appointments
      if (!ap && hour >= 1 && hour <= 7) hour += 12;
      foundTime = true;
      rest = rest.replace(timeM[0], " ").replace(/\s+/g, " ").trim();
    }
  }

  const day = new Date();
  day.setSeconds(0, 0);
  let foundDay = false;

  // include common typo "tommorow"
  if (/\btom+or+ow\b/i.test(rest) || /\btom+or+ow\b/i.test(t)) {
    day.setDate(day.getDate() + 1);
    rest = rest.replace(/\btom+or+ow\b/i, " ").trim();
    foundDay = true;
  } else if (/\btoday\b/i.test(rest) || /\btoday\b/i.test(t)) {
    rest = rest.replace(/\btoday\b/i, " ").trim();
    foundDay = true;
  } else if (/\btonight\b/i.test(rest) || /\btonight\b/i.test(t)) {
    rest = rest.replace(/\btonight\b/i, " ").trim();
    if (!foundTime) {
      hour = 19;
      minute = 0;
      foundTime = true;
    }
    foundDay = true;
  } else {
    const isoD = rest.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoD) {
      const [y, m, d] = isoD[1].split("-").map(Number);
      day.setFullYear(y, m - 1, d);
      rest = rest.replace(isoD[0], " ").trim();
      foundDay = true;
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
        if (re.test(rest) || re.test(t)) {
          const target = i;
          const cur = day.getDay();
          let add = (target - cur + 7) % 7;
          if (add === 0) add = 7;
          day.setDate(day.getDate() + add);
          rest = rest.replace(re, " ").trim();
          foundDay = true;
          break;
        }
      }
    }
  }

  // Default: if we only have a time, use tomorrow for appointment-style phrasing
  if (!foundDay) {
    day.setDate(day.getDate() + 1);
  }

  if (!foundTime && !hasCmd) {
    // appointment language without time — still create with 10am default
    hour = 10;
    minute = 0;
  }

  day.setHours(hour, minute, 0, 0);

  // clean title
  let title = rest
    .replace(/\b(on|at|for|an|a|the|to|my|me|i|need|want|have|go|see|visit)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  title = title.replace(/^with\s+/i, "with ");
  // common leftovers
  title = title
    .replace(/\bappointment\b/gi, " ")
    .replace(/\bappt\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!title || title.length < 2) {
    // try to pull known visit types from original text
    const kind = t.match(
      /\b(dentist|doctor|haircut|interview|meeting|checkup|orthodontist|clinic)\b/i,
    );
    title = kind?.[1] ? titleCase(kind[1]) : "Appointment";
  } else {
    title = titleCase(title);
  }

  const end = new Date(day.getTime() + 60 * 60 * 1000);

  return {
    title,
    start: day.toISOString(),
    end: end.toISOString(),
    notes: `Created from: “${t.slice(0, 160)}”`,
  };
}

// re-export for App if needed
export { defaultTomorrowAt };
