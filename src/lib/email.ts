import { scopedKey } from "./storageScope";

export type EmailDraft = {
  id: string;
  to: string;
  subject: string;
  body: string;
  createdAt: number;
};

const KEY_BASE = "grok_assistant_email_drafts_v1";

function key() {
  return scopedKey(KEY_BASE);
}

function uid() {
  return (
    crypto.randomUUID?.() ??
    `em_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
}

export function loadDrafts(): EmailDraft[] {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return [];
    const p = JSON.parse(raw) as EmailDraft[];
    return Array.isArray(p) ? p.slice(0, 40) : [];
  } catch {
    return [];
  }
}

export function saveDrafts(drafts: EmailDraft[]) {
  try {
    localStorage.setItem(key(), JSON.stringify(drafts.slice(0, 40)));
  } catch {
    /* ignore */
  }
}

export function addDraft(
  d: Omit<EmailDraft, "id" | "createdAt">
): EmailDraft[] {
  const drafts = loadDrafts();
  drafts.unshift({
    ...d,
    to: d.to.trim(),
    subject: d.subject.trim(),
    body: d.body.trim(),
    id: uid(),
    createdAt: Date.now(),
  });
  saveDrafts(drafts);
  return drafts;
}

export function removeDraft(id: string): EmailDraft[] {
  const drafts = loadDrafts().filter((d) => d.id !== id);
  saveDrafts(drafts);
  return drafts;
}

/** Gmail compose deep link */
export function gmailComposeUrl(draft: {
  to?: string;
  subject?: string;
  body?: string;
}): string {
  const params = new URLSearchParams({ view: "cm", fs: "1" });
  if (draft.to) params.set("to", draft.to);
  if (draft.subject) params.set("su", draft.subject);
  if (draft.body) params.set("body", draft.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function mailtoUrl(draft: {
  to?: string;
  subject?: string;
  body?: string;
}): string {
  const to = encodeURIComponent(draft.to || "");
  const q = new URLSearchParams();
  if (draft.subject) q.set("subject", draft.subject);
  if (draft.body) q.set("body", draft.body);
  const qs = q.toString();
  return `mailto:${to}${qs ? `?${qs}` : ""}`;
}

export function formatEmailBlock(drafts: EmailDraft[]): string {
  if (!drafts.length) return "EMAIL DRAFTS: (none)";
  const lines = ["EMAIL DRAFTS (local):"];
  for (const d of drafts.slice(0, 8)) {
    lines.push(`  • To: ${d.to || "(no to)"} | ${d.subject || "(no subject)"}`);
  }
  return lines.join("\n");
}

/**
 * Commands:
 * - email draft to ada@x.com subject Hello body Thanks for...
 * - draft email to bob about meeting
 * - show email drafts
 */
export function handleEmailCommand(
  text: string
):
  | {
      handled: true;
      reply: string;
      drafts: EmailDraft[];
      openGmailUrl?: string;
      openMailto?: string;
    }
  | { handled: false } {
  const t = text.trim();

  if (/^(show (email )?drafts|my (email )?drafts|list drafts)\??$/i.test(t)) {
    const drafts = loadDrafts();
    if (!drafts.length) {
      return {
        handled: true,
        reply:
          'No drafts yet. Try: “email draft to sam@example.com subject Hello body Hope you’re well”',
        drafts,
      };
    }
    const lines = drafts.slice(0, 15).map((d, i) => {
      return `${i + 1}. To ${d.to || "—"} · ${d.subject || "(no subject)"}\n   ${d.body.slice(0, 120)}${d.body.length > 120 ? "…" : ""}`;
    });
    return { handled: true, reply: lines.join("\n\n"), drafts };
  }

  // email draft to X subject Y body Z
  const full = t.match(
    /^(?:email draft|draft email|compose email|write email)(?:\s+to\s+([^\s]+))?(?:\s+subject\s+(.+?))?(?:\s+body\s+([\s\S]+))?$/i
  );

  // simpler: email draft to addr: rest as body
  const simple = t.match(
    /^(?:email draft|draft email|compose email|write email)\s+to\s+(\S+)(?:\s+about\s+(.+))?$/i
  );

  if (full && (full[1] || full[2] || full[3])) {
    const to = (full[1] || "").trim();
    let subject = (full[2] || "").trim();
    let body = (full[3] || "").trim();
    if (!subject && !body && to) {
      // only "to" matched poorly
    }
    if (!subject && body) {
      subject = body.slice(0, 60);
    }
    if (!subject) subject = "Hello";
    if (!body) body = "";

    const drafts = addDraft({ to, subject, body: body || subject });
    const draft = drafts[0];
    const gmail = gmailComposeUrl(draft);
    const mail = mailtoUrl(draft);
    return {
      handled: true,
      reply: `Draft saved.\n\n**To:** ${to || "—"}\n**Subject:** ${subject}\n\n${body || "(empty body)"}\n\n• [Open in Gmail](${gmail})\n• [Open in mail app](${mail})`,
      drafts,
      openGmailUrl: gmail,
      openMailto: mail,
    };
  }

  if (simple) {
    const to = simple[1].trim();
    const about = (simple[2] || "Following up").trim();
    const subject = about.length < 80 ? about : about.slice(0, 77) + "…";
    const body = `Hi,\n\n${about}\n\nBest regards`;
    const drafts = addDraft({ to, subject, body });
    const draft = drafts[0];
    const gmail = gmailComposeUrl(draft);
    return {
      handled: true,
      reply: `Draft to **${to}** about “${subject}”.\n\n• [Open in Gmail](${gmail})\n• [Mail app](${mailtoUrl(draft)})`,
      drafts,
      openGmailUrl: gmail,
      openMailto: mailtoUrl(draft),
    };
  }

  // "email draft:" freeform — use LLM? no, local only
  const free = t.match(/^(?:email draft|draft email)[:\s]+([\s\S]+)/i);
  if (free?.[1] && free[1].includes("@")) {
    const chunk = free[1].trim();
    const addr = chunk.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] || "";
    const drafts = addDraft({
      to: addr,
      subject: "Hello",
      body: chunk,
    });
    const draft = drafts[0];
    const gmail = gmailComposeUrl(draft);
    return {
      handled: true,
      reply: `Draft saved for ${addr || "recipient"}.\n[Open in Gmail](${gmail})`,
      drafts,
      openGmailUrl: gmail,
    };
  }

  return { handled: false };
}

export function looksLikeEmailCmd(text: string): boolean {
  const t = text.trim();
  return (
    /^(?:email draft|draft email|compose email|write email)\b/i.test(t) ||
    /^(show (email )?drafts|my (email )?drafts|list drafts)\??$/i.test(t)
  );
}
