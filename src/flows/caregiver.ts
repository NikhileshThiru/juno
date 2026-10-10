// Care circle: Mom adds a family member, chooses what they see (native poll),
// and they get a separate 1:1 chat with updates. They can book things for her.
import { poll, richlink } from "spectrum-ts";
import { tokenFor } from "../cards.ts";
import { publicBaseUrl } from "../env.ts";
import { parseLocalIso } from "../clock.ts";
import { copy } from "../copy.ts";
import { caregiversOf, latestDoc, linkCaregiver, patientsOf, savePoll, setSetting, getSetting, setShareLevel, todosFor, upsertUser, type Todo } from "../db.ts";
import type { Discharge } from "../gemini.ts";
import { matchOpenTodo } from "../parse.ts";
import { understand } from "../intent.ts";
import { log } from "../log.ts";
import { say, send } from "../spectrum.ts";
import { applyBooked, applyDone, patientName } from "./status.ts";

export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d.length > 7 ? `+${d}` : null;
}

export async function addCaregiver(patientId: string, rawPhone: string, name: string | null, relation: string | null) {
  const phone = normalizePhone(rawPhone);
  if (!phone || phone === patientId) return say(patientId, "Hmm, I couldn't use that number. Could you share their contact card or type the number?");
  const cgName = name?.split(" ")[0] ?? "them";
  upsertUser(phone, { name: name?.split(" ")[0] ?? null, role: "caregiver" });
  linkCaregiver(patientId, phone, cgName);
  setSetting(`relation:${patientId}:${phone}`, relation ?? "");
  log("👪", `caregiver ${cgName} (${phone}) linked to ${patientId}`);

  // Ask Mom what to share; the vote arrives as poll_option. "1"/"2" text works too.
  const sent = await send(patientId, poll(copy.askShare(cgName), ...copy.shareOptions));
  if (sent) savePoll(sent.id, patientId, "share", { caregiverId: phone });
  // First message to someone new: text only, no links or media (Apple suppresses them).
  await say(phone, copy.cgIntro(cgName, patientName(patientId), relation || null));
}

export async function onShareChosen(patientId: string, caregiverId: string, level: "todos" | "everything") {
  setShareLevel(patientId, caregiverId, level);
  const link = caregiversOf(patientId).find((l) => l.caregiver_id === caregiverId)!;
  await say(patientId, copy.shareSet(link.caregiver_name ?? "them", level));
  await say(caregiverId, summaryFor(patientId, level));
  // Not the first message to them (the intro was), so a link is fine now.
  await send(caregiverId, richlink(`${publicBaseUrl()}/plan/${tokenFor(patientId)}?as=family`));
}

function summaryFor(patientId: string, level: "todos" | "everything") {
  const todos = todosFor(patientId);
  let extra: string | undefined;
  if (level === "everything") {
    const doc = latestDoc(patientId, "discharge");
    if (doc) {
      const d = JSON.parse(doc.extracted_json) as Discharge;
      const meds = d.medications.filter((m) => m.status !== "continue").map((m) => `${m.status === "stop" ? "🛑 stop" : "💊 new"}: ${m.name}${m.dose ? ` ${m.dose}` : ""}`);
      extra = `${d.reason_plain}${meds.length ? `\n${meds.join("\n")}` : ""}`;
    }
  }
  return copy.cgSummary(patientName(patientId), todos, extra);
}

export type CareEvent = { type: "new_doc" } | { type: "booked"; todo: Todo; by: string } | { type: "done"; todo: Todo } | { type: "labs"; line: string };

export async function notifyCaregivers(patientId: string, ev: CareEvent, except?: string) {
  for (const link of caregiversOf(patientId)) {
    if (!link.share_level || link.caregiver_id === except) continue;
    const p = patientName(patientId);
    if (ev.type === "new_doc") await say(link.caregiver_id, summaryFor(patientId, link.share_level));
    if (ev.type === "booked") await say(link.caregiver_id, copy.cgBooked(p, ev.todo, ev.by));
    if (ev.type === "done") await say(link.caregiver_id, copy.cgDone(p, ev.todo));
    if (ev.type === "labs" && link.share_level === "everything") await say(link.caregiver_id, ev.line);
  }
}

export async function handleCaregiverText(caregiverId: string, text: string) {
  const patientId = patientsOf(caregiverId)[0]?.patient_id;
  if (!patientId) return;
  const open = todosFor(patientId).filter((t) => t.status !== "done");
  const brief = open.map((t) => ({ id: t.id, title: t.title, clinic: t.clinic, status: t.status, category: t.category }));
  const intent = await understand(text, brief, "caregiver (a family member helping the patient)");
  // A to-do the message names wins; otherwise "booked it" after an escalation
  // means the escalated to-do, which beats the model's guess.
  const named = matchOpenTodo(text, brief);
  const escalated = open.filter((t) => t.escalated_at).sort((a, b) => b.escalated_at! - a.escalated_at!)[0];
  const todo =
    open.find((t) => t.id === named) ?? escalated ?? open.find((t) => t.id === intent.todo_id) ?? (open.length === 1 ? open[0] : undefined);
  const at = parseLocalIso(intent.appt_datetime_iso);

  if (intent.intent === "booked" && todo && at) return applyBooked(patientId, todo.id, at, caregiverId);
  if (intent.intent === "booked" && todo) return say(caregiverId, copy.needTime(todo));
  if (intent.intent === "booked") {
    const sent = await send(caregiverId, poll(copy.whichOne, ...open.map((t) => t.title)));
    if (sent) savePoll(sent.id, caregiverId, "which", { patientId, at, todoIds: open.map((t) => t.id) });
    return;
  }
  if (intent.intent === "done" && todo) return applyDone(patientId, todo.id, caregiverId);
  if (intent.intent === "status") return say(caregiverId, copy.cgSummary(patientName(patientId), todosFor(patientId)));
  if (intent.intent === "thanks") return say(caregiverId, "Anytime 💛");
  return say(caregiverId, `I'll keep you posted on ${patientName(patientId)}'s follow-ups 💛 If you book something for her, just text me the day and time.`);
}

export function pendingShare(patientId: string) {
  return caregiversOf(patientId).find((l) => !l.share_level) ?? null;
}

export const relationOf = (patientId: string, cg: string) => getSetting(`relation:${patientId}:${cg}`) || null;
export const isCaregiver = (userId: string) => patientsOf(userId).length > 0 && todosFor(userId).length === 0;
