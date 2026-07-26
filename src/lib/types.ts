export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
};

export type ChatApiResponse = {
  content?: string;
  model?: string;
  usage?: unknown;
  error?: string;
};
