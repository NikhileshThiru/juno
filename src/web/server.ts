import { Hono, type Context } from "hono";
import { richlink } from "spectrum-ts";
import { html } from "hono/html";
import { log, logError } from "../log.ts";
import { brain, localOnly } from "./brain.ts";
import { demo } from "./demo.ts";
import { tokenFor, userForToken } from "../cards.ts";
import { DAY, fmtDay, fmtShort, fmtTime, now, parseLocalIso, toLocalIso } from "../clock.ts";
import { caregiversOf, getDoc, getTodo, getUser, latestDoc, todosFor } from "../db.ts";
import { publicBaseUrl } from "../env.ts";
import { applyBooked, applyDone } from "../flows/status.ts";
import type { Discharge, Labs } from "../gemini.ts";
import { buildIcs } from "../ics.ts";
import { say, send } from "../spectrum.ts";
import { group } from "../labs.ts";
import { labsPage } from "./bodymap.ts";
import { labsOg, planOg } from "./og.ts";
import { planPage, type PlanData } from "./plan.ts";
import { trackerPage, type CardTodo } from "./tracker.ts";

export const web = new Hono();

web.get("/health", (c) => c.text("ok"));
web.route("/", demo);
web.route("/", brain);
web.use("/debug/*", localOnly);
web.use("/file", localOnly);

/** A patient's to-dos shaped for the card pages (names, not phone numbers, for helpers). */
function cardTodos(userId: string): CardTodo[] {
  const helpers = new Map(caregiversOf(userId).map((l) => [l.caregiver_id, l.caregiver_name ?? "family"]));
  return todosFor(userId).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    due: t.status === "done" ? "Done" : t.due_at ? `by ${fmtShort(t.due_at)}` : t.due_text,
    when: t.appt_at ? `${fmtDay(t.appt_at)} · ${fmtTime(t.appt_at)}` : null,
    whenShort: t.appt_at
      ? t.appt_at - now() < 6 * DAY
        ? `${fmtDay(t.appt_at).split(",")[0]} ${fmtTime(t.appt_at)}`
        : `${fmtShort(t.appt_at)}, ${fmtTime(t.appt_at)}`
      : null,
    helper: t.booked_by && t.booked_by !== "self" ? (helpers.get(t.booked_by) ?? null) : null,
    clinic: [t.clinic, t.provider].filter(Boolean).join(" · ") || null,
    phone: t.phone,
    why: t.why,
    script: t.script,
    prep: t.prep,
    notes: t.notes,
  }));
}

function visitInfo(userId: string) {
  const doc = latestDoc(userId, "discharge");
  const d = doc ? (JSON.parse(doc.extracted_json) as Discharge) : null;
  const visit = d?.visit_date ? `From the ${fmtShort(Date.parse(d.visit_date + "T12:00:00"))} hospital visit` : null;
  return { d, visit, facility: d?.facility ?? null };
}

web.get("/c/tracker/:token", (c) => {
  const token = c.req.param("token");
  const userId = userForToken(token);
  if (!userId) return c.text("Not found", 404);
  const { visit } = visitInfo(userId);
  log("📱", `tracker card opened (${getUser(userId)?.name ?? userId}, v=${c.req.query("v")})`);
  return c.html(
    trackerPage(cardTodos(userId), {
      subtitle: visit?.replace("From the", "From your") ?? "Your follow-up care",
      token,
      nowLocal: toLocalIso(now()),
      defaultLocal: toLocalIso(nextNineAm()),
    }),
  );
});

/** The next 9:00 AM (virtual clock): a sensible default for "when is it?". */
function nextNineAm(): number {
  const nine = parseLocalIso(`${toLocalIso(now()).slice(0, 10)}T09:00`)!;
  return nine > now() ? nine : nine + DAY;
}

// ---- care plan (full screen, for Mom and for family) -----------------------

