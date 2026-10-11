// Every user-facing sentence lives here: warm, short, ~6th-grade reading level.
// 💜 is Juno's signature (it matches the cards); use it sparingly.
import { fmtAt, fmtShort, fmtTime } from "./clock.ts";
import type { Todo } from "./db.ts";

export const ASK_DOCTOR = "Your doctor or pharmacist can tell you more.";

/** A to-do as a phrase: "See a heart doctor" → "heart doctor visit", "Pick up new prescriptions" → "prescription pickup". */
export function thing(t: { title: string }): string {
  const see = t.title.match(/^see (a |an |your |the |her )?(.+)$/i);
  if (see) return `${see[2]!.toLowerCase()} visit`;
  const pick = t.title.match(/^pick up (new )?(.+)$/i);
  if (pick) return `${pick[2]!.toLowerCase().replace(/s$/, "")} pickup`;
  return t.title.charAt(0).toLowerCase() + t.title.slice(1);
}

/** "Linda Chen, MD" → "Dr. Chen". */
export function drName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (!/^dr\.?\s|,?\s*(MD|DO)\.?$/i.test(name.trim())) return name; // a clinic, not a doctor
  const bare = name.trim().replace(/^dr\.?\s+/i, "").replace(/,?\s*(MD|DO)\.?$/i, "");
  return `Dr. ${bare.split(/\s+/).pop()}`;
}

