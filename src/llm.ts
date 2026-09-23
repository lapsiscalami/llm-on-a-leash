/**
 * Minimal LLM shim.
 *
 * Default is a MOCK whose responses are REAL small-model failures recorded
 * from production runs (gemma4:e4b / llama3.1:8b class). That matters: the
 * demos are not staging failures to make a point, they are replaying ones
 * that actually happened.
 *
 * Pass --live to hit a real model instead:
 *   OLLAMA_MODEL=gemma4:e2b npm run demo:classify -- --live
 *   GOOGLE_GENERATIVE_AI_API_KEY=... npm run demo:classify -- --live
 */

export interface LLMClient {
  readonly label: string;
  complete(prompt: string): Promise<string>;
}

export const isLive = process.argv.includes("--live");

// ─── Mock ────────────────────────────────────────────────────────────────

type Responder = (prompt: string, call: number) => string;

export class MockClient implements LLMClient {
  readonly label = "mock (recorded small-model output)";
  private calls = 0;
  constructor(private readonly responder: Responder) {}
  async complete(prompt: string): Promise<string> {
    return this.responder(prompt, this.calls++);
  }
}

// ─── Live: Ollama (local) or Google (hosted) ─────────────────────────────

class OllamaClient implements LLMClient {
  readonly label: string;
  constructor(
    private readonly model = process.env.OLLAMA_MODEL ?? "gemma4:e2b-it-q4_K_M",
    private readonly baseUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
  ) {
    this.label = `ollama ${this.model}`;
  }
  async complete(prompt: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: { temperature: 0.7 },
        }),
      });
    } catch (e) {
      // A raw undici stack trace here helps nobody. Say what to do.
      throw new Error(
        `cannot reach Ollama at ${this.baseUrl}
` +
        `      Start it with:  ollama serve
` +
        `      Pull a model:   ollama pull ${this.model}
` +
        `      Or drop --live to run against recorded output.
` +
        `      (underlying: ${(e as Error).message})`,
      );
    }
    if (res.status === 404) {
      throw new Error(
        `Ollama has no model "${this.model}".
` +
        `      Pull it:  ollama pull ${this.model}
` +
        `      Or pick another:  OLLAMA_MODEL=llama3.1:8b npm run <demo> -- --live`,
      );
    }
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { response: string }).response;
  }
}

class GoogleClient implements LLMClient {
  readonly label: string;
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.GOOGLE_MODEL ?? "gemini-2.5-flash",
  ) {
    this.label = `google ${this.model}`;
  }
  async complete(prompt: string): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    if (!res.ok) throw new Error(`google ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
}

/** Pick a client. Falls back to the mock with a printed reason rather than
 *  throwing — a demo that can't run is a worse outcome than a demo that
 *  tells you why it fell back. */
export function getClient(mockResponder: Responder): LLMClient {
  if (!isLive) return new MockClient(mockResponder);
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (process.env.OLLAMA_MODEL || !key) return new OllamaClient();
  return new GoogleClient(key);
}

// ─── Output helpers ──────────────────────────────────────────────────────

/** Pull the first JSON object out of a model response. Small models wrap
 *  JSON in prose and backticks no matter how firmly you ask them not to. */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("{");
  if (start === -1) throw new Error(`no JSON object in response: ${raw.slice(0, 120)}`);
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error(`unbalanced JSON in response: ${raw.slice(0, 120)}`);
}

// ─── Tiny console helpers, so demos read the same ────────────────────────

export const bar = (n: number, max: number, width = 32): string =>
  "█".repeat(Math.max(0, Math.round((n / Math.max(1, max)) * width)));

export function header(title: string, client?: LLMClient): void {
  console.log(`\n${"═".repeat(68)}\n  ${title}${client ? `\n  client: ${client.label}` : ""}\n${"═".repeat(68)}`);
}

export function section(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 63 - title.length))}`);
}

/** Wrap a demo's main so a --live connection failure prints one clear
 *  paragraph instead of an undici stack trace. */
export function runDemo(main: () => Promise<void>): void {
  main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n  x demo could not finish\n      ${msg}\n`);
    process.exit(1);
  });
}
