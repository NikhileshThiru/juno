// Inbound dispatch. Texts, photos, and contact cards are batched per chat for
// 2.5s (people send several pages or texts in a row) and handled as one turn.
// Receipts, votes, and reactions are handled immediately and never replied to
// generically.
import { poll, richlink, type Message, type Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { DAY, now, parseLocalIso } from "./clock.ts";
import { ASK_DOCTOR, copy } from "./copy.ts";
import { db, getSetting, getTodo, getUser, latestDoc, markReadUpTo, savePoll, setSetting, todosFor, upsertUser } from "./db.ts";
import { isAdmin } from "./env.ts";
import { answer } from "./answer.ts";
import { sendOrUpdateCard, tokenFor } from "./cards.ts";
import { publicBaseUrl } from "./env.ts";
import { addCaregiver, handleCaregiverText, isCaregiver, notifyCaregivers, onShareChosen, pendingShare } from "./flows/caregiver.ts";
import { runAdmin } from "./flows/admin.ts";
import { handlePhotos, type Photo } from "./flows/documents.ts";
import { tick } from "./flows/nudges.ts";
import { applyBooked, applyDone } from "./flows/status.ts";
import { understand } from "./intent.ts";
import { matchOpenTodo } from "./parse.ts";
import { log, logError } from "./log.ts";
import { onPollVote as phase1Vote, onReadReceipt as phase1Read } from "./phase1.ts";
import { rememberSpace, say, send } from "./spectrum.ts";

// Photos are registered the moment they arrive and downloaded in the background,
// so a slow download can't split an album into two turns.
type Turn = { userId: string; space: Space; texts: string[]; photos: Promise<Photo | null>[]; contacts: { phone: string; name: string | null }[]; timer?: Timer };
const turns = new Map<string, Turn>();
const chains = new Map<string, Promise<void>>(); // one turn at a time per person
const seen = new Set<string>();
const TEXT_WINDOW_MS = 2500;
const PHOTO_WINDOW_MS = 5000; // pages sent one by one trickle in a few seconds apart

export async function onMessage(space: Space, message: Message) {
  const c = message.content;
  const key = `${c.type}:${message.id}`;
  if (seen.has(key) || message.direction === "outbound") return;
  seen.add(key);
  const userId = imessage(message).sender?.address ?? message.sender?.id;
  log("📥", `${c.type}${c.type === "group" ? ` (${c.items.length} items)` : ""} from ${userId ?? "?"}`);
  if (!userId) return;
  rememberSpace(userId, space);
  if (!getUser(userId)) upsertUser(userId, {});

  // Several photos sent at once arrive as one "group" (album) message.
  if (c.type === "group") {
    await Promise.all(c.items.map((item) => dispatch(space, item, userId)));
    return;
  }
  return dispatch(space, message, userId);
}

async function dispatch(space: Space, message: Message, userId: string) {
  const c = message.content;
  switch (c.type) {
    case "text": {
      const [cmd, ...args] = c.text.trim().split(/\s+/);
      if (cmd?.startsWith("/") && isAdmin(userId)) {
        await message.read();
        log("🛠️", `${cmd} ${args.join(" ")} from ${userId}`);
        if (await runAdmin(cmd.toLowerCase(), args, space, userId)) return;
      }
      log("💬", `${userId}: ${c.text}`);
      return buffer(userId, space, message, (t) => t.texts.push(c.text));
    }
    case "attachment": {
      if (!c.mimeType.startsWith("image/")) return;
      message.react("👀").catch(() => {});
      const photo = (async (): Promise<Photo | null> => {
        const path = `data/uploads/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${c.name.replace(/[^\w.-]/g, "_")}`;
        await Bun.write(path, await c.read());
        return { path, mimeType: c.mimeType };
      })().catch((err) => {
        logError("photo download failed", err);
        return null;
      });
      return buffer(userId, space, message, (t) => t.photos.push(photo));
    }
    case "contact": {
      const phone = c.phones?.[0]?.value;
      if (!phone) return;
      return buffer(userId, space, message, (t) => t.contacts.push({ phone, name: c.name?.formatted ?? c.name?.first ?? null }));
    }
    case "poll_option":
      if (c.selected) await onVote(userId, c.option.title);
      return phase1Vote(space, c.title, c.selected, c.poll.title).catch(() => {});
    case "read": {
      const rows = markReadUpTo(userId, c.target.id, now());
      if (rows.some((r) => r.todo_id)) {
        log("👁️", `${userId} read ${rows.length} message(s) incl. nudges`);
        await tick();
      }
      return phase1Read(c.target.id);
    }
    case "reaction":
      return onTapback(userId, c.target.id, c.emoji);
    default:
      return; // typing and other system events — never reply here
  }
}

function buffer(userId: string, space: Space, message: Message, add: (t: Turn) => void) {
  message.read().catch(() => {});
  const t = turns.get(space.id) ?? { userId, space, texts: [], photos: [], contacts: [] };
  add(t);
  clearTimeout(t.timer);
  t.timer = setTimeout(() => {
    turns.delete(space.id);
    const next = (chains.get(userId) ?? Promise.resolve()).then(() => flush(t)).catch((err) => logError("turn failed", err));
    chains.set(userId, next);
  }, t.photos.length ? PHOTO_WINDOW_MS : TEXT_WINDOW_MS);
  turns.set(space.id, t);
}

async function flush(t: Turn) {
  await t.space.startTyping().catch(() => {});
  try {
    if (isCaregiver(t.userId)) {
      if (t.texts.length) await handleCaregiverText(t.userId, t.texts.join("\n"));
      return;
    }
    const photos = (await Promise.all(t.photos)).filter((p): p is Photo => p !== null);
    await onboardIfNeeded(t);
    if (photos.length) await handlePhotos(t.userId, photos);
    for (const c of t.contacts) await addCaregiver(t.userId, c.phone, c.name, getSetting(`pending_relation:${t.userId}`));
    if (t.texts.length && !(t.photos.length && t.texts.every((x) => x.length < 40))) await handlePatientText(t.userId, t.texts.join("\n"));
  } finally {
    await t.space.stopTyping().catch(() => {});
  }
}

async function onboardIfNeeded(t: Turn) {
  const u = getUser(t.userId);
  if (u?.onboarded) return;
  upsertUser(t.userId, { onboarded: 1, role: "patient" });
  await say(t.userId, copy.welcome(u?.name), ...(t.photos.length ? [] : [copy.askForPhoto]));
  await imessage(t.space).shareContactCard().catch(() => {});
}

async function handlePatientText(userId: string, text: string) {
  const share = pendingShare(userId);
  if (share && /^\s*(1|2|just|to-?dos|everything|all)\b/i.test(text)) {
    return onShareChosen(userId, share.caregiver_id, /^\s*(2|everything|all)/i.test(text) ? "everything" : "todos");
  }
  const open = todosFor(userId).filter((t) => t.status !== "done");
  const brief = open.map((t) => ({ id: t.id, title: t.title, clinic: t.clinic, status: t.status, category: t.category }));
  const intent = await understand(text, brief, "patient");
  // A to-do the message names wins; otherwise context ("booked it" after a nudge)
  // beats the model's guess.
  const named = matchOpenTodo(text, brief);
  const pendingTodo = getSetting(`pending_booking:${userId}`);
  const nudged = open.filter((t) => t.last_nudge_at && now() - t.last_nudge_at < 2 * DAY).sort((a, b) => b.last_nudge_at! - a.last_nudge_at!)[0];
  const todo =
    open.find((t) => t.id === named) ?? open.find((t) => t.id === pendingTodo) ?? nudged ?? open.find((t) => t.id === intent.todo_id);
  const at = parseLocalIso(intent.appt_datetime_iso);

  switch (intent.intent) {
    case "booked":
      if (todo && at) {
        setSetting(`pending_booking:${userId}`, "");
        return applyBooked(userId, todo.id, at, "self");
      }
      if (todo) {
        setSetting(`pending_booking:${userId}`, todo.id);
        return say(userId, copy.needTime(todo));
      }
      if (open.length) {
        const sent = await send(userId, poll(copy.whichOne, ...open.map((t) => t.title)));
        if (sent) savePoll(sent.id, userId, "which", { patientId: userId, at, todoIds: open.map((t) => t.id) });
      }
      return;
    case "done":
      if (todo) return applyDone(userId, todo.id, "self");
      return say(userId, "Which one did you finish?");
    case "add_caregiver":
      if (intent.caregiver_phone) return addCaregiver(userId, intent.caregiver_phone, intent.caregiver_name, intent.caregiver_relation);
      setSetting(`pending_relation:${userId}`, intent.caregiver_relation ?? "");
      return say(userId, `Of course 💛 Share ${intent.caregiver_name ?? "their"} contact card here, or type the number.`);
    case "question": {
      if (!latestDoc(userId, "discharge") && !latestDoc(userId, "lab") && !todosFor(userId).length)
        return say(userId, `I don't have any of your papers yet. Send me a photo and I can help. ${ASK_DOCTOR}`);
      const res = await answer(userId, text, false);
      await say(userId, res.text);
      if (res.emergency) await notifyCaregivers(userId, { type: "urgent", text });
      return;
    }
    case "show":
      return pullUp(userId, text);
    case "status":
      return say(userId, copy.status(todosFor(userId)));
    case "thanks":
      return say(userId, "Anytime 💛");
    default:
      return say(userId, copy.fallback);
  }
}

async function onVote(userId: string, choice: string) {
  const p = db.query("SELECT * FROM polls WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId) as { kind: string; payload: string } | null;
  if (!p) return;
  const payload = JSON.parse(p.payload);
  if (p.kind === "share") {
    const level = /everything/i.test(choice) ? "everything" : "todos";
    return onShareChosen(userId, payload.caregiverId, level);
  }
  if (p.kind === "which") {
    const todo = todosFor(payload.patientId).find((t) => t.title === choice && payload.todoIds.includes(t.id));
    if (!todo) return;
    const by = userId === payload.patientId ? "self" : userId;
    if (payload.at) return applyBooked(payload.patientId, todo.id, payload.at, by);
    setSetting(`pending_booking:${payload.patientId}`, todo.id);
    return say(userId, copy.needTime(todo));
  }
}

/**
 * A tapback on a reminder is a one-tap answer: ❤️/👍 → "did you book it?",
 * ❓ → the number and what to say again. Tapbacks on anything else are ignored.
 */
async function onTapback(userId: string, targetId: string, emoji: string) {
  const row = db.query("SELECT kind, todo_id FROM outbound WHERE msg_id = ?").get(targetId) as { kind: string; todo_id: string | null } | null;
  if (!row?.todo_id || (row.kind !== "nudge" && row.kind !== "escalation")) return;
  const todo = getTodo(row.todo_id);
  if (!todo || todo.status !== "todo") return;
  log("💬", `tapback ${emoji} on ${row.kind} for ${todo.title}`);
  if (/❓|\?/.test(emoji)) return say(userId, copy.howToCall(todo));
  if (row.kind === "nudge") {
    setSetting(`pending_booking:${userId}`, todo.id);
    return say(userId, copy.tapbackBooked(todo));
  }
  return say(userId, copy.tapbackHelper(todo));
}

/** "Show me my list / labs / plan": send a fresh card (or the plan link) at the bottom of the chat. */
async function pullUp(userId: string, text: string) {
  const lab = latestDoc(userId, "lab");
  if (/\b(labs?|results?|body map)\b/i.test(text) && lab) {
    db.query("DELETE FROM cards WHERE user_id = ? AND kind = 'labs'").run(userId);
    return sendOrUpdateCard(userId, "labs", lab.id, { caption: "Your lab results", subcaption: "Tap an organ to explore" });
  }
  if (/\bplan\b/i.test(text)) return send(userId, richlink(`${publicBaseUrl()}/plan/${tokenFor(userId)}`));
  if (!todosFor(userId).length) return say(userId, copy.askForPhoto);
  db.query("DELETE FROM cards WHERE user_id = ? AND kind = 'tracker'").run(userId);
  return sendOrUpdateCard(userId, "tracker");
}
