import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { nowContext } from "./clock.ts";
import { env } from "./env.ts";
import { log } from "./log.ts";

// Free tier: 20 requests/day per model per Google project. Each teammate's key
// is a separate project, so extra keys (GEMINI_API_KEY_2, _3) add free quota.
const KEYS = [env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter((k): k is string => !!k);
const CLIENTS = KEYS.map((apiKey) => new GoogleGenAI({ apiKey }));
const exhausted = new Set<string>(); // "client#model" that hit today's daily cap
// Free-tier keys hit per-minute limits in bursts, and each model has its own
// quota, so fall through to the next model on 429/503 instead of waiting.
// Reading documents gets the strongest model first; quick jobs (sorting a photo,
// understanding a reply) start on the lite model so they don't eat its quota.
const HEAVY = [...new Set([env.GEMINI_MODEL || "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"])];
const LIGHT = ["gemini-3.5-flash-lite", "gemini-3.6-flash", env.GEMINI_MODEL || "gemini-3.5-flash"];
const noThinking = new Set<string>();

const RULES = `Rules: extract only what is written on the page. Never invent phone numbers, names, or dates (use null when absent).
Never add medical advice, diagnosis, or interpretation beyond what the document says. Use plain, warm language at a 6th-grade reading level, no jargon.`;

export type Image = { mimeType: string; data: Buffer };
const imageParts = (images: Image[]): Part[] => images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data.toString("base64") } }));

// Photo reads are cached by (prompt + schema + image bytes): re-sending the same
// camera-roll photo during rehearsals costs no quota and returns instantly.
// Text-only calls carry the current time, so they never hit the cache.
const CACHE_DIR = "data/cache";
function cacheFile(jsonSchema: unknown, parts: Part[]): string | null {
  if (!parts.some((p) => p.inlineData)) return null;
  const h = createHash("sha256").update(JSON.stringify(jsonSchema));
  for (const p of parts) h.update(p.text ?? p.inlineData?.data ?? "");
  return `${CACHE_DIR}/${h.digest("hex").slice(0, 32)}.json`;
}

type Opts = { thinking?: "minimal" | "low"; light?: boolean };

async function generate<T extends z.ZodType>(schema: T, parts: Part[], opts: Opts = {}): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(schema);
  delete (jsonSchema as Record<string, unknown>).$schema;
  const file = cacheFile(jsonSchema, parts);
  if (file && existsSync(file)) {
    log("💾", "Gemini cache hit (same photo as before)");
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  }
  const result = await callModels(schema, jsonSchema, parts, opts);
  if (file) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(result));
  }
  return result;
}

async function callModels<T extends z.ZodType>(schema: T, jsonSchema: unknown, parts: Part[], opts: Opts): Promise<z.infer<T>> {
  let lastErr: unknown;
  const routes = (opts.light ? LIGHT : HEAVY).flatMap((model) => CLIENTS.map((ai, ci) => ({ model, ai, ci })));
  for (const { model, ai, ci } of routes) {
    if (exhausted.has(`${ci}#${model}`)) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = Date.now();
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchema,
            ...(noThinking.has(model) ? {} : { thinkingConfig: { thinkingLevel: (opts.thinking ?? "minimal") as never } }),
          },
        });
        log("🤖", `Gemini ${model}${CLIENTS.length > 1 ? ` (key ${ci + 1})` : ""} ${Date.now() - t}ms`);
        return schema.parse(JSON.parse(res.text ?? "null"));
      } catch (err) {
        lastErr = err;
        const msg = String(err instanceof Error ? err.message : err);
        log("⚠️", `Gemini ${model} (key ${ci + 1}) failed (${msg.slice(0, 120)})`);
        if (/PerDay/.test(msg)) exhausted.add(`${ci}#${model}`); // daily cap: skip until restart
        if (/thinking/i.test(msg) && !noThinking.has(model)) {
          noThinking.add(model); // model doesn't support this thinking level; retry plain
          continue;
        }
        if (/429|quota|503|overload|high demand|UNAVAILABLE|404|NOT_FOUND/i.test(msg)) break; // next key / model
        if (!/timed out|fetch failed|ECONNRESET/i.test(msg)) throw err; // schema/parse bugs: don't mask them
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  throw lastErr;
}

// ---- classify --------------------------------------------------------------

export const Classify = z.object({
  kind: z.enum(["discharge", "lab", "appointment", "other"]),
  confidence: z.number(),
});
export const classify = (images: Image[]) =>
  generate(Classify, [
    ...imageParts(images),
    { text: `Classify this medical paperwork. discharge = hospital discharge instructions / after-visit summary. lab = lab test results. appointment = an appointment reminder card, confirmation, or screenshot. other = anything else.` },
  ], { light: true });

// ---- discharge -------------------------------------------------------------

