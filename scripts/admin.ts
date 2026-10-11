// Off-camera admin for the demo video: `bun run admin skip 2d | reset | status`.
// Writes straight to juno.db; the running server's 10s scheduler tick picks it up.
import { fmtWhen, now, parseDuration, skip } from "../src/clock.ts";
import { db, resetAll, type Todo } from "../src/db.ts";

const [cmd, arg] = process.argv.slice(2);
if (cmd === "skip") {
  const ms = parseDuration(arg ?? "");
  if (!ms) throw new Error("usage: bun run admin skip 2d | 12h | 30m");
  skip(ms);
  console.log(`⏩ virtual clock → ${fmtWhen(now())} (nudges fire on the next tick, ≤10s)`);
} else if (cmd === "reset") {
  resetAll();
  console.log("🧹 Reset: no documents, to-dos, care circle, or reminders; clock back to now.");
  console.log("   Next: delete the Juno chat on both phones and reload localhost:3000/brain.");
} else if (cmd === "links") {
  const { brainKey } = await import("../src/web/brain.ts");
  const base = (await Bun.file("data/tunnel-url").text()).trim();
  console.log(`Dashboard (private, send only to your teammate): ${base}/brain?key=${brainKey()}`);
  console.log(`Controls  (private, keep off-camera):           ${base}/brain/controls?key=${brainKey()}`);
} else {
  console.log(`🕐 ${fmtWhen(now())}`);
  for (const t of db.query("SELECT * FROM todos ORDER BY user_id, sort").all() as Todo[])
    console.log(`${t.status.padEnd(6)} ${t.title.padEnd(28)} nudges ${t.nudge_count} read ${t.nudges_read}${t.escalated_at ? " escalated" : ""}`);
}
