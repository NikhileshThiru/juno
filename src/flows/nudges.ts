// Scheduler tick (every 10s, and right after /skip). Max 2 nudges per to-do;
// at most one nudge per person per virtual day so a /skip produces one clear
// message; escalation goes to the caregiver once both nudges were read.
import { DAY, now } from "../clock.ts";
import { copy } from "../copy.ts";
import { caregiversOf, db, getUser, updateTodo, type Todo } from "../db.ts";
import { log, logError } from "../log.ts";
import { say, send } from "../spectrum.ts";
import { momFor } from "./caregiver.ts";
import { markdown } from "spectrum-ts";

const lastRealNudge = new Map<string, number>();
let running = false;

export async function tick() {
  if (running) return;
  running = true;
  try {
    const t0 = now();
    await nudges(t0);
    await escalations(t0);
    await dayBefore(t0);
  } catch (err) {
    logError("scheduler tick", err);
  } finally {
    running = false;
  }
}

async function nudges(t0: number) {
  // Pharmacy pickups happen at discharge, so they stay on the card but are never nudged.
  const open = db
    .query("SELECT * FROM todos WHERE status = 'todo' AND nudge_count < 2 AND category != 'pharmacy' ORDER BY due_at IS NULL, due_at, sort")
    .all() as Todo[];
  const nudged = new Set<string>();
  for (const t of open) {
    if (nudged.has(t.user_id)) continue;
    const lastVirtual = (db.query("SELECT MAX(sent_at) m FROM outbound WHERE user_id = ? AND kind = 'nudge'").get(t.user_id) as { m: number | null }).m;
    if (lastVirtual && t0 - lastVirtual < DAY - 60 * 60_000) continue;
    if (Date.now() - (lastRealNudge.get(t.user_id) ?? 0) < 60_000) continue;
    const age = t0 - t.created_at;
    const dueSoon = t.due_at != null && t.due_at - t0 <= 5 * DAY;
    const due1 = t.nudge_count === 0 && (age >= 2 * DAY || (age >= DAY && dueSoon));
    const due2 = t.nudge_count === 1 && t.last_nudge_at != null && t0 - t.last_nudge_at >= DAY;
    if (!due1 && !due2) continue;

    const name = getUser(t.user_id)?.name ?? null;
    await send(t.user_id, markdown(due1 ? copy.nudge1(name, t) : copy.nudge2(t)), { kind: "nudge", todoId: t.id });
    updateTodo(t.id, { nudge_count: t.nudge_count + 1, last_nudge_at: t0 });
    lastRealNudge.set(t.user_id, Date.now());
    nudged.add(t.user_id);
    log("🔔", `nudge ${t.nudge_count + 1} → ${name ?? t.user_id}: ${t.title}`);
  }
}

async function escalations(t0: number) {
  const due = db.query("SELECT * FROM todos WHERE status = 'todo' AND nudge_count >= 2 AND escalated_at IS NULL AND category != 'pharmacy'").all() as Todo[];
  for (const t of due) {
    const bothRead = t.nudges_read >= 2;
    const waitedOut = t.last_nudge_at != null && t0 - t.last_nudge_at >= DAY;
    if (!bothRead && !waitedOut) continue;
    const links = caregiversOf(t.user_id).filter((l) => l.share_level);
    if (!links.length) continue;
    const name = getUser(t.user_id)?.name ?? "my mom";
    for (const l of links)
      await send(l.caregiver_id, markdown(copy.escalate(l.caregiver_name ?? "there", momFor(t.user_id, l.caregiver_id), name, t)), { kind: "escalation", todoId: t.id });
    updateTodo(t.id, { escalated_at: t0 });
    log("🚨", `escalated ${t.title} to ${links.map((l) => l.caregiver_name).join(", ")} (${bothRead ? "both nudges read" : "no response in a day"})`);
  }
}

async function dayBefore(t0: number) {
  const soon = db
    .query("SELECT * FROM todos WHERE status = 'booked' AND reminded_day_before = 0 AND appt_at > ? AND appt_at - ? <= ?")
    .all(t0, t0, DAY) as Todo[];
  for (const t of soon) {
    await say(t.user_id, copy.dayBefore(t));
    updateTodo(t.id, { reminded_day_before: 1 });
    log("⏰", `day-before reminder: ${t.title}`);
  }
}

/** Why a skip might do nothing: there are no to-dos to remind about yet. */
export function skipHint(): string | null {
  const open = (db.query("SELECT COUNT(*) n FROM todos WHERE status = 'todo' AND category != 'pharmacy'").get() as { n: number }).n;
  if (open) return null;
  const any = (db.query("SELECT COUNT(*) n FROM todos").get() as { n: number }).n;
  return any ? "Nothing left to remind about: every step is booked or done." : "No to-dos yet. Mom needs to send the discharge photos (1 + 2) first; lab results don't create to-dos.";
}
