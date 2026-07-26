import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Local /api/chat proxy so `npm run dev` works without Netlify CLI */
function grokDevApi(env: Record<string, string>): Plugin {
  return {
    name: "grok-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/chat", (req, res, next) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", async () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            const apiKey = env.XAI_API_KEY || env.GROK_API_KEY;
            const model = env.XAI_MODEL || env.GROK_MODEL || "grok-4.3";

            if (!apiKey) {
              res.statusCode = 503;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  error:
                    "Missing XAI_API_KEY. Copy .env.example → .env and add your xAI key.",
                })
              );
              return;
            }

            const messages = Array.isArray(body.messages) ? body.messages : [];
            const system =
              typeof body.system === "string" && body.system.trim()
                ? body.system.trim()
                : "You are Grok Assistant — a sharp, helpful companion powered by xAI Grok. Be clear, warm, and practical. Use short paragraphs. Prefer actionable answers.";

            const xaiRes = await fetch("https://api.x.ai/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model,
                temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
                max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : 2048,
                messages: [{ role: "system", content: system }, ...messages],
              }),
            });

            const data = await xaiRes.json();
            if (!xaiRes.ok) {
              res.statusCode = xaiRes.status;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  error:
                    data?.error ||
                    data?.message ||
                    `xAI error ${xaiRes.status}`,
                })
              );
              return;
            }

            const content =
              data?.choices?.[0]?.message?.content ??
              "(No response content from Grok.)";

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                content,
                model: data?.model ?? model,
                usage: data?.usage ?? null,
              })
            );
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : "Server error",
              })
            );
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), grokDevApi(env)],
    server: {
      port: 5173,
    },
  };
});
