export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  /** Optional image data URLs (jpeg/png) attached to a user message */
  images?: string[];
  createdAt: number;
};

export type ChatApiResponse = {
  content?: string;
  model?: string;
  usage?: unknown;
  error?: string;
};

/** OpenAI-compatible multimodal content part for xAI chat completions */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type ApiMessage = {
  role: Role;
  content: string | ContentPart[];
};
