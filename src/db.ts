import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });
export const db = new Database("juno.db", { create: true });
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, name TEXT, role TEXT, space_id TEXT,
  created_at INT, onboarded INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS care_links(
  patient_id TEXT, caregiver_id TEXT, caregiver_name TEXT, share_level TEXT,
  created_at INT, PRIMARY KEY(patient_id, caregiver_id));
CREATE TABLE IF NOT EXISTS documents(
  id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, raw_paths TEXT, clean_paths TEXT,
  extracted_json TEXT, created_at INT);
CREATE TABLE IF NOT EXISTS todos(
  id TEXT PRIMARY KEY, user_id TEXT, doc_id TEXT, title TEXT, category TEXT, why TEXT,
  due_at INT, due_text TEXT, clinic TEXT, provider TEXT, phone TEXT, script TEXT, prep TEXT,
  status TEXT, appt_at INT, booked_by TEXT, notes TEXT,
  nudge_count INT DEFAULT 0, last_nudge_at INT, nudges_read INT DEFAULT 0,
  escalated_at INT, reminded_day_before INT DEFAULT 0, created_at INT, sort INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS outbound(
  msg_id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, todo_id TEXT, sent_at INT, read_at INT);
CREATE TABLE IF NOT EXISTS cards(
  user_id TEXT, kind TEXT, doc_id TEXT, msg_id TEXT, session_json TEXT, version INT DEFAULT 0,
  PRIMARY KEY(user_id, kind, doc_id));
CREATE TABLE IF NOT EXISTS polls(
  msg_id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, payload TEXT, created_at INT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
`);

// ---- types -----------------------------------------------------------------

export type Role = "patient" | "caregiver";
export type User = { id: string; name: string | null; role: Role | null; space_id: string | null; created_at: number; onboarded: number };
export type Status = "todo" | "booked" | "done";
export type Todo = {
  id: string; user_id: string; doc_id: string; title: string; category: string; why: string | null;
  due_at: number | null; due_text: string | null; clinic: string | null; provider: string | null; phone: string | null;
  script: string | null; prep: string | null; status: Status; appt_at: number | null; booked_by: string | null;
  notes: string | null; nudge_count: number; last_nudge_at: number | null; nudges_read: number;
  escalated_at: number | null; reminded_day_before: number; created_at: number; sort: number;
};
export type CareLink = { patient_id: string; caregiver_id: string; caregiver_name: string | null; share_level: "todos" | "everything" | null; created_at: number };
export type Doc = { id: string; user_id: string; kind: string; raw_paths: string; clean_paths: string; extracted_json: string; created_at: number };

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

// ---- settings --------------------------------------------------------------

export function getSetting(key: string): string | null {
  return (db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null)?.value ?? null;
}
export function setSetting(key: string, value: string) {
  db.query("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ---- users -----------------------------------------------------------------

export function getUser(id: string): User | null {
  return db.query("SELECT * FROM users WHERE id = ?").get(id) as User | null;
}
export function upsertUser(id: string, fields: Partial<Omit<User, "id">>): User {
  const existing = getUser(id);
  if (!existing) {
    db.query("INSERT INTO users(id, name, role, space_id, created_at, onboarded) VALUES(?, ?, ?, ?, ?, ?)").run(
      id, fields.name ?? null, fields.role ?? null, fields.space_id ?? null, fields.created_at ?? Date.now(), fields.onboarded ?? 0,
    );
  } else {
    const merged = { ...existing, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
    db.query("UPDATE users SET name = ?, role = ?, space_id = ?, onboarded = ? WHERE id = ?").run(
      merged.name, merged.role, merged.space_id, merged.onboarded, id,
    );
  }
  return getUser(id)!;
}

// ---- care links ------------------------------------------------------------

export function caregiversOf(patientId: string): CareLink[] {
  return db.query("SELECT * FROM care_links WHERE patient_id = ?").all(patientId) as CareLink[];
}
export function patientsOf(caregiverId: string): CareLink[] {
  return db.query("SELECT * FROM care_links WHERE caregiver_id = ?").all(caregiverId) as CareLink[];
}
export function linkCaregiver(patientId: string, caregiverId: string, name: string | null) {
  db.query(
    "INSERT INTO care_links(patient_id, caregiver_id, caregiver_name, share_level, created_at) VALUES(?, ?, ?, NULL, ?) ON CONFLICT DO UPDATE SET caregiver_name = excluded.caregiver_name",
  ).run(patientId, caregiverId, name, Date.now());
}
export function setShareLevel(patientId: string, caregiverId: string, level: "todos" | "everything") {
  db.query("UPDATE care_links SET share_level = ? WHERE patient_id = ? AND caregiver_id = ?").run(level, patientId, caregiverId);
}

// ---- documents -------------------------------------------------------------

export function insertDoc(d: Doc) {
  db.query("INSERT INTO documents VALUES(?, ?, ?, ?, ?, ?, ?)").run(d.id, d.user_id, d.kind, d.raw_paths, d.clean_paths, d.extracted_json, d.created_at);
}
export function getDoc(id: string): Doc | null {
  return db.query("SELECT * FROM documents WHERE id = ?").get(id) as Doc | null;
}
export function latestDoc(userId: string, kind: string): Doc | null {
  return db.query("SELECT * FROM documents WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1").get(userId, kind) as Doc | null;
}

// ---- todos -----------------------------------------------------------------

export function insertTodo(t: Todo) {
  db.query(
    `INSERT INTO todos(id, user_id, doc_id, title, category, why, due_at, due_text, clinic, provider, phone, script, prep,
      status, appt_at, booked_by, notes, created_at, sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(t.id, t.user_id, t.doc_id, t.title, t.category, t.why, t.due_at, t.due_text, t.clinic, t.provider, t.phone, t.script, t.prep,
    t.status, t.appt_at, t.booked_by, t.notes, t.created_at, t.sort);
}
export function todosFor(userId: string): Todo[] {
  return db.query("SELECT * FROM todos WHERE user_id = ? ORDER BY sort, created_at").all(userId) as Todo[];
}
export function getTodo(id: string): Todo | null {
  return db.query("SELECT * FROM todos WHERE id = ?").get(id) as Todo | null;
}
export function updateTodo(id: string, fields: Partial<Todo>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.query(`UPDATE todos SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
    ...keys.map((k) => (fields as Record<string, string | number | null>)[k] ?? null), id,
  );
}

// ---- outbound / read receipts ---------------------------------------------

export function recordOutbound(msgId: string, userId: string, kind: string, todoId: string | null, sentAt: number) {
  db.query("INSERT OR IGNORE INTO outbound(msg_id, user_id, kind, todo_id, sent_at) VALUES(?, ?, ?, ?, ?)").run(msgId, userId, kind, todoId, sentAt);
}
/** iMessage read receipts only name the newest message, so treat one as "read up to here". */
export function markReadUpTo(userId: string, msgId: string, readAt: number): { todo_id: string | null }[] {
  const target = db.query("SELECT sent_at FROM outbound WHERE msg_id = ?").get(msgId) as { sent_at: number } | null;
  const upTo = target?.sent_at ?? Number.MAX_SAFE_INTEGER;
  const rows = db
    .query("SELECT msg_id, todo_id, kind FROM outbound WHERE user_id = ? AND read_at IS NULL AND sent_at <= ?")
    .all(userId, upTo) as { msg_id: string; todo_id: string | null; kind: string }[];
  for (const r of rows) {
    db.query("UPDATE outbound SET read_at = ? WHERE msg_id = ?").run(readAt, r.msg_id);
    if (r.kind === "nudge" && r.todo_id) db.query("UPDATE todos SET nudges_read = nudges_read + 1 WHERE id = ?").run(r.todo_id);
  }
  return rows;
}

// ---- cards / polls ---------------------------------------------------------

export type CardRow = { user_id: string; kind: string; doc_id: string; msg_id: string; session_json: string; version: number };
export function getCard(userId: string, kind: string, docId: string): CardRow | null {
  return db.query("SELECT * FROM cards WHERE user_id = ? AND kind = ? AND doc_id = ?").get(userId, kind, docId) as CardRow | null;
}
export function saveCard(c: CardRow) {
  db.query(
    "INSERT INTO cards VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET msg_id = excluded.msg_id, session_json = excluded.session_json, version = excluded.version",
  ).run(c.user_id, c.kind, c.doc_id, c.msg_id, c.session_json, c.version);
}

export function savePoll(msgId: string, userId: string, kind: string, payload: unknown) {
  db.query("INSERT OR REPLACE INTO polls VALUES(?, ?, ?, ?, ?)").run(msgId, userId, kind, JSON.stringify(payload), Date.now());
}
export function latestPoll(userId: string, kind?: string): { msg_id: string; kind: string; payload: string } | null {
  return (kind
    ? db.query("SELECT * FROM polls WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1").get(userId, kind)
    : db.query("SELECT * FROM polls WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId)) as { msg_id: string; kind: string; payload: string } | null;
}

export function resetAll() {
  for (const t of ["care_links", "documents", "todos", "outbound", "cards", "polls", "settings"]) db.exec(`DELETE FROM ${t}`);
  db.exec("UPDATE users SET onboarded = 0, role = NULL");
}
