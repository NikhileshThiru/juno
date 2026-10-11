// Admin commands (ADMIN_NUMBERS only): /skip, /reset, /status, /help, plus the
// Phase 1 test bench.
import type { Space } from "spectrum-ts";
import { fmtWhen, now, parseDuration, skip } from "../clock.ts";
import { caregiversOf, db, latestDoc, resetAll, type Todo } from "../db.ts";
import { sendOrUpdateCard } from "../cards.ts";
import { log } from "../log.ts";
import { commands as phase1 } from "../phase1.ts";
import { skipHint, tick } from "./nudges.ts";

type Run = (space: Space, args: string[], from: string) => Promise<void>;

const admin: Record<string, { help: string; run: Run }> = {
  "/skip": {
    help: "/skip 2d | 12h | 30m — move the virtual clock forward, then run the scheduler",
    async run(space, [arg]) {
      const ms = parseDuration(arg ?? "");
      if (!ms) return void (await space.send("Usage: /skip 2d (or 12h, 30m)"));
      skip(ms);
      await space.send(`⏩ Jumped ahead ${arg} (now ${fmtWhen(now())})${skipHint() ? `\n⚠️ ${skipHint()}` : ""}`);
      log("⏩", `clock → ${fmtWhen(now())}`);
      await tick();
    },
  },
  "/reset": {
    help: "wipe documents, to-dos, care circle, cards, and the clock",
    async run(space) {
      resetAll();
      log("🧹", "reset");
      await space.send("🧹 Reset. Fresh start — send a photo of the discharge papers.");
    },
  },
  "/card": {
    help: "send a fresh checklist card at the bottom of this chat",
    async run(space, _args, from) {
      db.query("DELETE FROM cards WHERE user_id = ? AND kind = 'tracker'").run(from);
      await sendOrUpdateCard(from, "tracker");
    },
  },
  "/labs": {
    help: "send a fresh lab-results card for the latest lab report",
    async run(space, _args, from) {
      const doc = latestDoc(from, "lab");
      if (!doc) return void (await space.send("No lab report yet — send a photo of one."));
      db.query("DELETE FROM cards WHERE user_id = ? AND kind = 'labs'").run(from);
      await sendOrUpdateCard(from, "labs", doc.id, { caption: "Your lab results", subcaption: "Tap an organ to explore" });
    },
  },
  "/status": {
    help: "dump to-dos, care circle, and the clock",
    async run(space) {
      const todos = db.query("SELECT * FROM todos ORDER BY user_id, sort").all() as Todo[];
      const lines = todos.map(
        (t) => `${t.status === "done" ? "✅" : t.status === "booked" ? "📅" : "☐"} ${t.title} · nudges ${t.nudge_count} (read ${t.nudges_read})${t.escalated_at ? " · escalated" : ""}${t.appt_at ? ` · ${fmtWhen(t.appt_at)}` : ""}`,
      );
      const users = [...new Set(todos.map((t) => t.user_id))];
      const circle = users.flatMap((u) => caregiversOf(u).map((l) => `👪 ${l.caregiver_name} (${l.share_level ?? "pending"})`));
      await space.send([`🕐 ${fmtWhen(now())}`, ...lines, ...circle].join("\n") || "Nothing yet.");
    },
  },
};

admin["/help"] = {
  help: "list commands",
  async run(space) {
    const all = { ...admin, ...phase1 };
    await space.send(Object.entries(all).map(([k, v]) => `${k} — ${v.help}`).join("\n"));
  },
};

export async function runAdmin(cmd: string, args: string[], space: Space, from: string): Promise<boolean> {
  const a = admin[cmd];
  if (a) {
    await a.run(space, args, from);
    return true;
  }
  const p = phase1[cmd];
  if (p) {
    await p.run({ space, message: undefined as never });
    return true;
  }
  return false;
}