function planData(userId: string, token: string, family: boolean): PlanData {
  const name = getUser(userId)?.name ?? "Mom";
  const { d, visit, facility } = visitInfo(userId);
  const order = { booked: 0, todo: 1, done: 2 } as const;
  const raw = todosFor(userId);
  const steps = cardTodos(userId)
    .map((t, i) => ({ t, row: raw[i]! }))
    .sort((a, b) => order[a.t.status] - order[b.t.status] || (a.row.appt_at ?? a.row.due_at ?? 0) - (b.row.appt_at ?? b.row.due_at ?? 0))
    .map(({ t }) => ({
      ...t,
      date: t.status === "booked" ? (t.when ?? "") : t.status === "done" ? "Done" : (t.due ?? ""),
      ics: t.status === "booked" ? `/ics/${token}/${t.id}` : null,
    }));
  const done = steps.filter((s) => s.status === "done").length;
  const next = steps.find((s) => s.status !== "done");
  return {
    title: family ? `${name}'s care plan` : "Your care plan",
    subtitle: [visit?.replace("From the", family ? "From her" : "From your"), facility].filter(Boolean).join(" · ") || "Follow-up care",
    reason: d?.reason_plain ?? null,
    warnings: d?.warning_signs ?? [],
    meds: (d?.medications ?? []).map((m) => ({ name: m.name, dose: m.dose, how: m.how_to_take_plain, status: m.status })),
    steps,
    circle: caregiversOf(userId).map((l) => ({ name: l.caregiver_name ?? "Family", share: l.share_level })),
    family,
    token,
    ogImage: `${publicBaseUrl()}/og/plan/${token}?${family ? "as=family&" : ""}v=${done}-${steps.length}-${Date.now() % 100000}`,
    ogDescription: `${done} of ${steps.length} steps done${next ? ` · Next: ${next.title.toLowerCase()} ${next.status === "booked" ? next.when : (next.due ?? "")}` : ""}`,
  };
}

web.get("/plan/:token", (c) => {
  const token = c.req.param("token");
  const userId = userForToken(token);
  if (!userId) return c.text("Not found", 404);
  const family = c.req.query("as") === "family";
  log("📱", `care plan opened (${family ? "family" : "patient"})`);
  return c.html(planPage(planData(userId, token, family)));
});

web.get("/og/plan/:token", (c) => {
  const token = c.req.param("token");
  const userId = userForToken(token);
  if (!userId) return c.text("Not found", 404);
  const p = planData(userId, token, c.req.query("as") === "family");
  const img = planOg({ title: p.title, subtitle: p.subtitle, steps: p.steps.map((s) => ({ title: s.title, status: s.status, date: s.status === "booked" ? (s.whenShort ?? s.date) : s.date })) });
  return c.body(img, 200, { "content-type": "image/jpeg", "cache-control": "public, max-age=300" });
});

