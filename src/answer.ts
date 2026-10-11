// Questions about your own care: "when is my heart appointment?", "what's
// Eliquis for?", "can I eat before my blood test?", "what was my potassium?".
// Answers come from the patient's own plan and papers, locally and instantly
// when possible; Gemini only for questions the patterns can't place. Juno never
// diagnoses or recommends changes, and lab answers only compare to the printed range.
import { fmtShort, fmtWhen, now } from "./clock.ts";
import { caregiversOf, getUser, latestDoc, todosFor, type Todo } from "./db.ts";
import { answerQuestion, type Discharge, type Labs } from "./gemini.ts";
import { bandOf, direction, group, ORGANS, organOf, type Organ, type Test } from "./labs.ts";
import { thing } from "./copy.ts";
import { log } from "./log.ts";
import { matchOpenTodo } from "./parse.ts";

const ASK_PHARMACIST = "Your pharmacist or doctor can tell you more.";

/** Plain, neutral one-liners about what common medicines are generally for (like a pharmacy leaflet). */
const MED_GUIDE: { names: string[]; what: string; kind: string }[] = [
  { names: ["apixaban", "eliquis"], what: "a blood thinner. It helps prevent blood clots, which lowers the chance of a stroke with AFib", kind: "blood thinner" },
  { names: ["warfarin", "coumadin", "jantoven"], what: "a blood thinner. It helps prevent blood clots", kind: "blood thinner" },
  { names: ["rivaroxaban", "xarelto"], what: "a blood thinner. It helps prevent blood clots", kind: "blood thinner" },
  { names: ["clopidogrel", "plavix"], what: "an anti-platelet medicine. It helps keep blood clots from forming", kind: "blood thinner" },
  { names: ["metoprolol", "lopressor", "toprol"], what: "a beta blocker. It slows the heart rate and lowers blood pressure", kind: "heart rate" },
  { names: ["diltiazem", "cardizem"], what: "a calcium channel blocker. It slows the heart rate and lowers blood pressure", kind: "heart rate" },
  { names: ["atorvastatin", "lipitor"], what: "a statin. It lowers cholesterol", kind: "cholesterol" },
  { names: ["rosuvastatin", "crestor", "simvastatin", "zocor"], what: "a statin. It lowers cholesterol", kind: "cholesterol" },
  { names: ["potassium chloride", "klor-con", "k-dur"], what: "a potassium supplement. It brings a low potassium level back up", kind: "potassium" },
  { names: ["lisinopril", "losartan", "amlodipine"], what: "a blood pressure medicine", kind: "blood pressure" },
  { names: ["furosemide", "lasix"], what: "a water pill. It helps the body get rid of extra fluid", kind: "water pill" },
  { names: ["metformin"], what: "a diabetes medicine. It helps lower blood sugar", kind: "blood sugar" },
  { names: ["levothyroxine", "synthroid"], what: "a thyroid hormone medicine", kind: "thyroid" },
  { names: ["ibuprofen", "advil", "motrin", "naproxen", "aleve"], what: "a pain reliever called an NSAID", kind: "pain" },
  { names: ["acetaminophen", "tylenol"], what: "a pain and fever reliever", kind: "pain" },
  { names: ["aspirin"], what: "a pain reliever that also thins the blood", kind: "pain" },
];

