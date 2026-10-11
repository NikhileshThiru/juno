// Local fallback for inbound texts when every Gemini model is unavailable
// (free-tier quota). Covers the demo's common replies with plain patterns.
import { now, TZ } from "./clock.ts";
import type { Intent } from "./gemini.ts";

type OpenTodo = { id: string; title: string; clinic: string | null; status: string; category?: string };

const CATEGORY_WORDS: [RegExp, string][] = [
  [/heart|cardio|okafor/i, "specialist"],
  [/blood|lab|fasting|draw|bmp|lipid/i, "lab"],
  [/family|primary|pcp|chen|check-?up|regular doctor/i, "primary_care"],
  [/pharmacy|meds|medicine|prescription|cvs|pick(ed)? ?up/i, "pharmacy"],
];

/** The to-do a message explicitly names ("heart doctor", "blood test"), or null if it only says "it". */
export function matchOpenTodo(text: string, open: OpenTodo[]): string | null {
  for (const [re, cat] of CATEGORY_WORDS) {
    if (!re.test(text)) continue;
    const hit = open.find((t) => t.category === cat || re.test(`${t.title} ${t.clinic ?? ""}`));
    if (hit) return hit.id;
  }
  const words = text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  return open.find((t) => words.some((w) => `${t.title} ${t.clinic ?? ""}`.toLowerCase().includes(w)))?.id ?? null;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Tue 2pm", "tomorrow at 9:30am", "Oct 20 2pm", "10/20 at 2" → local "yyyy-mm-ddThh:mm" (America/New_York). */
export function parseWhen(text: string): string | null {
  const s = text.toLowerCase();
  const tm = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/) ?? s.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
  const noon = /\bnoon\b/.test(s);
  if (!tm && !noon) return null;
  let hour = noon ? 12 : Number(tm![1]);
  const minute = noon ? 0 : Number(tm![2] ?? 0);
  const ampm = tm?.[3]?.[0];
  if (ampm === "p" && hour < 12) hour += 12;
  if (ampm === "a" && hour === 12) hour = 0;
  if (!ampm && !noon && hour < 8) hour += 12; // "at 2" means 2 PM

  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
      .formatToParts(now())
      .map((x) => [x.type, x.value]),
  );
  let date = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  const today = DAYS.indexOf(String(p.weekday).toLowerCase().slice(0, 3));

  const md = s.match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})\\b`)) ?? null;
  const slash = s.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  const wd = s.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
  if (md) date = new Date(Date.UTC(Number(p.year), MONTHS.indexOf(md[1]!), Number(md[2])));
  else if (slash) date = new Date(Date.UTC(Number(p.year), Number(slash[1]) - 1, Number(slash[2])));
  else if (/\btomorrow\b/.test(s)) date.setUTCDate(date.getUTCDate() + 1);
  else if (wd) date.setUTCDate(date.getUTCDate() + (((DAYS.indexOf(wd[1]!) - today + 7) % 7) || 7));

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(hour)}:${pad(minute)}`;
}

export const findPhone = (text: string) => text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] ?? null;

export function localIntent(text: string, open: OpenTodo[]): Intent {
  const base: Intent = { intent: "other", todo_id: null, appt_datetime_iso: null, caregiver_phone: null, caregiver_name: null, caregiver_relation: null };
  const phone = findPhone(text);
  const rel = text.match(/\b(daughter|son|wife|husband|sister|brother|niece|nephew|friend|grand(?:daughter|son))\b\s*([A-Z][a-z]+)?/i);
  if (/\b(add|include|loop in)\b/i.test(text) && (rel || phone))
    return { ...base, intent: "add_caregiver", caregiver_phone: phone, caregiver_relation: rel?.[1]?.toLowerCase() ?? null, caregiver_name: rel?.[2] ?? null };
  if (/\b(show|pull up|send|see|open|view)\b.*\b(list|checklist|steps|to-?dos?|card|plan|labs?|results?|body map)\b/i.test(text)) return { ...base, intent: "show" };
  if (/what('?s| is) left|how('?s| is) (it|everything|she|mom|my mom) (going|doing)|^status\b/i.test(text)) return { ...base, intent: "status" };
  // Questions come before "booked"/"done": "did I book the heart doctor?" is a question.
  if (/\?\s*$|^(what|what's|whats|when|where|which|who|why|how|is|are|do|does|did|can|could|should|will|would|tell me)\b/i.test(text.trim()))
    return { ...base, intent: "question" };
  if (/\b(booked|book|scheduled|schedule|made an? appointment|set up|appointment (is|on))\b/i.test(text))
    return { ...base, intent: "booked", todo_id: matchOpenTodo(text, open), appt_datetime_iso: parseWhen(text) };
  if (/\b(done|went|finished|did it|picked up|completed)\b/i.test(text)) return { ...base, intent: "done", todo_id: matchOpenTodo(text, open) };
  if (/thank/i.test(text)) return { ...base, intent: "thanks" };
  if (/^\s*(hi|hey|hello|hiya|yo|good (morning|afternoon|evening)|howdy)\b[\s!.,💜💛❤️]*(juno)?[\s!.]*$/i.test(text)) return { ...base, intent: "smalltalk" };
  return base;
}
