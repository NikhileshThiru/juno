// Every user-facing sentence lives here: warm, short, ~6th-grade reading level.
// 💛 is Juno's signature; use it sparingly.
import { fmtShort, fmtWhen } from "./clock.ts";
import type { Todo } from "./db.ts";

export const ASK_DOCTOR = "Your doctor or pharmacist can tell you more.";

export const copy = {
  welcome: (name?: string | null) =>
    `Hi${name ? ` ${name}` : ""}! I'm Juno 💛 I help you understand your hospital paperwork and keep track of what to do next.\n\nI'm not a doctor — I explain what your papers say and make the next steps easy.`,
  askForPhoto: "Whenever you're ready, just take a photo of your discharge papers and send it here. Several pages are fine.",
  saveMe: "Save me as Juno so you can always find me 💛",
  reading: (n: number) => (n > 1 ? `Got all ${n} pages — reading them now 👀` : "Got it — reading it now 👀"),
  unreadable: "I couldn't read that one clearly. Could you try again with the whole page in the photo and good light?",
  otherDoc: "I can help with discharge papers, visit summaries, lab results, and appointment reminders. That one doesn't look like any of those — want to try another photo?",

  warnings: (signs: string[]) => `**Call 911 or go to the ER if you have:**\n${signs.map((s) => `• ${s}`).join("\n")}`,
  summary: (summary: string, newMeds: number, todos: number) =>
    `${summary}${newMeds ? ` You have ${newMeds} new medicine${newMeds > 1 ? "s" : ""}` : ""}${todos ? `${newMeds ? " and" : " You have"} ${todos} thing${todos > 1 ? "s" : ""} to do.` : "."}`,
  meds: (lines: string[]) => `💊 **Your medicines**\n${lines.join("\n")}`,
  howToBook: "When you book one, just text me — like *booked heart doctor Tue 2pm*. I'll keep track and remind you.",
  numbers: (todos: Todo[]) =>
    `📞 Numbers to call:\n${todos
      .filter((t) => t.phone && t.status === "todo")
      .map((t) => `• ${t.title}: ${t.clinic ?? ""} ${t.phone}`)
      .join("\n")}`,

  booked: (t: Todo) => `✅ Got it — ${t.title}, ${fmtWhen(t.appt_at!)}. Tap the invite to add it to your calendar.`,
  bookedByHelper: (t: Todo, helper: string) => `${helper} booked your ${t.title.toLowerCase()} for ${fmtWhen(t.appt_at!)} 💛 Tap the invite to add it to your calendar.`,
  needTime: (t: Todo) => `Great! When is your ${t.title.toLowerCase()}? Something like *Tue 2pm* is perfect.`,
  done: (t: Todo) => `✅ Nice work — ${t.title.toLowerCase()} is done.`,
  allDone: "You did everything on your list 🎉",
  whichOne: "Which one did you book?",
  ask: (answer: string) => `${answer}\n\n${ASK_DOCTOR}`,
  status: (todos: Todo[]) => {
    const open = todos.filter((t) => t.status !== "done");
    if (!todos.length) return "Nothing on your list yet — send me a photo of your papers anytime.";
    if (!open.length) return "Everything on your list is done 🎉";
    return `Here's where things stand:\n${todos.map((t) => `${t.status === "done" ? "✅" : t.status === "booked" ? "📅" : "☐"} ${t.title}${t.status === "booked" ? ` — ${fmtWhen(t.appt_at!)}` : t.status === "todo" && t.due_at ? ` — by ${fmtShort(t.due_at)}` : ""}`).join("\n")}`;
  },
  fallback: "I'm here 💛 You can send me a photo of your papers, tell me when you book something, or ask what something means.",

  // caregiver
  askShare: (name: string) => `What should ${name} see?`,
  shareOptions: ["Just my to-dos", "Everything"] as const,
  shareFallback: (name: string) => `Reply 1 if ${name} should see just your to-dos, or 2 for everything.`,
  shareSet: (name: string, level: string) => `Done — I'll keep ${name} posted on ${level === "everything" ? "everything" : "your to-dos"} 💛`,
  cgIntro: (cg: string, patient: string, relation: string | null) =>
    `Hi ${cg}, I'm Juno 💛 ${relation && /daughter|son|child/i.test(relation) ? "Your mom" : patient} asked me to keep you posted on her follow-up care after her hospital stay. I'll text you when something's booked or if something needs a hand.`,
  cgSummary: (patient: string, todos: Todo[], extra?: string) =>
    `Here's ${patient}'s list right now:\n${todos.map((t) => `${t.status === "done" ? "✅" : t.status === "booked" ? "📅" : "☐"} ${t.title}${t.due_at && t.status === "todo" ? ` (by ${fmtShort(t.due_at)})` : ""}${t.status === "booked" ? ` — ${fmtWhen(t.appt_at!)}` : ""}`).join("\n")}${extra ? `\n\n${extra}` : ""}\n\nIf you book something for her, just text me — like *booked the blood test Thu 9am*.`,
  cgBooked: (patient: string, t: Todo, by: string) => `✅ ${patient}'s ${t.title.toLowerCase()} is booked for ${fmtWhen(t.appt_at!)}${by === "self" ? "" : " — thank you!"}`,
  cgDone: (patient: string, t: Todo) => `✅ ${patient} finished: ${t.title.toLowerCase()}.`,
  cgThanks: (t: Todo) => `Thank you 💛 I've marked ${t.title.toLowerCase()} as booked for ${fmtWhen(t.appt_at!)} and sent her the calendar invite.`,
  escalate: (cg: string, patient: string, t: Todo) =>
    `Hey ${cg} — ${patient} hasn't booked her **${t.title.toLowerCase()}** yet${t.due_at ? ` (due **${fmtShort(t.due_at)}**)` : ""}. She's seen my reminders.\n\nIf you want to help: ${t.clinic ?? ""}${t.phone ? `, ${t.phone}` : ""}.\nYou could say: *"${t.script ?? ""}"*\n\nText me when it's booked 💛`,

  // nudges
  nudge1: (name: string | null, t: Todo) =>
    `Hi${name ? ` ${name}` : ""} 💛 Your **${t.title.toLowerCase()}**${t.due_at ? ` is due by **${fmtShort(t.due_at)}**` : " is still on your list"}.${t.phone ? `\n\n${t.clinic ?? "Number"}: ${t.phone}` : ""}${t.prep ? `\nRemember: ${t.prep}` : ""}`,
  nudge2: (t: Todo) =>
    `Quick reminder about your **${t.title.toLowerCase()}**${t.due_at ? ` — due ${fmtShort(t.due_at)}` : ""}.${t.phone ? ` ${t.phone}` : ""}\n\nWhen you call, you can say: *"${t.script ?? ""}"*`,
  tapbackBooked: (t: Todo) => `🙌 Did you book your ${t.title.toLowerCase()}? Just tell me the day and time — like *Tue 2pm*.`,
  tapbackHelper: (t: Todo) => `Thank you 💛 When the ${t.title.toLowerCase()} is booked, just text me the day and time — like *Thu 9am*.`,
  howToCall: (t: Todo) =>
    `${t.clinic ?? "Call"}${t.phone ? `: ${t.phone}` : ""}${t.script ? `\n\nYou can say: *"${t.script}"*` : ""}`,
  dayBefore: (t: Todo) => `Tomorrow: ${t.title} at ${fmtWhen(t.appt_at!).split(" · ")[1]}${t.provider ? ` with ${t.provider}` : ""}.${t.prep ? ` ${t.prep}` : ""}`,
};
