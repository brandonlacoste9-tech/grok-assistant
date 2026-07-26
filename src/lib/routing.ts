import { looksLikeWeather } from "./weather";

export type RouteKind =
  | "imagine"
  | "weather"
  | "search"
  | "plan"
  | "memory"
  | "task"
  | "calendar"
  | "email"
  | "chat";

/** Explicit imagine intents (also used when Imagine mode is on). */
export function looksLikeImagine(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.startsWith("/imagine") || t.startsWith("/img")) return true;
  if (
    /^(draw|paint|sketch|imagine|render)\b/.test(t) ||
    /^(generate|create|make|show)\b.{0,60}\b(image|picture|photo|art|illustration|drawing|painting)\b/.test(
      t
    ) ||
    /\b(image|picture|photo|illustration|drawing)\b.{0,24}\bof\b/.test(t) ||
    /\b(generate|create)\s+(an?\s+)?(image|picture|photo)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/** Likely needs live web / X (news, prices, "today", sports scores…). */
export function looksLikeSearch(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.startsWith("/search")) return true;
  if (
    /\b(news|headline|breaking|stock|price of|who won|score|election|release date|latest|trending)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (/\b(what happened|what's happening)\b/.test(t)) return true;
  if (/\b(today|this week|right now|currently)\b/.test(t) && t.length < 200) {
    // "what's the weather today" is weather not search
    if (looksLikeWeather(t)) return false;
    if (/\b(plan|todo|task|weather|forecast)\b/.test(t)) return false;
    return /\b(news|market|sport|game|update|announce)\b/.test(t);
  }
  return false;
}

export function looksLikeMemoryCmd(text: string): boolean {
  const t = text.trim();
  return (
    /^(?:please\s+)?remember\b/i.test(t) ||
    /^(?:please\s+)?forget\b/i.test(t) ||
    /^(clear memory|forget everything|reset memory)\s*$/i.test(t) ||
    /^(what do you know about me|what do you remember|show memory|my profile)\??$/i.test(
      t
    ) ||
    /^(?:my name is|call me)\s+/i.test(t)
  );
}

export function looksLikeTaskCmd(text: string): boolean {
  const t = text.trim();
  return (
    /^(?:add task|todo|remind me to|add to (?:my )?list)\b/i.test(t) ||
    /^(show tasks|list tasks|my tasks|todos)\??$/i.test(t) ||
    /^(?:done|complete|finish)(?:\s+task)?\b/i.test(t)
  );
}

export function looksLikeCalendarCmd(text: string): boolean {
  const t = text.trim();
  return (
    /^(?:schedule|add event|book)\b/i.test(t) ||
    /^(show calendar|my (calendar|events)|list events|upcoming)\??$/i.test(t)
  );
}

export function looksLikeEmailCmd(text: string): boolean {
  const t = text.trim();
  return (
    /^(?:email draft|draft email|compose email|write email)\b/i.test(t) ||
    /^(show (email )?drafts|my (email )?drafts|list drafts)\??$/i.test(t)
  );
}

/**
 * Auto-route user text. Mode overrides still apply in the UI.
 * Order: memory/task/calendar/email → imagine → weather → plan → search → chat.
 */
export function autoRoute(
  text: string,
  opts?: { imagineMode?: boolean; searchMode?: boolean; hasImages?: boolean }
): RouteKind {
  const t = text.trim();
  if (!t && opts?.hasImages) return "chat";

  if (looksLikeMemoryCmd(t)) return "memory";
  if (looksLikeEmailCmd(t)) return "email";
  if (looksLikeCalendarCmd(t)) return "calendar";
  if (looksLikeTaskCmd(t)) return "task";

  if (opts?.imagineMode || looksLikeImagine(t)) return "imagine";
  if (looksLikeWeather(t)) return "weather";

  // plan day
  if (
    /\b(plan my day|help me plan|what should i do today|schedule (my )?day|daily plan|morning briefing)\b/i.test(
      t
    )
  ) {
    return "plan";
  }

  if (opts?.searchMode || looksLikeSearch(t)) return "search";
  return "chat";
}