web.get("/ics/:token/:todoId", (c) => {
  const userId = userForToken(c.req.param("token"));
  const todo = getTodo(c.req.param("todoId"));
  if (!userId || !todo || todo.user_id !== userId || !todo.appt_at) return c.text("Not found", 404);
  const ics = buildIcs(todo);
  return c.body(new Uint8Array(ics.data), 200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": `inline; filename="${ics.name}"` });
});

// ---- lab results: the same page serves the bubble (/c/labs) and the full view (/labs)

const labsRoute = (full: boolean) => (c: Context) => {
  const token = c.req.param("token")!;
  const userId = userForToken(token);
  const doc = getDoc(c.req.param("docId")!);
  if (!userId || !doc || doc.kind !== "lab" || doc.user_id !== userId) return c.text("Not found", 404);
  const labs = JSON.parse(doc.extracted_json) as Labs;
  log("📱", `labs ${full ? "full view" : "card"} opened (${doc.id})`);
  return c.html(
    labsPage(group(labs.tests), {
      collected: labs.collected_date,
      doctor: labs.ordering_provider,
      token,
      docId: doc.id,
      fullUrl: `${publicBaseUrl()}/labs/${token}/${doc.id}`,
      ogImage: `${publicBaseUrl()}/og/labs/${token}/${doc.id}`,
    }),
  );
};
web.get("/c/labs/:token/:docId", labsRoute(false));
// Cards sent before tokens were added to lab URLs.
web.get("/c/labs/:docId", (c) => {
  const doc = getDoc(c.req.param("docId"));
  return doc ? c.redirect(`/c/labs/${tokenFor(doc.user_id)}/${doc.id}${c.req.query("v") ? `?v=${c.req.query("v")}` : ""}`) : c.text("Not found", 404);
});
web.get("/labs/:token/:docId", labsRoute(true));

web.get("/og/labs/:token/:docId", (c) => {
  const userId = userForToken(c.req.param("token"));
  const doc = getDoc(c.req.param("docId"));
  if (!userId || !doc || doc.kind !== "lab" || doc.user_id !== userId) return c.text("Not found", 404);
  const labs = JSON.parse(doc.extracted_json) as Labs;
  const img = labsOg(group(labs.tests), { collected: labs.collected_date, doctor: labs.ordering_provider });
  return c.body(img, 200, { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" });
});

// ---- card actions (taps inside the iMessage bubble) ------------------------

web.post("/api/:token/todo/:id/:kind", async (c) => {
  const userId = userForToken(c.req.param("token"));
  const todo = getTodo(c.req.param("id"));
  if (!userId || !todo || todo.user_id !== userId) return c.text("Not found", 404);
  const kind = c.req.param("kind");
  log("👆", `card tap: ${kind} · ${todo.title}`);
  if (kind === "booked") {
    const { at } = (await c.req.json().catch(() => ({}))) as { at?: string };
    const when = parseLocalIso(at);
    if (!when) return c.text("bad time", 400);
    applyBooked(userId, todo.id, when, "self").catch((err) => logError("card booked", err));
  } else if (kind === "done") {
    applyDone(userId, todo.id, "self").catch((err) => logError("card done", err));
  } else return c.text("bad action", 400);
  return c.json({ ok: true });
});

// "Full view" / "Full plan": try a new tab from the bubble; if the page doesn't
// report itself opened within a few seconds, send the link as a message (its
// preview shows the og:image card).
const openRequests = new Map<string, number>();
const openedAt = new Map<string, number>();
type OpenBody = { kind?: "labs" | "plan"; doc?: string };

web.post("/api/:token/open", async (c) => {
  const token = c.req.param("token");
  const userId = userForToken(token);
  const { kind = "labs", doc } = (await c.req.json().catch(() => ({}))) as OpenBody;
  if (!userId || (kind === "labs" && !doc)) return c.text("Not found", 404);
  const key = `${kind}:${doc ?? ""}`;
  const requested = Date.now();
  openRequests.set(key, requested);
  setTimeout(async () => {
    if ((openedAt.get(key) ?? 0) >= requested || openRequests.get(key) !== requested) return;
    log("🔗", `full ${kind} view didn't open from the bubble; sending the link`);
    const url = kind === "plan" ? `${publicBaseUrl()}/plan/${token}` : `${publicBaseUrl()}/labs/${token}/${doc}`;
    await say(userId, kind === "plan" ? "Here's your full care plan — tap to open 👇" : "Here's the full view — tap to open 👇").catch(() => {});
    await send(userId, richlink(url)).catch((err) => logError("send link", err));
  }, 4000);
  return c.json({ ok: true });
});
web.post("/api/:token/opened", async (c) => {
  const { kind = "labs", doc } = (await c.req.json().catch(() => ({}))) as OpenBody;
  openedAt.set(`${kind}:${doc ?? ""}`, Date.now());
  return c.json({ ok: true });
});

// CV before/after for the demo video and the Mercedes CV entry.
web.get("/debug/:docId", (c) => {
  const doc = getDoc(c.req.param("docId"));
  if (!doc) return c.text("Not found", 404);
  const raws: string[] = JSON.parse(doc.raw_paths);
  const cleans: string[] = JSON.parse(doc.clean_paths);
  const img = (p: string) => `/file?p=${encodeURIComponent(p)}`;
  return c.html(html`<!doctype html><html><head><meta charset="utf-8"><title>Juno CV · ${doc.id}</title>
    <style>body{font:15px -apple-system,sans-serif;background:#111;color:#eee;margin:20px}.r{display:flex;gap:12px;margin-bottom:24px}
    figure{margin:0;flex:1}img{width:100%;border-radius:8px;background:#222}figcaption{margin-top:6px;color:#aaa}</style></head><body>
    <h1>📷 → 🧼 → 🤖 · ${doc.kind} · ${doc.id}</h1>
    ${raws.map((r, i) => {
      const dir = cleans[i]!.replace(/\/[^/]+$/, "");
      return html`<div class="r">
        <figure><img src="${img(r)}"><figcaption>Photo from iMessage</figcaption></figure>
        <figure><img src="${img(dir + "/debug_contour.jpg")}"><figcaption>Detected page</figcaption></figure>
        <figure><img src="${img(cleans[i]!)}"><figcaption>Flattened + enhanced → Gemini</figcaption></figure></div>`;
    })}
    <pre style="white-space:pre-wrap;background:#1b1b1b;padding:12px;border-radius:8px">${JSON.stringify(JSON.parse(doc.extracted_json), null, 2)}</pre></body></html>`);
});

web.get("/file", (c) => {
  const p = c.req.query("p") ?? "";
  if (!p.startsWith("data/") || p.includes("..")) return c.text("no", 403);
  return new Response(Bun.file(p));
});

const page = (title: string, body: ReturnType<typeof html>) => html`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <title>${title}</title>
      <meta property="og:title" content="${title}" />
      <meta property="og:site_name" content="Juno" />
      <meta property="og:description" content="Your follow-up care, in one place" />
      <style>
        :root { color-scheme: light dark; --bg:#FFF6E9; --card:#fff; --ink:#2B2B2B; --muted:#8A6D3B; --accent:#F5B83D; }
        @media (prefers-color-scheme: dark) { :root { --bg:#1E1A16; --card:#2A2520; --ink:#F4EDE4; --muted:#CDB48A; } }
        * { box-sizing: border-box; }
        body { margin:0; padding:24px 20px calc(24px + env(safe-area-inset-bottom)); background:var(--bg); color:var(--ink);
               font: 18px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
        h1 { font-size: 28px; margin: 0 0 4px; }
        .muted { color: var(--muted); }
        .card { background:var(--card); border-radius:18px; padding:16px 18px; margin:14px 0; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        a.call { display:block; text-align:center; background:var(--accent); color:#2B2B2B; font-weight:700;
                 padding:14px; border-radius:14px; text-decoration:none; margin-top:10px; }
        code { font-size: 13px; word-break: break-all; }
      </style>
    </head>
    <body>
      ${body}
    </body>
  </html>`;

// Phase 1 card test page. Logs every open with the user agent so we can tell
// whether it opened inside the Spectrum iMessage extension or in Safari.
web.get("/c/test", (c) => {
  const v = c.req.query("v") ?? "1";
  const ua = c.req.header("user-agent") ?? "";
  log("📱", `card page opened (v=${v})`, { ua });
  return c.html(
    page(
      "Juno test card",
      html`<h1>Hi, I'm Juno 💛</h1>
        <p class="muted">Card test page · version ${v}</p>
        <div class="card">
          <strong>See a heart doctor</strong>
          <p>Due by Oct 22 · Peachtree Heart Associates</p>
          <p class="muted">“Hi, I'm calling to schedule a follow-up after my hospital stay. Dr. Brooks referred me.”</p>
          <a class="call" href="tel:+14045550142">📞 Call (404) 555-0142</a>
        </div>
        <div class="card">
          <p>Opened at <strong>${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York" })}</strong></p>
          <p class="muted"><code>${ua}</code></p>
        </div>`,
    ),
  );
});
