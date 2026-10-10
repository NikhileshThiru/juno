// Photos → OpenCV → Gemini classify → discharge | lab | appointment | other.
import { markdown } from "spectrum-ts";
import { sendOrUpdateCard } from "../cards.ts";
import { now, parseLocalIso } from "../clock.ts";
import { copy } from "../copy.ts";
import { getUser, insertDoc, insertTodo, newId, todosFor, updateTodo, upsertUser } from "../db.ts";
import { classify, extractAppointment, extractDischarge, extractLabs, type Image } from "../gemini.ts";
import { direction, group, ORGANS, worst, type Organ } from "../labs.ts";
import { log, logError } from "../log.ts";
import { say } from "../spectrum.ts";
import { asImage, cleanPhoto, type Cleaned } from "../vision.ts";
import { notifyCaregivers } from "./caregiver.ts";
import { applyBooked, matchTodo } from "./status.ts";

export type Photo = { path: string; mimeType: string };

const CATEGORY_ORDER = ["pharmacy", "lab", "imaging", "primary_care", "specialist", "other"];

export async function handlePhotos(userId: string, photos: Photo[]) {
  const docId = newId("doc");
  const t0 = Date.now();
  log("📷", `received ${photos.length} photo${photos.length > 1 ? "s" : ""} → ${docId}`);
  await say(userId, copy.reading(photos.length));
  try {
    const cleaned = await Promise.all(photos.map((p, i) => cleanPhoto(p.path, p.mimeType, `data/docs/${docId}/${i}`)));
    const images = await Promise.all(cleaned.map((c) => asImage(c.clean)));
    const { kind } = await classify(images);
    log("🗂️", `classified as ${kind}`);
    if (kind === "discharge") await handleDischarge(userId, docId, images, cleaned);
    else if (kind === "lab") await handleLabs(userId, docId, images, cleaned);
    else if (kind === "appointment") await handleAppointment(userId, docId, images, cleaned);
    else await say(userId, copy.otherDoc);
    log("⏱️", `${docId} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    logError(`document ${docId} failed`, err);
    await say(userId, copy.unreadable);
  }
}

const save = (userId: string, docId: string, kind: string, cleaned: Cleaned[], data: unknown) =>
  insertDoc({
    id: docId,
    user_id: userId,
    kind,
    raw_paths: JSON.stringify(cleaned.map((c) => c.raw)),
    clean_paths: JSON.stringify(cleaned.map((c) => c.clean)),
    extracted_json: JSON.stringify(data),
    created_at: now(),
  });

async function handleDischarge(userId: string, docId: string, images: Image[], cleaned: Cleaned[]) {
  const d = await extractDischarge(images);
  log("🤖", `discharge: ${d.todos.length} todos, ${d.warning_signs.length} warning signs, ${d.medications.length} meds`);
  save(userId, docId, "discharge", cleaned, d);
  if (d.patient_first_name && !getUser(userId)?.name) upsertUser(userId, { name: d.patient_first_name });

  const created = now();
  // Order by deadline; on ties, tests come before the visits that review their results.
  const todos = d.todos
    .map((t) => ({ t, due: parseLocalIso(t.due_by_iso ? `${t.due_by_iso.slice(0, 10)}T17:00` : null) }))
    .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || CATEGORY_ORDER.indexOf(a.t.category) - CATEGORY_ORDER.indexOf(b.t.category));
  todos.forEach(({ t, due }, i) =>
    insertTodo({
      id: newId("todo"), user_id: userId, doc_id: docId, title: t.title, category: t.category, why: t.why_plain,
      due_at: due, due_text: t.due_text, clinic: t.clinic_name, provider: t.provider, phone: t.phone, script: t.call_script,
      prep: t.prep_plain, status: "todo", appt_at: null, booked_by: null, notes: null, nudge_count: 0, last_nudge_at: null,
      nudges_read: 0, escalated_at: null, reminded_day_before: 0, created_at: created, sort: i,
    }),
  );

  // Warning signs always come first.
  if (d.warning_signs.length) await say(userId, markdown(copy.warnings(d.warning_signs)));
  const newMeds = d.medications.filter((m) => m.status === "new");
  const stopped = d.medications.filter((m) => m.status === "stop");
  const medLines = [
    ...newMeds.map((m) => `• New: ${m.name}${m.dose ? ` ${m.dose}` : ""}${m.how_to_take_plain ? ` — ${m.how_to_take_plain}` : ""}`),
    ...stopped.map((m) => `• **Stop:** ${m.name}`),
  ];
  await say(userId, copy.summary(d.summary_plain, newMeds.length, todos.length), ...(medLines.length ? [markdown(copy.meds(medLines))] : []));
  await sendOrUpdateCard(userId, "tracker");
  await say(userId, copy.numbers(todosFor(userId)), markdown(copy.howToBook));
  await notifyCaregivers(userId, { type: "new_doc" });
}

async function handleLabs(userId: string, docId: string, images: Image[], cleaned: Cleaned[]) {
  const labs = await extractLabs(images);
  save(userId, docId, "lab", cleaned, labs);
  const g = group(labs.tests);
  const flagged = (Object.keys(g) as Organ[]).flatMap((o) => g[o].filter((x) => x.band !== "normal").map((x) => ({ o, ...x })));
  log("🩺", `labs: ${labs.tests.length} tests, ${flagged.length} outside range`);
  const byOrgan = (Object.keys(g) as Organ[])
    .map((o) => ({ o, items: flagged.filter((f) => f.o === o) }))
    .filter((x) => x.items.length)
    .map((x) => `• ${ORGANS[x.o].label}: ${x.items.map((f) => `${f.test.name} (${direction(f.test)})`).join(", ")}`);
  const doctor = labs.ordering_provider ?? "your doctor";
  await say(
    userId,
    flagged.length
      ? `Here are your lab results 🩺 Most are in the normal range. ${flagged.length} are outside the range printed on the report:\n${byOrgan.join("\n")}\n\nThese are worth asking ${doctor} about at your visit.`
      : `Here are your lab results 🩺 Everything is inside the range printed on the report. ${doctor} can tell you more.`,
  );
  await sendOrUpdateCard(userId, "labs", docId, { caption: "Your lab results", subcaption: flagged.length ? `${flagged.length} outside the range · tap for details` : "All in range" });

  // No new medical to-dos: attach "ask about" notes to the primary care visit instead.
  const pcp = todosFor(userId).find((t) => t.category === "primary_care" && t.status !== "done");
  if (pcp && flagged.length) {
    updateTodo(pcp.id, { notes: `Ask about: ${flagged.map((f) => f.test.name).join(", ")}` });
    await sendOrUpdateCard(userId, "tracker");
  }
  const worstOrgans = (Object.keys(g) as Organ[]).filter((o) => worst(g[o].map((x) => x.band)) === "out").map((o) => ORGANS[o].plain);
  await notifyCaregivers(userId, {
    type: "labs",
    line: `🩺 New lab results for ${getUser(userId)?.name ?? "your mom"}: ${flagged.length} of ${labs.tests.length} outside the printed range${worstOrgans.length ? ` (${worstOrgans.join(", ")})` : ""}. She'll ask ${doctor} about them.`,
  });
}

async function handleAppointment(userId: string, docId: string, images: Image[], cleaned: Cleaned[]) {
  const a = await extractAppointment(images);
  save(userId, docId, "appointment", cleaned, a);
  const at = parseLocalIso(a.appt_datetime_iso);
  const todo = matchTodo(userId, `${a.clinic_name ?? ""} ${a.provider ?? ""}`);
  if (!todo || !at) return say(userId, "Thanks! I couldn't tell which appointment that is — could you text me, like *booked heart doctor Tue 2pm*?");
  if (a.prep_plain && !todo.prep) updateTodo(todo.id, { prep: a.prep_plain });
  await applyBooked(userId, todo.id, at, "self");
}