// Words that, said about yourself right now, mean "call 911", not "chat".
const EMERGENCY =
  /\b(chest (pain|pressure|hurts)|can'?t breathe|cannot breathe|trouble breathing|short(ness)? of breath|passed out|fainted|fainting|face (is )?droop\w*|slurr\w*|trouble speaking|can'?t speak|numb(ness)?|weak(ness)? on one side|black stools?|blood in (my |her )?(urine|pee)|bleeding (a lot|won'?t stop)|heart (is )?(racing|pounding))\b/i;


type Ctx = {
  family: boolean;
  name: string;
  todos: Todo[];
  meds: Discharge["medications"];
  warnings: string[];
  labs: Labs | null;
  helpers: Map<string, string>;
};

function context(patientId: string, family: boolean): Ctx {
  const discharge = latestDoc(patientId, "discharge");
  const lab = latestDoc(patientId, "lab");
  const d = discharge ? (JSON.parse(discharge.extracted_json) as Discharge) : null;
  return {
    family,
    name: getUser(patientId)?.name ?? "your mom",
    todos: todosFor(patientId),
    meds: d?.medications ?? [],
    warnings: d?.warning_signs ?? [],
    labs: lab ? (JSON.parse(lab.extracted_json) as Labs) : null,
    helpers: new Map(caregiversOf(patientId).map((l) => [l.caregiver_id, l.caregiver_name ?? "family"])),
  };
}

// "your" / "her" depending on who is asking.
const P = (c: Ctx) => (c.family ? { your: "her", you: "she", You: "She", have: "has", Your: "Her" } : { your: "your", you: "you", You: "You", have: "have", Your: "Your" });

const guideFor = (name: string) => MED_GUIDE.find((g) => g.names.some((n) => name.toLowerCase().includes(n)));

function findMed(text: string, c: Ctx) {
  const t = text.toLowerCase();
  return (
    c.meds.find((m) => m.name.toLowerCase().split(/[^a-z-]+/).some((w) => w.length > 3 && t.includes(w))) ??
    c.meds.find((m) => guideFor(m.name) && t.includes(guideFor(m.name)!.kind))
  );
}

const LAB_ALIASES: [RegExp, RegExp][] = [
  [/\ba1c\b/i, /a1c/i],
  [/\b(ldl|bad cholesterol)\b/i, /ldl/i],
  [/\b(hdl|good cholesterol)\b/i, /hdl/i],
  [/\bcholesterol\b/i, /cholesterol, total|total cholesterol/i],
  [/\b(sugar|glucose)\b/i, /glucose/i],
  [/\bpotassium\b/i, /potassium/i],
  [/\bsodium\b/i, /sodium/i],
  [/\bcreatinine\b/i, /creatinine/i],
  [/\begfr|gfr\b/i, /egfr/i],
  [/\bhemoglobin\b(?! a1c)/i, /^hemoglobin$/i],
  [/\b(tsh)\b/i, /tsh/i],
  [/\bplatelets?\b/i, /platelet/i],
  [/\btriglycerides?\b/i, /triglycer/i],
];
const ORGAN_WORDS: [RegExp, Organ][] = [
  [/kidney/i, "kidneys"],
  [/liver/i, "liver"],
  [/heart|cholesterol/i, "heart"],
  [/thyroid/i, "thyroid"],
];

function labLine(t: Test) {
  const band = bandOf(t);
  const where = band === "normal" ? "inside the printed range" : `${direction(t)} compared with the printed range`;
  return `${t.name}: ${t.value_text}${t.unit ? ` ${t.unit}` : ""} (range ${t.ref_text ?? "not listed"}), ${where}`;
}

/** Deterministic answers from the plan and papers. Null when the question isn't one we can place. */
function localAnswer(text: string, c: Ctx): string | null {
  const t = text.toLowerCase();
  const p = P(c);
  const doctor = c.labs?.ordering_provider ?? (c.family ? "her doctor" : "your doctor");

  // Warning signs list.
  if (/warning sign|emergency|\ber\b|911|when should (i|she) (call|go)/.test(t) && c.warnings.length)
    return `**Call 911 or go to the ER if ${p.you} ${p.have}:**\n${c.warnings.map((w) => `• ${w}`).join("\n")}`;

  // Medicines.
  const med = findMed(text, c);
  const lab = c.labs ? LAB_ALIASES.find(([q]) => q.test(t)) : undefined;
  const preferLab = lab && (!med || !/\b(take|pill|tablet|dose|medicine|supplement|prescription)\b/.test(t));
  if (med && !preferLab) {
    const g = guideFor(med.name);
    const how = med.how_to_take_plain ? ` ${med.how_to_take_plain.replace(/\.$/, "")}.` : "";
    if (med.status === "stop") return `${p.Your} papers say to **stop taking ${med.name}**.${g ? ` It's ${g.what}.` : ""}\n\n${ASK_PHARMACIST}`;
    if (/\b(what is|what's|whats|what does|for\b|why)/.test(t) && g)
      return `**${med.name}** is ${g.what}. ${p.Your} papers say:${how || " see your medicine list."}\n\n${ASK_PHARMACIST}`;
    return `**${med.name}${med.dose ? ` ${med.dose}` : ""}**:${how || " the papers don't say how to take it."}${med.status === "new" ? " It's a new medicine." : ""}\n\n${ASK_PHARMACIST}`;
  }
  if (/\b(meds|medicines?|medications?|pills|prescriptions)\b/.test(t) && c.meds.length && !/\b(pick|pharmacy)\b/.test(t)) {
    const stop = c.meds.filter((m) => m.status === "stop");
    if (/\bstop\b/.test(t)) return stop.length ? `${p.Your} papers say to stop: ${stop.map((m) => m.name).join(", ")}.\n\n${ASK_PHARMACIST}` : "Your papers don't list any medicines to stop.";
    const lines = c.meds
      .filter((m) => m.status !== "stop")
      .map((m) => `• ${m.name}${m.dose ? ` ${m.dose}` : ""}: ${m.how_to_take_plain ?? ""}${m.status === "new" ? " (new)" : ""}`);
    return `💊 **${p.Your} medicines**\n${lines.join("\n")}${stop.length ? `\n🛑 Stop: ${stop.map((m) => m.name).join(", ")}` : ""}\n\n${ASK_PHARMACIST}`;
  }

  // Lab results: a test, an organ, or the summary.
  if (c.labs) {
    if (lab && preferLab) {
      const test = c.labs.tests.find((x) => lab[1].test(x.name));
      if (test) return `${p.Your} ${labLine(test)}.\n\n${doctor} can explain what it means for ${c.family ? "her" : "you"}.`;
    }
    const organ = /\b(lab|labs|result|results|blood work|level|levels)\b/.test(t) || /how (are|is) (my|her) (kidney|liver|thyroid|heart)/.test(t) ? ORGAN_WORDS.find(([re]) => re.test(t))?.[1] : undefined;
    if (organ) {
      const tests = c.labs.tests.filter((x) => organOf(x.name) === organ);
      return `Here's what the report shows for ${p.your} ${ORGANS[organ].plain}:\n${tests.map((x) => `• ${labLine(x)}`).join("\n")}\n\n${doctor} can explain what it means for ${c.family ? "her" : "you"}.`;
    }
    if (/\b(lab results?|labs|blood work results?|test results?|my results)\b/.test(t)) {
      const flagged = c.labs.tests.filter((x) => bandOf(x) !== "normal");
      const g = group(c.labs.tests);
      const organs = (Object.keys(g) as Organ[]).filter((o) => g[o].some((x) => x.band !== "normal")).map((o) => ORGANS[o].plain);
      return `${c.labs.tests.length - flagged.length} of ${c.labs.tests.length} results are inside the printed range. ${flagged.length} are outside it (${organs.join(", ")}): ${flagged.map((x) => x.name).join(", ")}.\n\nThose are good questions for ${doctor}. Ask me about any one, like *what was my potassium?*`;
    }
  }

  // Appointments and to-dos.
  const named = matchOpenTodo(text, c.todos.map((x) => ({ id: x.id, title: x.title, clinic: x.clinic, status: x.status, category: x.category })));
  let todo = c.todos.find((x) => x.id === named);
  if (!todo && /\b(next|upcoming|coming up|appointment|appointments|visit)\b/.test(t)) {
    const booked = c.todos.filter((x) => x.status === "booked" && (x.appt_at ?? 0) >= now()).sort((a, b) => a.appt_at! - b.appt_at!);
    if (booked[0]) todo = booked[0];
    else {
      const open = c.todos.filter((x) => x.status === "todo").sort((a, b) => (a.due_at ?? Infinity) - (b.due_at ?? Infinity));
      if (!open.length) return `🎉 Everything on ${p.your} list is done. Nothing is booked right now.`;
      return `Nothing is booked right now. Next to book: ${open.map((x) => `the ${thing(x)}${x.due_at ? ` (by ${fmtShort(x.due_at)})` : ""}${x.phone ? `, ${x.phone}` : ""}`).join("; ")}.`;
    }
  }
  if (!todo) return null;
  const where = [todo.clinic, todo.provider].filter(Boolean).join(" (") + (todo.clinic && todo.provider ? ")" : "");
  const helper = todo.booked_by && todo.booked_by !== "self" ? c.helpers.get(todo.booked_by) : null;
  const title = thing(todo);
  if (/\b(number|phone|call)\b/.test(t)) return todo.phone ? `${todo.clinic ?? todo.title}: ${todo.phone}` : `I don't see a phone number for the ${title} in the papers.`;
  if (/\b(bring|prep|prepare|eat|drink|fast|fasting|before)\b/.test(t))
    return todo.prep ? `For the ${title}: ${todo.prep}` : `I don't see any special instructions for the ${title} in the papers.`;
  if (/\bwhere|address|location\b/.test(t)) return where ? `The ${title} is at ${where}.` : `The papers don't say where the ${title} is.`;
  if (todo.status === "done") return `✅ ${p.Your} ${title} is already done.`;
  if (todo.status === "booked")
    return `📅 ${p.Your} ${title} is **${fmtWhen(todo.appt_at!)}**${where ? ` at ${where}` : ""}.${helper ? ` ${helper} booked it 💜` : ""}${todo.prep ? `\n\nRemember: ${todo.prep}` : ""}`;
  return `${p.You} ${c.family ? "hasn't" : "haven't"} booked ${p.your} ${title} yet${todo.due_at ? `. It should happen by **${fmtShort(todo.due_at)}**` : ""}.${todo.phone ? `\n\n${todo.clinic ?? "Call"}: ${todo.phone}` : ""}${c.family ? "" : "\n\nWhen you book it, just text me the day and time."}`;
}

export type Asked = { text: string; emergency: boolean };

/** A message describing a warning-sign symptom right now (not a question about what one means). */
export const isEmergency = (text: string) => EMERGENCY.test(text) && !/\bwhat (is|are|does)|warning/i.test(text);

export async function answer(patientId: string, question: string, family: boolean): Promise<Asked> {
  const c = context(patientId, family);
  if (isEmergency(question)) {
    const who = family ? `If ${c.name} has that right now, call 911` : "If you're having that right now, please call 911";
    return { text: `🚨 ${who} or go to the nearest emergency room. That's on the warning-signs list from the hospital.`, emergency: true };
  }
  const local = localAnswer(question, c);
  if (local) {
    log("💡", `answered from ${family ? "her" : "the"} plan & papers (no AI)`);
    return { text: local, emergency: false };
  }
  const brief = {
    viewer: family ? "family member asking about the patient" : "patient",
    patient_name: c.name,
    steps: c.todos.map((t) => ({
      title: t.title, status: t.status, due: t.due_at ? fmtShort(t.due_at) : t.due_text, appointment: t.appt_at ? fmtWhen(t.appt_at) : null,
      clinic: t.clinic, provider: t.provider, phone: t.phone, prep: t.prep, booked_by: t.booked_by && t.booked_by !== "self" ? c.helpers.get(t.booked_by) : null,
    })),
    medications: c.meds,
    warning_signs: c.warnings,
    labs: c.labs?.tests.map((t) => ({ name: t.name, value: t.value_text, unit: t.unit, range: t.ref_text, compared_to_range: bandOf(t) === "normal" ? "inside" : direction(t) })) ?? [],
  };
  const res = await answerQuestion(question, JSON.stringify(brief), family).catch(() => null);
  if (!res) return { text: `I can't look that up right this second. ${ASK_PHARMACIST}`, emergency: false };
  return { text: res.medical ? `${res.answer}\n\n${ASK_PHARMACIST}` : res.answer, emergency: false };
}
