// Understanding an inbound text. Local patterns first (free, instant,
// deterministic); Gemini only for messages they can't place, because the free
// tier allows 20 requests/day per model.
import { classifyText } from "./gemini.ts";
import { log } from "./log.ts";
import { localIntent } from "./parse.ts";

const LOCAL_OK = new Set(["booked", "done", "add_caregiver", "status", "thanks"]);

export async function understand(text: string, brief: Parameters<typeof localIntent>[1], role: string) {
  const local = localIntent(text, brief);
  if (LOCAL_OK.has(local.intent)) {
    log("🧭", `intent (local): ${local.intent} todo=${local.todo_id} at=${local.appt_datetime_iso}`);
    return local;
  }
  const intent = await classifyText(text, brief, role).catch((err) => {
    log("🧩", `Gemini unavailable, using local parser (${String(err).slice(0, 60)})`);
    return local;
  });
  log("🧭", `intent (gemini): ${intent.intent} todo=${intent.todo_id} at=${intent.appt_datetime_iso}`);
  return intent;
}