export const Discharge = z.object({
  patient_first_name: z.string().nullable(),
  facility: z.string().nullable(),
  visit_date: z.string().nullable().describe("discharge date, ISO yyyy-mm-dd"),
  reason_plain: z.string().describe("1 short sentence: why they were in the hospital, plain words"),
  summary_plain: z.string().describe("max 3 short sentences, 6th-grade level"),
  warning_signs: z.array(z.string()).describe("when to call 911 / go to the ER, copied from the document, simplified wording, each under 10 words"),
  medications: z.array(
    z.object({
      name: z.string().describe("plain name, include brand in parentheses if given"),
      dose: z.string().nullable(),
      how_to_take_plain: z.string().nullable(),
      status: z.enum(["new", "continue", "stop", "changed"]),
    }),
  ),
  todos: z.array(
    z.object({
      title: z.string().describe("max 5 words, plain, e.g. 'See a heart doctor', 'Fasting blood test'"),
      category: z.enum(["specialist", "lab", "imaging", "primary_care", "pharmacy", "other"]),
      why_plain: z.string().describe("1 sentence, from the document only"),
      due_by_iso: z.string().nullable().describe("yyyy-mm-dd; compute from visit_date if relative ('within 2 weeks'), else null"),
      due_text: z.string().nullable().describe("deadline as written"),
      clinic_name: z.string().nullable(),
      provider: z.string().nullable(),
      phone: z.string().nullable().describe("exactly as printed, null if absent"),
      prep_plain: z.string().nullable().describe("e.g. 'Nothing to eat for 10–12 hours before'"),
      call_script: z.string().describe("2 short sentences the patient can read aloud when calling to book"),
    }),
  ),
});
export type Discharge = z.infer<typeof Discharge>;
export const extractDischarge = (images: Image[]) =>
  generate(
    Discharge,
    [
      ...imageParts(images),
      {
        text: `These are photos of hospital discharge paperwork (possibly several pages). Extract the structured summary.
Every follow-up appointment, lab test, imaging, or pharmacy pickup the patient must arrange is a todo — look in prose AND tables.
${RULES}`,
      },
    ],
    { thinking: "low" },
  );

// ---- labs ------------------------------------------------------------------

export const Labs = z.object({
  collected_date: z.string().nullable(),
  ordering_provider: z.string().nullable(),
  tests: z.array(
    z.object({
      section: z.string().describe("panel heading the row is under, e.g. BASIC METABOLIC PANEL"),
      name: z.string(),
      value: z.number().nullable(),
      value_text: z.string().describe("value as printed"),
      unit: z.string().nullable(),
      ref_low: z.number().nullable(),
      ref_high: z.number().nullable(),
      ref_text: z.string().nullable(),
      flag: z.enum(["normal", "low", "high", "critical", "unknown"]).describe("flag printed on the report; normal if none"),
      plain_meaning: z.string().describe("1 neutral sentence on what this test measures. NOT an interpretation of the result."),
    }),
  ),
});
export type Labs = z.infer<typeof Labs>;
export const extractLabs = (images: Image[]) =>
  generate(
    Labs,
    [
      ...imageParts(images),
      {
        text: `Extract EVERY result row from this lab report — every panel/section on every page (e.g. metabolic panel, lipids, liver, CBC, thyroid, A1c).
Reports usually have 15–40 rows; do not stop after the first section. For "<200" style ranges set ref_high=200, ref_low=null; for ">59" set ref_low=59. ${RULES}`,
      },
    ],
    { thinking: "low" },
  );

// ---- appointment -----------------------------------------------------------

export const Appointment = z.object({
  clinic_name: z.string().nullable(),
  provider: z.string().nullable(),
  appt_datetime_iso: z.string().nullable().describe("local time, yyyy-mm-ddThh:mm, no timezone"),
  prep_plain: z.string().nullable(),
});
export const extractAppointment = (images: Image[]) =>
  generate(Appointment, [...imageParts(images), { text: `Extract the appointment details. ${nowContext()} Resolve weekday-only dates to the next such date. ${RULES}` }]);

// ---- inbound text intent ---------------------------------------------------

export const Intent = z.object({
  intent: z.enum(["booked", "done", "add_caregiver", "question", "status", "thanks", "smalltalk", "other"]),
  todo_id: z.string().nullable().describe("id of the matching open todo, or null if unclear"),
  appt_datetime_iso: z.string().nullable().describe("local time yyyy-mm-ddThh:mm, no timezone"),
  caregiver_phone: z.string().nullable(),
  caregiver_name: z.string().nullable(),
  caregiver_relation: z.string().nullable().describe("e.g. daughter, son"),
});
export type Intent = z.infer<typeof Intent>;
export const classifyText = (text: string, todos: { id: string; title: string; clinic: string | null; status: string }[], role: string) =>
  generate(Intent, [
    {
      text: `You route messages for Juno, an assistant that helps a patient track follow-up care after a hospital stay. The sender is the ${role}.
${nowContext()} Resolve relative dates/times ("Tue 2pm", "tomorrow at 9") to the NEXT such time, in America/New_York.
Open todos (JSON): ${JSON.stringify(todos)}
Intents: booked = they scheduled one of the todos (maybe "for her"); done = they completed/went to one; add_caregiver = they want to add a family member/helper;
question = asking what something means; status = asking how things are going / what's left; thanks; smalltalk; other.
Match todo_id by meaning (e.g. "heart doctor" → cardiology, "blood work" → lab). Message: """${text}"""`,
    },
  ], { light: true });

// ---- questions -------------------------------------------------------------

export const Answer = z.object({ answer: z.string().describe("max 3 short sentences, plain words") });
export const answerQuestion = (question: string, context: string) =>
  generate(Answer, [
    {
      text: `You are Juno. Answer the patient's question briefly using ONLY this context from their own paperwork. If the context doesn't cover it, say you don't see it in their papers.
Never diagnose, never recommend treatment changes, never say a result is fine or dangerous. Do not add a sign-off; the app appends one.
Context: ${context}
Question: """${question}"""`,
    },
  ], { light: true });
