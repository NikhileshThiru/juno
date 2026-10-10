// Virtual clock: now() = real time + offset. /skip moves the offset so nudges
// and escalations can be demoed in minutes instead of days.
import { getSetting, setSetting } from "./db.ts";

export const TZ = "America/New_York";

export function offsetMs(): number {
  return Number(getSetting("clock_offset_ms") ?? 0);
}
export function now(): number {
  return Date.now() + offsetMs();
}
export function skip(ms: number) {
  setSetting("clock_offset_ms", String(offsetMs() + ms));
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function parseDuration(s: string): number | null {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(d|h|m)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2]!.toLowerCase() === "d" ? n * DAY : m[2]!.toLowerCase() === "h" ? n * HOUR : n * 60_000;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => (t: number) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, ...opts }).format(t);
/** "Thu, Oct 15" */
export const fmtDay = fmt({ weekday: "short", month: "short", day: "numeric" });
/** "Oct 15" */
export const fmtShort = fmt({ month: "short", day: "numeric" });
/** "2:00 PM" */
export const fmtTime = fmt({ hour: "numeric", minute: "2-digit" });
/** "Thu, Oct 15 · 2:00 PM" */
export const fmtWhen = (t: number) => `${fmtDay(t)} · ${fmtTime(t)}`;
/** Context string for Gemini so relative dates ("Tue 2pm") resolve against the virtual clock. */
export const nowContext = () =>
  `Current date/time in ${TZ}: ${new Intl.DateTimeFormat("en-US", { timeZone: TZ, dateStyle: "full", timeStyle: "short" }).format(now())}.`;

/** Parse an ISO string from Gemini. Bare local times ("2026-10-20T14:00:00") are treated as America/New_York. */
export function parseLocalIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(iso)) return Date.parse(iso) || null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [y, mo, d, h = "09", mi = "00"] = m.slice(1) as string[];
  // Find the UTC instant whose New York wall time equals the requested one.
  const guess = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi);
  const nyParts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(guess)
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  const asNy = Date.UTC(+nyParts.year!, +nyParts.month! - 1, +nyParts.day!, +nyParts.hour!, +nyParts.minute!);
  return guess + (guess - asNy);
}

/** Virtual-or-real instant as New York wall time, "yyyy-mm-ddThh:mm" (for <input type=datetime-local>). */
export function toLocalIso(t: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(t)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
