/**
 * Labels every generated world-building question with ONE of the 20 topics,
 * using a single fixed classifier (llama3.1:8b, temperature 0, JSON mode) for
 * every run and both arms, so "model picks" and "deck deals" are counted the
 * same way. Also records whether a dealt question actually stayed on the
 * topic it was dealt.
 *
 * Run AFTER all generation is finished (it shares the local Ollama box, and
 * generation timings shouldn't be disturbed).
 *
 *   npx tsx measure/classify-topics.ts
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { ensureModel } from "../src/ollama.js";

const CLASSIFIER = process.env.CLASSIFIER ?? "llama3.1:8b";
const URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const TOPICS = [
  "governance", "economy", "law", "religion", "family", "labor", "class", "warfare", "travel", "ecology",
  "food", "education", "art", "communication", "medicine", "taboo", "diplomacy", "technology", "fashion", "spectacle",
];

async function classify(question: string): Promise<string | null> {
  await ensureModel(CLASSIFIER, URL);
  const res = await fetch(`${URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLASSIFIER, stream: false, format: "json", options: { temperature: 0 },
      messages: [
        { role: "system", content: `Label a world-building question with the ONE topic it is mainly about.
Topics: ${TOPICS.join(", ")}.
Return RAW JSON only: {"topic": "One of the topics above"}` },
        { role: "user", content: `QUESTION: "${question}"` },
      ],
    }),
  });
  const j = (await res.json()) as { message: { content: string } };
  try {
    const t = String((JSON.parse(j.message.content) as { topic?: string }).topic ?? "").toLowerCase().trim();
    return TOPICS.find((x) => t.startsWith(x)) ?? null;
  } catch { return null; }
}

(async () => {
  const dir = "measure/results/faithful";
  for (const f of readdirSync(dir).filter((x) => x.startsWith("post2-") && x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    const rows = d.deck?.rows as { question: string; topic?: string | null }[] | undefined;
    if (!rows) continue;
    let n = 0;
    for (const r of rows) {
      if (r.topic !== undefined) continue; // already labelled
      r.topic = r.question ? await classify(r.question) : null;
      if (++n % 10 === 0) process.stdout.write(`  ${f}: ${n} labelled\n`);
    }
    d.deck.classifier = { model: CLASSIFIER, temperature: 0 };
    writeFileSync(`${dir}/${f}`, JSON.stringify(d, null, 2));
    console.log(`labelled ${f}`);
  }
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
