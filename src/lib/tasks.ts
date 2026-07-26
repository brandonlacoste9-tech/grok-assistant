import { scopedKey } from "./storageScope";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  due?: string; // YYYY-MM-DD optional
  createdAt: number;
};

const KEY_BASE = "grok_assistant_tasks_v1";
function key() {
  return scopedKey(KEY_BASE);
}

function uid() {
  return (
    crypto.randomUUID?.() ??
    `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
}

export function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return [];
    const p = JSON.parse(raw) as Task[];
    if (!Array.isArray(p)) return [];
    return p.filter((t) => t && typeof t.title === "string");
  } catch {
    return [];
  }
}

export function saveTasks(tasks: Task[]) {
  try {
    localStorage.setItem(key(), JSON.stringify(tasks.slice(-100)));
  } catch {
    /* ignore */
  }
}

export function addTask(title: string, due?: string): Task[] {
  const t = title.trim();
  if (!t) return loadTasks();
  const tasks = loadTasks();
  tasks.unshift({
    id: uid(),
    title: t,
    done: false,
    due,
    createdAt: Date.now(),
  });
  saveTasks(tasks);
  return tasks;
}

export function toggleTask(id: string): Task[] {
  const tasks = loadTasks().map((t) =>
    t.id === id ? { ...t, done: !t.done } : t
  );
  saveTasks(tasks);
  return tasks;
}

export function removeTask(id: string): Task[] {
  const tasks = loadTasks().filter((t) => t.id !== id);
  saveTasks(tasks);
  return tasks;
}

export function clearDoneTasks(): Task[] {
  const tasks = loadTasks().filter((t) => !t.done);
  saveTasks(tasks);
  return tasks;
}

export function formatTasksBlock(tasks: Task[]): string {
  if (!tasks.length) return "TASKS: (none)";
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const lines = ["TASKS (user's local list):"];
  if (open.length) {
    lines.push("Open:");
    for (const t of open.slice(0, 30)) {
      lines.push(`  ☐ ${t.title}${t.due ? ` (due ${t.due})` : ""}`);
    }
  } else {
    lines.push("Open: (none)");
  }
  if (done.length) {
    lines.push(
      `Done recently: ${done
        .slice(0, 5)
        .map((t) => t.title)
        .join("; ")}`
    );
  }
  return lines.join("\n");
}

/** Parse simple task commands. */
export function handleTaskCommand(
  text: string
): { handled: true; reply: string; tasks: Task[] } | { handled: false } {
  const t = text.trim();

  const add = t.match(
    /^(?:add task|todo|remind me to|add to (?:my )?list)[:\s]+(.+)$/i
  );
  if (add?.[1]) {
    const tasks = addTask(add[1]);
    return {
      handled: true,
      reply: `Added task: “${add[1].trim()}”. You have ${tasks.filter((x) => !x.done).length} open.`,
      tasks,
    };
  }

  if (/^(show tasks|list tasks|my tasks|todos)\??$/i.test(t)) {
    const tasks = loadTasks();
    if (!tasks.length) {
      return {
        handled: true,
        reply: 'No tasks yet. Try: “add task buy milk”',
        tasks,
      };
    }
    const lines = tasks.slice(0, 40).map((task) => {
      const mark = task.done ? "✓" : "☐";
      return `${mark} ${task.title}${task.due ? ` (${task.due})` : ""}`;
    });
    return { handled: true, reply: lines.join("\n"), tasks };
  }

  const done = t.match(/^(?:done|complete|finish)(?:\s+task)?[:\s]+(.+)$/i);
  if (done?.[1]) {
    const q = done[1].trim().toLowerCase();
    const tasks = loadTasks();
    const hit = tasks.find(
      (x) => !x.done && x.title.toLowerCase().includes(q)
    );
    if (!hit) {
      return {
        handled: true,
        reply: `Couldn't find an open task matching “${done[1].trim()}”.`,
        tasks,
      };
    }
    const next = toggleTask(hit.id);
    return {
      handled: true,
      reply: `Marked done: “${hit.title}”.`,
      tasks: next,
    };
  }

  return { handled: false };
}

export function looksLikePlanDay(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /\b(plan my day|help me plan|what should i do today|schedule (my )?day|daily plan|morning briefing)\b/.test(
      t
    ) || /\bplan\b.{0,20}\btoday\b/.test(t)
  );
}