/** "Cholesterol, Total" → "total cholesterol", "LDL Cholesterol (calc)" → "LDL cholesterol". */
export function testName(name: string): string {
  let n = name.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const flip = n.match(/^([^,]+),\s*(.+)$/);
  if (flip) n = `${flip[2]} ${flip[1]}`;
  return n
    .split(/\s+/)
    .map((w) => (/^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
    .join(" ");
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lines = (todos: Todo[]) =>
  todos
    .map((t) => `${t.status === "done" ? "✅" : t.status === "booked" ? "📅" : "☐"} ${t.title}${t.status === "booked" ? `: ${fmtAt(t.appt_at!)}` : t.status === "todo" && t.due_at ? `, by ${fmtShort(t.due_at)}` : ""}`)
    .join("\n");

export const copy = {
  // first contact
  welcome: (name?: string | null) =>
    `Hi${name ? ` ${name}` : ""}! I'm Juno 💜\n\nI help you understand your hospital paperwork and keep track of what to do next. I'm not a doctor. I explain what your papers say and make the next steps easy.`,
  askForPhoto: "Whenever you're ready, take a photo of your discharge papers and send it here. You can send several pages at once.",
  greeting: (name: string | null, hasPlan: boolean) =>
    hasPlan
      ? `Hi${name ? ` ${name}` : ""} 💜 Ask me anything about your appointments, medicines, or results, or tell me when you book something.`
      : `Hi${name ? ` ${name}` : ""} 💜 Send me a photo of your discharge papers whenever you're ready.`,
  fallback: (hasPlan: boolean) =>
    hasPlan
      ? "I'm here 💜 You can ask me about your appointments, medicines, or results, tell me when you book something, or say *show my list*."
      : "I'm here 💜 Send me a photo of your discharge papers whenever you're ready, and I'll take it from there.",
  thanks: "Anytime 💜",
  noPapersYet: "I don't have any of your papers yet. Send me a photo and I can help.",

  // reading documents
  reading: (n: number) => (n === 1 ? "Got it, reading it now 👀" : n === 2 ? "Got both pages, reading them now 👀" : `Got all ${n} pages, reading them now 👀`),
  unreadable: "I couldn't read that one clearly. Could you try again with the whole page in the photo and good light?",
  otherDoc: "I can help with discharge papers, lab results, and appointment reminders. That one doesn't look like any of those. Want to try another photo?",
  unknownAppointment: "Thanks! I couldn't tell which appointment that is. Could you text me, like *booked heart doctor Tue 2pm*?",

  // discharge explanation
  warnings: (signs: string[]) => `**Call 911 or go to the ER if you have:**\n${signs.map((s) => `• ${s}`).join("\n")}`,
  overview: (summary: string, newMeds: number, todos: number, medLines: string[]) => {
    const counts = [newMeds && `${newMeds} new medicine${newMeds > 1 ? "s" : ""}`, todos && `${todos} thing${todos > 1 ? "s" : ""} to do`].filter(Boolean).join(" and ");
    return `${summary}${counts ? ` You have ${counts}.` : ""}${medLines.length ? `\n\n💊 **Your medicines**\n${medLines.join("\n")}` : ""}`;
  },
  nextSteps: (todos: Todo[]) => {
    const calls = todos.filter((t) => t.phone && t.status === "todo").map((t) => `• ${t.title}: ${t.phone}`);
    return `${calls.length ? `📞 **Numbers to call**\n${calls.join("\n")}\n\n` : ""}When you book one, text me the day and time (like *booked heart doctor Tue 2pm*), or tap the step in the card above.`;
  },

  // tracking
  booked: (t: Todo) => `✅ Got it: your ${thing(t)} is **${fmtAt(t.appt_at!)}**. Tap the invite below to add it to your calendar.`,
  bookedByHelper: (t: Todo, helper: string) => `💜 ${helper} booked your ${thing(t)} for **${fmtAt(t.appt_at!)}**. Tap the invite below to add it to your calendar.`,
  needTime: (t: Todo) => `Great! When is your ${thing(t)}? Something like *Tue 2pm* works.`,
  done: (t: Todo) => `✅ Nice work. Your ${thing(t)} is done.`,
  allDone: "You did everything on your list 🎉",
  whichOne: "Which one did you book?",
  whichDone: "Which one did you finish?",
  status: (todos: Todo[]) => {
    if (!todos.length) return "Nothing on your list yet. Send me a photo of your papers anytime.";
    if (todos.every((t) => t.status === "done")) return "Everything on your list is done 🎉";
    return `Here's where things stand:\n${lines(todos)}`;
  },
  carePlan: "Here's your care plan 👇",

  // adding family
  askCaregiver: (name: string | null) => `Of course 💜 Share ${name ? `${name}'s` : "their"} contact card here, or type their number.`,
  badNumber: "Hmm, I couldn't use that number. Could you share their contact card or type the number?",
  askShare: (name: string) => `What should ${name} see?`,
  shareOptions: ["Just my to-dos", "Everything"] as const,
  shareSet: (name: string, level: string) => `Done. I'll keep ${name} posted on ${level === "everything" ? "everything" : "your to-dos"} 💜`,

  // caregiver chat ("mom" is "your mom" for a daughter or son, otherwise her name)
  cgIntro: (cg: string, mom: string) =>
    `Hi ${cg}, I'm Juno 💜 ${cap(mom)} asked me to keep you posted on her follow-up care after her hospital stay. I'll text you when something gets booked or needs a hand.`,
  cgSummary: (mom: string, todos: Todo[], extra?: string) =>
    `Here's ${mom}'s list right now:\n${lines(todos)}${extra ? `\n\n${extra}` : ""}\n\nIf you book something for her, just text me (like *booked the blood test Thu 9am*). You can also ask me things like *when is her blood test?*`,
  cgBooked: (mom: string, t: Todo, by: string) =>
    by === "self" ? `✅ ${cap(mom)} booked her ${thing(t)} for ${fmtAt(t.appt_at!)}.` : `✅ ${cap(mom)}'s ${thing(t)} is booked for ${fmtAt(t.appt_at!)}.`,
  cgDone: (mom: string, t: Todo) => `✅ ${cap(mom)} finished her ${thing(t)}.`,
  cgThanks: (t: Todo, mom: string) => `Thank you 💜 I added the ${thing(t)} (${fmtAt(t.appt_at!)}) to ${mom}'s plan and sent her the calendar invite.`,
  cgDefault: (mom: string) => `I'll keep you posted on ${mom}'s follow-ups 💜 If you book something for her, text me the day and time. You can also ask me anything about her plan.`,
  escalate: (cg: string, mom: string, name: string, t: Todo) =>
    `Hey ${cg}, ${mom} hasn't booked her **${thing(t)}** yet${t.due_at ? ` (it should happen by **${fmtShort(t.due_at)}**)` : ""}. She's seen my reminders.\n\nIf you can help: ${[t.clinic, t.phone].filter(Boolean).join(", ")}\nYou could say: *"Hi, I'm calling to schedule a ${thing(t).replace(/ visit$/, " appointment")} for my mom, ${name}. She was just discharged from the hospital."*\n\nText me when it's booked 💜`,
  urgent: (mom: string, text: string) => `⚠️ ${cap(mom)} just texted me: "${text}". I told her to call 911 or go to the ER now.`,
  cgLabs: (mom: string, flagged: number, total: number, organs: string[], dr: string) =>
    `🩺 ${cap(mom)}'s lab results are in: ${flagged} of ${total} are outside the range printed on the report${organs.length ? ` (${organs.join(", ")})` : ""}. She'll ask ${dr} about them.`,

  // lab results
  labs: (flagged: number, total: number, byOrgan: string[], dr: string, addedToVisit: boolean) =>
    flagged
      ? `🩺 **Your lab results are in.** ${total - flagged} of ${total} are inside the range printed on the report, and ${flagged} are outside it:\n${byOrgan.join("\n")}\n\nThese are good questions for ${dr}.${addedToVisit ? " I added them to your primary care visit." : ""} Tap the card to explore.`
      : `🩺 **Your lab results are in.** All ${total} are inside the range printed on the report. ${dr} can tell you more.`,

  // reminders
  nudge1: (name: string | null, t: Todo) =>
    `Hi${name ? ` ${name}` : ""} 💜 Your **${thing(t)}**${t.due_at ? ` should happen by **${fmtShort(t.due_at)}**` : " is still on your list"}.${t.phone ? `\n\n📞 ${t.clinic ?? "Call"}: ${t.phone}` : ""}${t.prep ? `\n⚠️ ${t.prep}` : ""}\n\nOnce it's booked, tap ❤️ on this message or text me the day and time.`,
  nudge2: (t: Todo) =>
    `Quick reminder: your **${thing(t)}**${t.due_at ? ` should happen by **${fmtShort(t.due_at)}**` : " is still on your list"}.${t.phone ? `\n\n📞 ${t.clinic ?? "Call"}: ${t.phone}` : ""}${t.script ? `\nWhen you call, you can say: *"${t.script}"*` : ""}`,
  tapbackBooked: (t: Todo) => `🙌 Did you book your ${thing(t)}? Tell me the day and time, like *Tue 2pm*.`,
  tapbackHelper: (t: Todo) => `Thank you 💜 When the ${thing(t)} is booked, text me the day and time, like *Thu 9am*.`,
  howToCall: (t: Todo) => `📞 ${t.clinic ?? "Call"}${t.phone ? `: ${t.phone}` : ""}${t.script ? `\n\nYou can say: *"${t.script}"*` : ""}`,
  dayBefore: (t: Todo) =>
    `📅 Tomorrow: your ${thing(t)} at ${fmtTime(t.appt_at!)}${t.provider ? ` with ${drName(t.provider)}` : ""}.${t.prep ? `\n⚠️ ${t.prep}` : ""}`,
};
