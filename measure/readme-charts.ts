/**
 * Draws the README's dumbbell charts as static SVGs, one light and one dark
 * version each (the README picks one with <picture> and the GitHub theme).
 *
 *   npx tsx measure/readme-charts.ts      -> assets/charts/*.svg
 *
 * The values are copied from `npm run report`. If the report changes, update
 * them here and re-run; the report is the source of truth.
 */
import { writeFileSync, mkdirSync } from "node:fs";

interface Chart {
  file: string;
  title: string; // <title> for screen readers
  axis: string;
  max: number;
  ticks: number[];
  before: string;
  after: string;
  target: { value: number; label: string };
  rows: { model: string; before: number; after: number }[];
}

const CHARTS: Chart[] = [
  {
    file: "deck-topics",
    title: "Distinct topics used across 40 questions, asked for variety vs shuffled topic deck",
    axis: "Distinct topics used (out of 20)",
    max: 20, ticks: [0, 5, 10, 15, 20],
    before: "Asked for variety", after: "Shuffled topic deck",
    target: { value: 17.4, label: "Random sampling (expected)" },
    rows: [{ model: "E2B", before: 8, after: 13 }, { model: "Llama 3.1", before: 8, after: 16 }, { model: "E4B", before: 9, after: 14 }],
  },
  {
    file: "deck-repeats",
    title: "Games that asked about the same topic twice, asked for variety vs shuffled topic deck",
    axis: "Games that repeated a topic (out of 20, fewer is better)",
    max: 20, ticks: [0, 5, 10, 15, 20],
    before: "Asked for variety", after: "Shuffled topic deck",
    target: { value: 1, label: "Random sampling (expected)" },
    rows: [{ model: "E2B", before: 11, after: 2 }, { model: "Llama 3.1", before: 6, after: 0 }, { model: "E4B", before: 5, after: 1 }],
  },
  {
    file: "words-numbers",
    title: "Things placed at the right level, asked for a number vs asked for a word",
    axis: "Things placed at the right level (out of 20)",
    max: 20, ticks: [0, 5, 10, 15, 20],
    before: "Asked for a number", after: "Asked for a word",
    target: { value: 20, label: "Perfect" },
    rows: [{ model: "E2B", before: 10, after: 17 }, { model: "Llama 3.1", before: 10, after: 15 }, { model: "E4B", before: 13, after: 13 }],
  },
  {
    file: "describe-example",
    title: "Strong answers scored 4 or more of 5, example shows false vs example describes the answer",
    axis: "Strong answers scored 4+ of 5 (out of 10)",
    max: 10, ticks: [0, 2, 4, 6, 8, 10],
    before: "Example shows false", after: "Example describes",
    target: { value: 10, label: "A fair judge" },
    rows: [{ model: "E2B", before: 7, after: 9 }, { model: "Llama 3.1", before: 7, after: 7 }, { model: "E4B", before: 10, after: 10 }],
  },
];

// GitHub's own Primer colors, so the charts sit naturally on either theme.
const THEMES = {
  light: { bg: "#ffffff", text: "#1f2328", muted: "#59636e", grid: "#d1d9e0", before: "#8c959f", after: "#0969da", line: "#afb8c1" },
  dark: { bg: "#0d1117", text: "#f0f6fc", muted: "#9198a1", grid: "#3d444d", before: "#6e7681", after: "#4493f8", line: "#656c76" },
};

