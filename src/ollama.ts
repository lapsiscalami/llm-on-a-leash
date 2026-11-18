/**
 * Play-in-place support: make sure the Ollama model a demo needs is there.
 *
 * Every demo and test that talks to Ollama calls ensureModel() first. If
 * Ollama isn't running, it says how to start it. If the model isn't
 * installed, it pulls it — showing progress — and then carries on. A reader
 * should be able to clone the repo and run any script with nothing else set up.
 */
export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";

const ready = new Set<string>();

export async function ensureModel(model: string, baseUrl = OLLAMA_URL): Promise<void> {
  const key = `${baseUrl}|${model}`; // a model on one server says nothing about another
  if (ready.has(key)) return;

  let tags: { models?: { name: string }[] };
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    tags = (await res.json()) as typeof tags;
  } catch {
    throw new Error(
      `Ollama isn't running at ${baseUrl}.\n` +
      `      Install it from https://ollama.com, then start it (open the app, or run: ollama serve).`,
    );
  }

  const have = new Set((tags.models ?? []).map((m) => m.name));
  const wanted = model.includes(":") ? model : `${model}:latest`;
  if (have.has(model) || have.has(wanted)) { ready.add(key); return; }

  process.stdout.write(`\n  ${model} isn't installed yet. Pulling it now (one-time download)...\n`);
  const res = await fetch(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`couldn't pull ${model}: HTTP ${res.status}`);

  // The pull streams one JSON object per line: {status, total?, completed?}.
  const decoder = new TextDecoder();
  let buffer = "", lastPct = -1, lastStatus = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
      if (msg.error) throw new Error(`couldn't pull ${model}: ${msg.error}`);
      if (msg.total && msg.completed !== undefined) {
        const pct = Math.floor((msg.completed / msg.total) * 100);
        if (pct !== lastPct && pct % 5 === 0) {
          process.stdout.write(`\r  downloading ${model}: ${String(pct).padStart(3)}% of ${(msg.total / 1e9).toFixed(1)} GB   `);
          lastPct = pct;
        }
      } else if (msg.status && msg.status !== lastStatus) {
        lastStatus = msg.status;
        if (msg.status === "success") process.stdout.write(`\n  ${model} is ready.\n\n`);
      }
    }
  }
  ready.add(key);
}
