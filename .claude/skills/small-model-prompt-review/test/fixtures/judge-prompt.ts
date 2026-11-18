/**
 * Judge prompt for a strategy game. Reads a player's written plan and
 * returns a grade plus a few flags; the engine turns those into a card.
 */

/** One temperature for every prompt in the game. */
export const TEMPERATURE = 0.7;

export function judgeSystem(): string {
  return `You are the judge in a strategy game. Read the player's plan and grade it.
Answer each flag with true or false.
Write the summary in 150-300 words.
Give 3-5 suggestions.
Be vivid in the summary. The summary must be between 150 and 300 words.`;
}

export function judgeUser(
  plan: string,
  factionGold: number,
  validatorGuess: string,
  threatLevel: number,
): string {
  return `PLAN: "${plan}"
The faction holds ${factionGold} gold. Threat level: ${threatLevel}/5.
The validator thought this plan is a "${validatorGuess}". Use that unless the plan clearly says otherwise.
Also propose a fresh, creative twist for the next round. Vary your answers and don't repeat earlier rounds.

Return RAW JSON only:
{"kind": "claim, steal, or trap",
 "sentiment": "positive",
 "ontopic": false,
 "intensity": 0.72,
 "newGold": ${factionGold + 10},
 "tags": "terrain + timing | bluff",
 "suggestions": ["first", "second"],
 "summary": "the narration",
 "event": "storm"}`;
}

export interface JudgeResult {
  kind: "claim" | "steal" | "trap";
  ontopic: boolean;
  intensity: number;
  newGold: number;
  event: "storm" | "plague" | "festival";
  sentiment: "positive" | "negative";
  summary: string;
}

export function parseJudge(raw: string): JudgeResult {
  const j = JSON.parse(raw) as Record<string, unknown>;
  const kind = (["claim", "steal", "trap"] as const).find((k) => k === j.kind) ?? "claim";
  const ontopic = j.ontopic === true;
  const intensity = typeof j.intensity === "number" ? j.intensity : 0.5;
  const event = (["storm", "plague", "festival"] as const).find((e) => e === j.event) ?? "storm";
  const sentiment = String(j.sentiment).startsWith("pos") ? "positive" : "negative";
  return {
    kind,
    ontopic,
    intensity,
    newGold: Number(j.newGold),
    event,
    sentiment,
    summary: String(j.summary ?? ""),
  };
}