// Drawn at 520 wide so GitHub's README column shows it at 1:1 and a phone
// (~350px) scales it to ~0.67, which keeps the 16px labels at ~11px.
const W = 520, X0 = 92, X1 = 494, ROW0 = 118, ROW_GAP = 64;
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`;

function svg(c: Chart, t: (typeof THEMES)["light"]): string {
  const x = (v: number) => X0 + ((X1 - X0) * v) / c.max;
  const lastRow = ROW0 + ROW_GAP * (c.rows.length - 1);
  const axisY = lastRow + 38, H = axisY + 58;
  const out: string[] = [];
  // A halo in the page color keeps a label readable where it crosses a gridline or the target line.
  const halo = `stroke="${t.bg}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`;
  // Labels at the right edge are anchored so they never run off the image.
  const at = (px: number, label: string) => (px > X1 - label.length * 4.5 ? `x="${px + 9}" text-anchor="end"` : `x="${px}" text-anchor="middle"`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t" font-family="${FONT}">`);
  out.push(`<title id="t">${c.title}</title>`);
  // The chart carries its own background, so it stays legible even when a
  // viewer shows the light file on a dark page (or the dark file on a light one).
  out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${t.bg}" stroke="${t.grid}"/>`);

  // Legend, top left.
  out.push(`<circle cx="${X0 + 6}" cy="32" r="6" fill="${t.before}"/>`);
  out.push(`<text x="${X0 + 18}" y="37" font-size="16" fill="${t.text}">${c.before}</text>`);
  const legendGap = X0 + 18 + c.before.length * 8.6 + 24;
  out.push(`<circle cx="${legendGap + 6}" cy="32" r="6" fill="${t.after}"/>`);
  out.push(`<text x="${legendGap + 18}" y="37" font-size="16" fill="${t.text}">${c.after}</text>`);

  // Gridlines and ticks.
  for (const v of c.ticks) {
    out.push(`<line x1="${x(v)}" y1="${ROW0 - 26}" x2="${x(v)}" y2="${axisY - 14}" stroke="${t.grid}" stroke-width="1"/>`);
    out.push(`<text x="${x(v)}" y="${axisY + 2}" font-size="15" fill="${t.muted}" text-anchor="middle">${v}</text>`);
  }
  out.push(`<text x="${(X0 + X1) / 2}" y="${axisY + 30}" font-size="16" fill="${t.muted}" text-anchor="middle">${c.axis}</text>`);

  // Target: subtle dashed line, labelled at the top; anchored so it never runs off the edge.
  const tx = x(c.target.value);
  const anchor = tx > X1 - 120 ? "end" : tx < X0 + 120 ? "start" : "middle";
  const labelX = anchor === "end" ? tx + 4 : anchor === "start" ? tx - 4 : tx;
  out.push(`<line x1="${tx}" y1="${ROW0 - 26}" x2="${tx}" y2="${axisY - 14}" stroke="${t.muted}" stroke-width="1.5" stroke-dasharray="4 4"/>`);
  out.push(`<text x="${labelX}" y="${ROW0 - 34}" font-size="15" fill="${t.muted}" text-anchor="${anchor}">${c.target.label} · ${c.target.value}</text>`);

  // One row per model: thin connector, gray "before" dot, accent "after" dot, both labelled.
  c.rows.forEach((r, i) => {
    const y = ROW0 + ROW_GAP * i;
    out.push(`<text x="${X0 - 14}" y="${y + 5}" font-size="16" font-weight="600" fill="${t.text}" text-anchor="end">${r.model}</text>`);
    out.push(`<line x1="${x(r.before)}" y1="${y}" x2="${x(r.after)}" y2="${y}" stroke="${t.line}" stroke-width="2"/>`);
    if (r.before === r.after) {
      // No change: one accent dot ringed in gray, one label.
      out.push(`<circle cx="${x(r.after)}" cy="${y}" r="9" fill="${t.after}" stroke="${t.before}" stroke-width="3"/>`);
      out.push(`<text ${at(x(r.after), `${r.after} (no change)`)} y="${y - 16}" font-size="15" font-weight="600" fill="${t.text}" ${halo}>${r.after} (no change)</text>`);
      return;
    }
    out.push(`<circle cx="${x(r.before)}" cy="${y}" r="8" fill="${t.before}"/>`);
    out.push(`<circle cx="${x(r.after)}" cy="${y}" r="8" fill="${t.after}"/>`);
    out.push(`<text ${at(x(r.before), String(r.before))} y="${y - 15}" font-size="15" fill="${t.muted}" ${halo}>${r.before}</text>`);
    out.push(`<text ${at(x(r.after), String(r.after))} y="${y - 15}" font-size="15" font-weight="600" fill="${t.text}" ${halo}>${r.after}</text>`);
  });
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

// ─── Stacked bars: what a judge did when it was handed a wrong guess ─────────
// Same frame, fonts, gridlines and row layout as the dumbbells. Each bar is as
// long as that model's number of wrong guesses, split into what the judge did.

interface Stacked {
  file: string;
  title: string;
  axis: string;
  max: number;
  ticks: number[];
  parts: { key: string; label: string; tone: "bad" | "after" | "line" }[];
  rows: { model: string; values: Record<string, number> }[];
}

const STACKED: Stacked[] = [
  {
    file: "chain-guess",
    title: "When the first model guessed wrong, what the second model did: followed the guess, fixed it, or made another wrong read",
    axis: "Plans where the first model guessed wrong",
    max: 9, ticks: [0, 2, 4, 6, 8], // 9 leaves room for the "of 8" total
    parts: [
      { key: "followed", label: "Followed the guess", tone: "bad" },
      { key: "fixed", label: "Fixed it", tone: "after" },
      { key: "other", label: "Other wrong read", tone: "line" },
    ],
    rows: [
      { model: "E2B", values: { followed: 5, fixed: 0, other: 0 } },
      { model: "Llama 3.1", values: { followed: 3, fixed: 3, other: 2 } },
      { model: "E4B", values: { followed: 3, fixed: 0, other: 1 } },
    ],
  },
];

// Primer "severe" orange for the failure segment.
const BAD = { light: "#bc4c00", dark: "#db6d28" };

function stackedSvg(c: Stacked, t: (typeof THEMES)["light"], bad: string): string {
  const x = (v: number) => X0 + ((X1 - X0) * v) / c.max;
  const lastRow = ROW0 + ROW_GAP * (c.rows.length - 1);
  const axisY = lastRow + 38, H = axisY + 58, BAR = 26;
  const fill = (tone: Stacked["parts"][number]["tone"]) => (tone === "bad" ? bad : tone === "after" ? t.after : t.line);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t" font-family="${FONT}">`);
  out.push(`<title id="t">${c.title}</title>`);
  out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${t.bg}" stroke="${t.grid}"/>`);

  // Legend: three items, so it starts near the left edge instead of the plot edge.
  let lx = 24;
  for (const p of c.parts) {
    out.push(`<rect x="${lx}" y="26" width="12" height="12" rx="2" fill="${fill(p.tone)}"/>`);
    out.push(`<text x="${lx + 18}" y="37" font-size="16" fill="${t.text}">${p.label}</text>`);
    lx += 18 + p.label.length * 8.2 + 22;
  }

  for (const v of c.ticks) {
    out.push(`<line x1="${x(v)}" y1="${ROW0 - 26}" x2="${x(v)}" y2="${axisY - 14}" stroke="${t.grid}" stroke-width="1"/>`);
    out.push(`<text x="${x(v)}" y="${axisY + 2}" font-size="15" fill="${t.muted}" text-anchor="middle">${v}</text>`);
  }
  out.push(`<text x="${(X0 + X1) / 2}" y="${axisY + 30}" font-size="16" fill="${t.muted}" text-anchor="middle">${c.axis}</text>`);

  c.rows.forEach((r, i) => {
    const y = ROW0 + ROW_GAP * i;
    out.push(`<text x="${X0 - 14}" y="${y + 5}" font-size="16" font-weight="600" fill="${t.text}" text-anchor="end">${r.model}</text>`);
    let acc = 0;
    for (const p of c.parts) {
      const v = r.values[p.key] ?? 0;
      if (!v) continue;
      const x0 = x(acc), x1 = x(acc + v);
      // A 2px gap between segments keeps them distinct.
      out.push(`<rect x="${x0}" y="${y - BAR / 2}" width="${x1 - x0 - 2}" height="${BAR}" rx="2" fill="${fill(p.tone)}"/>`);
      const ink = p.tone === "line" ? t.text : "#ffffff";
      out.push(`<text x="${(x0 + x1 - 2) / 2}" y="${y + 5}" font-size="15" font-weight="600" fill="${ink}" text-anchor="middle">${v}</text>`);
      acc += v;
    }
    // Total at the bar's end, so "of 4" reads without counting segments.
    out.push(`<text x="${x(acc) + 6}" y="${y + 5}" font-size="15" fill="${t.muted}">of ${acc}</text>`);
  });
  out.push(`</svg>`);
  return out.join("\n") + "\n";
}

mkdirSync("assets/charts", { recursive: true });
for (const c of STACKED) for (const [name, theme] of Object.entries(THEMES)) {
  const file = `assets/charts/${c.file}-${name}.svg`;
  writeFileSync(file, stackedSvg(c, theme, BAD[name as keyof typeof BAD]));
  console.log(`wrote ${file}`);
}
for (const c of CHARTS) for (const [name, theme] of Object.entries(THEMES)) {
  const file = `assets/charts/${c.file}-${name}.svg`;
  writeFileSync(file, svg(c, theme));
  console.log(`wrote ${file}`);
}
