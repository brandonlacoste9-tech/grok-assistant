export type UserMemory = {
  displayName: string;
  notes: string[];
  style: "balanced" | "concise" | "detailed" | "witty";
  updatedAt: number;
};

const KEY = "grok_assistant_memory_v1";
const MAX_NOTES = 40;

const DEFAULT: UserMemory = {
  displayName: "",
  notes: [],
  style: "balanced",
  updatedAt: Date.now(),
};

export function loadMemory(): UserMemory {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    const p = JSON.parse(raw) as Partial<UserMemory>;
    return {
      displayName: typeof p.displayName === "string" ? p.displayName : "",
      notes: Array.isArray(p.notes)
        ? p.notes.filter((n) => typeof n === "string").slice(-MAX_NOTES)
        : [],
      style:
        p.style === "concise" ||
        p.style === "detailed" ||
        p.style === "witty" ||
        p.style === "balanced"
          ? p.style
          : "balanced",
      updatedAt: p.updatedAt || Date.now(),
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveMemory(mem: UserMemory) {
  const next = {
    ...mem,
    notes: mem.notes.slice(-MAX_NOTES),
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function setDisplayName(name: string) {
  const m = loadMemory();
  m.displayName = name.trim();
  return saveMemory(m);
}

export function setStyle(style: UserMemory["style"]) {
  const m = loadMemory();
  m.style = style;
  return saveMemory(m);
}

export function addNote(note: string) {
  const n = note.trim();
  if (!n) return loadMemory();
  const m = loadMemory();
  // de-dupe case-insensitive
  m.notes = m.notes.filter((x) => x.toLowerCase() !== n.toLowerCase());
  m.notes.push(n);
  return saveMemory(m);
}

export function removeNote(match: string) {
  const m = loadMemory();
  const q = match.trim().toLowerCase();
  m.notes = m.notes.filter((n) => !n.toLowerCase().includes(q));
  return saveMemory(m);
}

export function clearNotes() {
  const m = loadMemory();
  m.notes = [];
  return saveMemory(m);
}

/** Handle explicit memory commands. Returns reply + whether to skip LLM. */
export function handleMemoryCommand(
  text: string
): { handled: true; reply: string; memory: UserMemory } | { handled: false } {
  const t = text.trim();

  // remember that ... / remember: ...
  const remember = t.match(
    /^(?:please\s+)?remember(?:\s+that)?[:\s]+(.+)$/i
  );
  if (remember?.[1]) {
    const mem = addNote(remember[1]);
    return {
      handled: true,
      reply: `Got it — I'll remember: “${remember[1].trim()}”`,
      memory: mem,
    };
  }

  // my name is ...
  const name = t.match(
    /^(?:my name is|call me|i(?:'m| am))\s+([A-Za-z][\w .'-]{0,40})$/i
  );
  if (name?.[1] && !/\b(the weather|going|trying|looking)\b/i.test(t)) {
    const mem = setDisplayName(name[1]);
    return {
      handled: true,
      reply: `Nice to meet you, ${name[1].trim()}. I'll use that name.`,
      memory: mem,
    };
  }

  // forget ...
  const forget = t.match(/^(?:please\s+)?forget(?:\s+that)?[:\s]+(.+)$/i);
  if (forget?.[1]) {
    const mem = removeNote(forget[1]);
    return {
      handled: true,
      reply: `Okay — I forgot notes matching “${forget[1].trim()}”.`,
      memory: mem,
    };
  }

  if (/^(?:clear memory|forget everything|reset memory)\s*$/i.test(t)) {
    const mem = clearNotes();
    return {
      handled: true,
      reply: "Cleared all memory notes. Your display name is unchanged.",
      memory: mem,
    };
  }

  if (
    /^(what do you know about me|what do you remember|show memory|my profile)\??$/i.test(
      t
    )
  ) {
    const mem = loadMemory();
    const lines = [
      mem.displayName ? `Name: ${mem.displayName}` : "Name: (not set)",
      `Style: ${mem.style}`,
      mem.notes.length
        ? `Notes:\n${mem.notes.map((n) => `• ${n}`).join("\n")}`
        : "Notes: (none yet — say “remember that …”)",
    ];
    return { handled: true, reply: lines.join("\n"), memory: mem };
  }

  return { handled: false };
}

export function buildMemoryBlock(mem: UserMemory): string {
  const styleHint = {
    balanced: "Be clear and practical; short paragraphs.",
    concise: "Be brief — prefer bullets and short answers.",
    detailed: "Be thorough when helpful; still structured.",
    witty: "Be warm and lightly witty like Grok, without being rude.",
  }[mem.style];

  const lines = [
    "USER MEMORY (persistent — treat as facts the user wants remembered):",
    mem.displayName ? `- Name: ${mem.displayName}` : "- Name: unknown",
    `- Preferred style: ${mem.style}. ${styleHint}`,
  ];
  if (mem.notes.length) {
    lines.push("- Notes:");
    for (const n of mem.notes.slice(-MAX_NOTES)) {
      lines.push(`  • ${n}`);
    }
  } else {
    lines.push("- Notes: none yet.");
  }
  lines.push(
    "If the user says “remember …” or “forget …”, acknowledge; the app stores those separately."
  );
  return lines.join("\n");
}
