// Booked / Done transitions. Every path (Mom's text, Mom's appointment photo,
// the caregiver's text, a poll vote) ends up here so the card, the .ics, and
// the caregiver updates always stay consistent.
import { attachment } from "spectrum-ts";
import { effect, imessage } from "spectrum-ts/providers/imessage";
import { sendOrUpdateCard } from "../cards.ts";
import { copy } from "../copy.ts";
import { caregiversOf, getTodo, getUser, todosFor, updateTodo, type Todo } from "../db.ts";
import { buildIcs } from "../ics.ts";
import { log } from "../log.ts";
import { say, send } from "../spectrum.ts";
import { cgLabel, momFor, notifyCaregivers } from "./caregiver.ts";

export async function applyBooked(patientId: string, todoId: string, apptAt: number, bookedBy: string) {
  updateTodo(todoId, { status: "booked", appt_at: apptAt, booked_by: bookedBy, reminded_day_before: 0 });
  const t = getTodo(todoId)!;
  log("📅", `booked: ${t.title} @ ${new Date(apptAt).toISOString()} by ${bookedBy}`);
  await sendOrUpdateCard(patientId, "tracker");
  const helper = bookedBy === "self" ? null : cgLabel(patientId, bookedBy);
  await say(patientId, helper ? copy.bookedByHelper(t, helper) : copy.booked(t));
  const ics = buildIcs(t);
  await send(patientId, attachment(ics.data, { name: ics.name, mimeType: "text/calendar" }));
  if (bookedBy !== "self") await say(bookedBy, copy.cgThanks(t, momFor(patientId, bookedBy)));
  await notifyCaregivers(patientId, { type: "booked", todo: t, by: bookedBy }, bookedBy);
}

export async function applyDone(patientId: string, todoId: string, by: string) {
  updateTodo(todoId, { status: "done" });
  const t = getTodo(todoId)!;
  await sendOrUpdateCard(patientId, "tracker");
  const all = todosFor(patientId);
  if (all.length && all.every((x) => x.status === "done")) {
    await send(patientId, effect(copy.allDone, imessage.effect.message.confetti));
    log("🎉", "all done → confetti");
  }
  else if (by === "self") await say(patientId, copy.done(t));
  await notifyCaregivers(patientId, { type: "done", todo: t }, by);
}

/** Best-effort match of a free-text clinic/provider to an open todo. */
export function matchTodo(patientId: string, hint: string): Todo | null {
  const open = todosFor(patientId).filter((t) => t.status !== "done");
  const words = hint.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const score = (t: Todo) => words.filter((w) => `${t.title} ${t.clinic} ${t.provider} ${t.category}`.toLowerCase().includes(w)).length;
  const best = open.map((t) => [t, score(t)] as const).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}

export const patientName = (id: string) => getUser(id)?.name ?? "your mom";
