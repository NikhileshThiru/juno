// sendOrUpdateCard(): one live card per (user, kind, doc). Edits reuse the
// persisted miniAppCardSession, which Phase 1 showed still works after a restart.
import { app, edit, type Message } from "spectrum-ts";
import { fmtShort, fmtWhen } from "./clock.ts";
import { db, getCard, saveCard, todosFor, type Todo } from "./db.ts";
import { publicBaseUrl } from "./env.ts";
import { log, logError } from "./log.ts";
import { send, spaceFor } from "./spectrum.ts";

/** Opaque per-user token so card URLs don't expose phone numbers. */
export function tokenFor(userId: string): string {
  return new Bun.CryptoHasher("sha256").update(`juno:${process.env.SPECTRUM_PROJECT_SECRET}:${userId}`).digest("base64url").slice(0, 16);
}
export function userForToken(token: string): string | null {
  const ids = db.query("SELECT id FROM users").all() as { id: string }[];
  return ids.find((u) => tokenFor(u.id) === token)?.id ?? null;
}

function trackerLayout(todos: Todo[]) {
  const done = todos.filter((t) => t.status === "done").length;
  const next = todos.find((t) => t.status === "todo");
  const booked = todos.filter((t) => t.status === "booked").sort((a, b) => a.appt_at! - b.appt_at!)[0];
  const subcaption = next
    ? `Next: ${next.title.toLowerCase()}${next.due_at ? ` by ${fmtShort(next.due_at)}` : ""}`
    : booked
      ? `Next: ${booked.title.toLowerCase()} ${fmtWhen(booked.appt_at!)}`
      : "All done 🎉";
  return { caption: `Your next steps · ${done} of ${todos.length} done`, subcaption };
}

export async function sendOrUpdateCard(userId: string, kind: "tracker" | "labs", docId = "-", layoutOverride?: { caption: string; subcaption?: string }) {
  const row = getCard(userId, kind, docId);
  const version = (row?.version ?? 0) + 1;
  const path = kind === "tracker" ? `/c/tracker/${tokenFor(userId)}` : `/c/labs/${tokenFor(userId)}/${docId}`;
  const url = `${publicBaseUrl()}${path}?v=${version}`;
  const layout = layoutOverride ?? trackerLayout(todosFor(userId));
  const content = app(url, { live: true, layout });

  if (row) {
    try {
      const space = await spaceFor(userId);
      const target = {
        id: row.msg_id,
        direction: "outbound",
        platform: "imessage",
        space,
        content: { type: "text", text: "" },
        sender: undefined,
        timestamp: new Date(),
        miniAppCardSession: JSON.parse(row.session_json),
      } as unknown as Message & { miniAppCardSession: unknown };
      await space.send(edit(content, target));
      saveCard({ ...row, session_json: JSON.stringify(target.miniAppCardSession), version });
      log("💳", `${kind} card updated in place (v${version})`);
      return;
    } catch (err) {
      logError(`card edit failed, sending a fresh ${kind} card`, err);
    }
  }
  const sent = await send(userId, content, { kind: "card" });
  const session = (sent as unknown as { miniAppCardSession?: unknown } | undefined)?.miniAppCardSession;
  if (sent && session) saveCard({ user_id: userId, kind, doc_id: docId, msg_id: sent.id, session_json: JSON.stringify(session), version });
  log("💳", `${kind} card sent (v${version})`);
}
