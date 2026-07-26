export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  /** Optional image data URLs (jpeg/png) attached to a user message */
  images?: string[];
  /** Assistant-generated image URLs (Grok Imagine) */
  generatedImages?: string[];
  /** Citation URLs from web/X search tools */
  citations?: string[];
  /** Calendar export actions (Google / Outlook / ICS) */
  eventExport?: {
    id: string;
    title: string;
    start: string;
    end?: string;
    location?: string;
    notes?: string;
  };
  createdAt: number;
};

export type ChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
};

export type ChatApiResponse = {
  content?: string;
  model?: string;
  usage?: unknown;
  error?: string;
  citations?: string[];
};

/** OpenAI-compatible multimodal content part for xAI chat completions */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type ApiMessage = {
  role: Role;
  content: string | ContentPart[];
};
