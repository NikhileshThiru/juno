// Lab result bands and the organ map. Both are computed in code, never by the LLM.
import type { Labs } from "./gemini.ts";

export type Test = Labs["tests"][number];
export type Band = "normal" | "borderline" | "out";
export type Organ = "kidneys" | "liver" | "heart" | "thyroid" | "pancreas" | "blood";

export const ORGANS: Record<Organ, { label: string; plain: string }> = {
  heart: { label: "Heart & vessels", plain: "cholesterol & heart health" },
  kidneys: { label: "Kidneys", plain: "kidney function" },
  liver: { label: "Liver", plain: "liver tests" },
  pancreas: { label: "Blood sugar", plain: "blood sugar" },
  thyroid: { label: "Thyroid", plain: "thyroid" },
  blood: { label: "Blood & general", plain: "blood counts & salts" },
};

const MAP: [Organ, RegExp][] = [
  ["pancreas", /glucose|a1c/i], // before "blood" so "Hemoglobin A1c" isn't read as hemoglobin
  ["kidneys", /creatinine|\begfr\b|\bgfr\b|\bbun\b|urea nitrogen/i],
  ["liver", /\balt\b|\bast\b|alk(aline)?\.? ?phos|bilirubin|albumin|sgpt|sgot/i],
  ["heart", /ldl|hdl|cholesterol|triglycer/i],
  ["thyroid", /\btsh\b|\bt4\b|\bt3\b|thyro/i],
];

export const organOf = (name: string): Organ => MAP.find(([, re]) => re.test(name))?.[0] ?? "blood";

/** Out of range by ≤10% of the edge → borderline (amber); further → out (red). */
export function bandOf(t: Test): Band {
  const v = t.value;
  if (v == null) return t.flag === "normal" || t.flag === "unknown" ? "normal" : "out";
  if (t.ref_high != null && v > t.ref_high) return (v - t.ref_high) / t.ref_high <= 0.1 ? "borderline" : "out";
  if (t.ref_low != null && v < t.ref_low) return (t.ref_low - v) / t.ref_low <= 0.1 ? "borderline" : "out";
  if (t.flag === "critical") return "out";
  return "normal";
}

const rank: Record<Band, number> = { normal: 0, borderline: 1, out: 2 };
export const worst = (bands: Band[]): Band | null => (bands.length ? bands.reduce((a, b) => (rank[b] > rank[a] ? b : a)) : null);

export type Grouped = Record<Organ, { test: Test; band: Band }[]>;
export function group(tests: Test[]): Grouped {
  const g = { kidneys: [], liver: [], heart: [], thyroid: [], pancreas: [], blood: [] } as Grouped;
  for (const test of tests) g[organOf(test.name)].push({ test, band: bandOf(test) });
  return g;
}

/** Plain direction words for an out-of-range value, from the numbers only. */
export function direction(t: Test): string {
  if (t.value == null) return "outside the range";
  if (t.ref_low != null && t.value < t.ref_low) return bandOf(t) === "borderline" ? "a little low" : "low";
  if (t.ref_high != null && t.value > t.ref_high) return bandOf(t) === "borderline" ? "a little high" : "high";
  return "outside the range";
}
