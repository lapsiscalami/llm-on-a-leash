/**
 * Minimal LLM shim.
 *
 * With no flags, a demo REPLAYS real replies recorded from a real model —
 * the file in fixtures/ says which model and when. Nothing is typed in by
 * hand: if a recording is missing, the demo says so rather than inventing
 * an answer.
 *
 *   npm run demo:judge                          # replay recorded replies
 *   npm run demo:judge -- --live                # your own model
 *   npm run demo:judge -- --live --record       # your model, and save the
 *                                               # replies as the new recording
 *
 * Live uses local Ollama (OLLAMA_MODEL, default gemma4:e2b-it-q4_K_M) unless
 * GOOGLE_GENERATIVE_AI_API_KEY is set and OLLAMA_MODEL is not.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { ensureModel } from "./ollama.js";

/** Per-call options. Temperature is a dial per prompt (pattern 6): a judge
 *  runs cool, a question-writer runs warm. Default is the shim's 0.7. */
export interface CompleteOptions { temperature?: number }

export interface LLMClient {
  readonly label: string;
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}

export const isLive = process.argv.includes("--live");
const isRecord = process.argv.includes("--record");
const DEFAULT_TEMPERATURE = 0.7;

// ─── Recordings ──────────────────────────────────────────────────────────

/** `temperature` per call was added after the first recordings were made;
 *  a call without it was recorded at the shim's default of 0.7. */
interface Recording { model: string; recordedAt: string; calls: { prompt: string; reply: string; temperature?: number }[] }
const fixturePath = (name: string) => `fixtures/${name}.json`;

/** Replays a recording. Identical prompts are answered in the order they
 *  were recorded, so a prompt asked 20 times gets its 20 real replies. */
class ReplayClient implements LLMClient {
  readonly label: string;
  private readonly queues = new Map<string, string[]>();
  private readonly found: boolean;
  constructor(private readonly name: string) {
    // Don't throw here: a missing recording is reported on the first call,
    // inside runDemo, so the reader gets advice instead of a stack trace.
    this.found = existsSync(fixturePath(name));
    if (!this.found) { this.label = "replay (no recording yet)"; return; }
    const rec = JSON.parse(readFileSync(fixturePath(name), "utf8")) as Recording;
    for (const c of rec.calls) {
      const q = this.queues.get(c.prompt) ?? [];
      q.push(c.reply);
      this.queues.set(c.prompt, q);
    }
    this.label = `replay: real replies from ${rec.model}, recorded ${rec.recordedAt.slice(0, 10)}`;
  }
  async complete(prompt: string): Promise<string> {
    if (!this.found) {
      throw new Error(`no recording at ${fixturePath(this.name)}\n      Record one:  npm run <demo> -- --live --record`);
    }
    const reply = this.queues.get(prompt)?.shift();
    if (reply === undefined) {
      throw new Error(`the recording in ${fixturePath(this.name)} has no reply for this prompt ` +
        `(the demo changed since it was recorded)\n      Re-record:  npm run <demo> -- --live --record`);
    }
    return reply;
  }
}

/** Wraps a live client and saves every call, so the next plain run replays it. */
class RecordingClient implements LLMClient {
  readonly label: string;
  private readonly rec: Recording;
  constructor(private readonly inner: LLMClient, private readonly name: string, model: string) {
    this.label = `${inner.label} (recording)`;
    this.rec = { model, recordedAt: new Date().toISOString(), calls: [] };
  }
  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    const reply = await this.inner.complete(prompt, opts);
    this.rec.calls.push({ prompt, reply, temperature: opts?.temperature ?? DEFAULT_TEMPERATURE });
    mkdirSync("fixtures", { recursive: true });
    writeFileSync(fixturePath(this.name), JSON.stringify(this.rec, null, 2));
    return reply;
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
  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    await ensureModel(this.model, this.baseUrl); // pulls it if missing
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: { temperature: opts?.temperature ?? DEFAULT_TEMPERATURE },
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
  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: opts?.temperature ?? DEFAULT_TEMPERATURE },
        }),
      },
    );
    if (!res.ok) throw new Error(`google ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
}

/** Pick a client. Without --live this is the replay client for the demo's
 *  recording in fixtures/<name>.json; a missing or stale recording is
 *  reported on the first call (inside runDemo) with the command to fix it,
 *  rather than as a stack trace. */
export function getClient(name: string): LLMClient {
  if (!isLive) return new ReplayClient(name);
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const useOllama = Boolean(process.env.OLLAMA_MODEL) || !key;
  const live = useOllama ? new OllamaClient() : new GoogleClient(key!);
  const model = useOllama
    ? process.env.OLLAMA_MODEL ?? "gemma4:e2b-it-q4_K_M"
    : process.env.GOOGLE_MODEL ?? "gemini-2.5-flash";
  return isRecord ? new RecordingClient(live, name, model) : live;
}

// ─── Output helpers ──────────────────────────────────────────────────────

/** Pull the first JSON object out of a model response. Small models wrap
 *  JSON in prose and backticks no matter how firmly you ask them not to. */
export function extractJson(raw: string): unknown {
  // The common case: the whole reply is the JSON.
  try { return JSON.parse(raw.trim()); } catch { /* wrapped in fences or prose */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf("{");
  if (start === -1) throw new Error(`no JSON object in response: ${raw.slice(0, 120)}`);
  // Track strings and escapes, so a brace inside a value ("a } in a reason")
  // isn't mistaken for the end of the object.
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(body.slice(start, i + 1));
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
