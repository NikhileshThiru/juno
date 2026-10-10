// "Juno's brain": a live laptop dashboard for demos. Feed of what Juno is doing,
// the latest photo → page → flattened scan with what Gemini read, and a care
// board (To do / Booked / Done). Localhost only; phone numbers never reach it.
import { Hono, type Context, type Next } from "hono";
import { html, raw } from "hono/html";
import { streamSSE } from "hono/streaming";
import { fmtShort, fmtWhen, now, offsetMs } from "../clock.ts";
import { caregiversOf, db, todosFor, type Doc, type User } from "../db.ts";
import { counters, recentEvents, subscribe, type FeedEvent } from "../events.ts";
import { bandOf } from "../labs.ts";
import { json } from "./tracker.ts";

export const brain = new Hono();

/** The dashboard and its data are for the laptop only, never through the tunnel. */
export async function localOnly(c: Context, next: Next) {
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(c.req.header("host") ?? "")) return c.text("Not found", 404);
  await next();
}
brain.use("/brain", localOnly);
brain.use("/brain/*", localOnly);

// ---- presenting log lines ---------------------------------------------------

const HIDDEN = new Set(["📱", "📐", "📥", "🧪", "🌐", "🧽", "⚠️", "💛", "🛠️"]);
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

function names(): Map<string, string> {
  const users = db.query("SELECT id, name, role FROM users").all() as Pick<User, "id" | "name" | "role">[];
  return new Map(users.map((u) => [u.id, u.name ?? (u.role === "caregiver" ? "Caregiver" : "Mom")]));
}

function present(e: FeedEvent): FeedEvent | null {
  if (HIDDEN.has(e.emoji)) return null;
  let msg = e.msg;
  for (const [id, name] of names()) msg = msg.split(id).join(name);
  msg = msg.replace(PHONE, "•••");
  const rewrites: [RegExp, (...m: string[]) => string][] = [
    [/^intent \(local\): (\w+).*$/, (_, i) => `Understood “${i.replace("_", " ")}” instantly, no AI call needed`],
    [/^intent \(gemini\): (\w+).*$/, (_, i) => `Gemini understood: ${i.replace("_", " ")}`],
    [/^received (\d+) photos? → .*$/, (_, n) => `Received ${n} photo${n === "1" ? "" : "s"}, reading…`],
    [/^classified as (\w+)$/, (_, k) => `Gemini: this is ${k === "lab" ? "a lab report" : k === "appointment" ? "an appointment card" : `a ${k} summary`}`],
    [/^discharge: (\d+) todos, (\d+) warning signs, (\d+) meds$/, (_, a, b, c) => `Read ${a} follow-ups, ${b} warning signs, ${c} medicines`],
    [/^labs: (\d+) tests, (\d+) outside range$/, (_, a, b) => `Read ${a} lab tests, ${b} outside the printed range`],
    [/^tracker card sent.*$/, () => "Checklist card sent"],
    [/^tracker card updated in place.*$/, () => "Checklist card updated in place"],
    [/^labs card sent.*$/, () => "Body-map card sent"],
    [/^booked: (.+) @ (\S+) by (.+)$/, (_, t, iso, by) => `Booked: ${t} · ${fmtWhen(Date.parse(iso))}${by === "self" ? "" : ` · by ${by}`}`],
    [/^card tap: (\w+) · (.+)$/, (_, k, t) => `Tapped “${k === "booked" ? "I booked it" : "Mark done"}” in the card · ${t}`],
    [/^(.+) read \d+ message\(s\) incl\. nudges$/, (_, who) => `${who} read the reminders`],
    [/^poll vote: "(.+)" selected=true.*$/, (_, o) => `Poll vote: ${o}`],
    [/^caregiver (\S+) \(•••\) linked to (.+)$/, (_, cg, p) => `${cg} joined ${p}'s care circle`],
    [/^doc_\w+ done in ([\d.]+)s$/, (_, s) => `Done in ${s}s`],
    [/^clock → (.+)$/, (_, w) => `Skipped ahead to ${w}`],
    [/^nudge (\d) → (.+?): (.+)$/, (_, n, who, t) => `Reminder ${n} sent to ${who}: ${t.toLowerCase()}`],
    [/^escalated (.+) to (.+) \(both nudges read\)$/, (_, t, who) => `${who} asked to help with the ${t.toLowerCase()}: Mom read both reminders but hasn't booked`],
    [/^escalated (.+) to (.+) \(.+\)$/, (_, t, who) => `${who} asked to help with the ${t.toLowerCase()}`],
    [/^day-before reminder: (.+)$/, (_, t) => `Day-before reminder sent: ${t.toLowerCase()}`],
    [/^tapback (.+) on (\w+) for (.+)$/, (_, e, k, t) => `${e} tapback on a ${k === "nudge" ? "reminder" : "message"} → asked when the ${t.toLowerCase()} is`],
  ];
  for (const [re, fn] of rewrites) if (re.test(msg)) msg = msg.replace(re, fn as (...a: string[]) => string);
  return { ...e, msg };
}

// ---- state ------------------------------------------------------------------

function docSummary(d: Doc): { title: string; lines: string[]; chips: string[] } {
  const x = JSON.parse(d.extracted_json);
  if (d.kind === "discharge")
    return {
      title: `Discharge summary · ${x.facility ?? "hospital"}`,
      chips: [`${x.todos.length} follow-ups`, `${x.warning_signs.length} warning signs`, `${x.medications.length} medicines`],
      lines: x.todos.map((t: { title: string; phone: string | null; due_text: string | null }) => `${t.title} · ${t.phone ?? "no phone"} · ${t.due_text ?? ""}`),
    };
  if (d.kind === "lab") {
    const out = x.tests.filter((t: Parameters<typeof bandOf>[0]) => bandOf(t) !== "normal");
    return {
      title: `Lab report · ${x.collected_date ?? ""}`,
      chips: [`${x.tests.length} tests`, `${out.length} outside range`],
      lines: out.map((t: { name: string; value_text: string; ref_text: string | null }) => `${t.name} ${t.value_text} (range ${t.ref_text ?? "?"})`),
    };
  }
  return { title: "Appointment card", chips: [x.clinic_name ?? "", x.appt_datetime_iso ?? ""].filter(Boolean), lines: [x.provider ?? ""].filter(Boolean) };
}

function state() {
  const nm = names();
  const patients = (db.query("SELECT DISTINCT user_id FROM todos").all() as { user_id: string }[]).map(({ user_id }) => ({
    name: nm.get(user_id) ?? "Mom",
    circle: caregiversOf(user_id).map((l) => ({ name: l.caregiver_name ?? "Family", share: l.share_level })),
    todos: todosFor(user_id).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      when: t.appt_at ? fmtWhen(t.appt_at) : t.due_at ? `by ${fmtShort(t.due_at)}` : (t.due_text ?? ""),
      helper: t.booked_by && t.booked_by !== "self" ? (nm.get(t.booked_by) ?? "family") : null,
      nudges: t.nudge_count,
      read: Math.min(t.nudges_read, t.nudge_count),
      escalated: !!t.escalated_at,
    })),
  }));
  const doc = db.query("SELECT * FROM documents ORDER BY created_at DESC LIMIT 1").get() as Doc | null;
  const file = (p: string) => `/file?p=${encodeURIComponent(p)}`;
  return {
    clock: { label: fmtWhen(now()), days: Math.round(offsetMs() / 86_400_000) },
    counters,
    patients,
    doc: doc && {
      ...docSummary(doc),
      pages: (JSON.parse(doc.raw_paths) as string[]).map((raw, i) => {
        const clean = (JSON.parse(doc.clean_paths) as string[])[i]!;
        const dir = clean.replace(/\/[^/]+$/, "");
        return { raw: file(raw), contour: clean === raw ? file(raw) : file(`${dir}/debug_contour.jpg`), clean: file(clean) };
      }),
    },
  };
}

brain.get("/brain/state", (c) => c.json(state()));

brain.get("/brain/events", (c) =>
  streamSSE(c, async (stream) => {
    for (const e of recentEvents().slice(-40)) {
      const p = present(e);
      if (p) await stream.writeSSE({ data: JSON.stringify(p) });
    }
    const unsub = subscribe((e) => {
      const p = present(e);
      if (p) stream.writeSSE({ data: JSON.stringify(p) }).catch(() => {});
    });
    stream.onAbort(unsub);
    while (!stream.aborted) await stream.sleep(15_000).then(() => stream.writeSSE({ event: "ping", data: "" }));
  }),
);

brain.get("/brain", (c) =>
  c.html(html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Juno — live</title>
        <style>
          * { box-sizing:border-box; margin:0; }
          body { min-height:100vh; color:#EEF0F7; font:15px/1.4 -apple-system, "SF Pro Text", system-ui, sans-serif;
                 background:radial-gradient(1200px 700px at 15% -10%, #2a2160 0%, transparent 60%), radial-gradient(900px 600px at 110% 110%, #13355a 0%, transparent 60%), #0c0d14; }
          header { display:flex; align-items:center; gap:18px; padding:18px 28px; border-bottom:1px solid #ffffff12; }
          .logo { font:800 24px -apple-system, sans-serif; letter-spacing:-.5px; background:linear-gradient(135deg,#8e9bff,#c084fc); -webkit-background-clip:text; color:transparent; }
          .live { display:flex; align-items:center; gap:7px; font-size:13px; color:#9aa3b8; font-weight:600; }
          .live i { width:9px; height:9px; border-radius:50%; background:#22c55e; box-shadow:0 0 12px #22c55e; animation:blink 1.6s infinite; }
          @keyframes blink { 50% { opacity:.35 } }
          .clock { margin-left:auto; font-weight:700; font-size:16px; }
          .clock em { font-style:normal; font-size:12px; color:#c4b5fd; background:#7c3aed33; padding:3px 8px; border-radius:99px; margin-left:8px; }
          .ctr { display:flex; gap:8px; }
          .ctr span { font-size:12px; font-weight:700; color:#cbd2e4; background:#ffffff0f; border:1px solid #ffffff14; padding:5px 10px; border-radius:99px; }
          main { display:grid; grid-template-columns: 1fr 1.35fr 1.15fr; gap:18px; padding:18px 28px 28px; height:calc(100vh - 70px); }
          section { background:#ffffff08; border:1px solid #ffffff12; border-radius:18px; padding:16px; overflow:hidden; display:flex; flex-direction:column; min-height:0; }
          h2 { font-size:12px; letter-spacing:1.4px; text-transform:uppercase; color:#8f98ae; margin-bottom:12px; }
          #feed { list-style:none; padding:0; overflow:auto; display:flex; flex-direction:column; gap:7px; }
          #feed li { display:flex; gap:10px; padding:9px 11px; background:#ffffff0a; border-radius:12px; animation:in .45s ease-out; }
          #feed li b { font-size:17px; } #feed time { margin-left:auto; color:#6f7890; font-size:11.5px; white-space:nowrap; }
          @keyframes in { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:none } }
          .pages { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
          .pages figure { margin:0; } .pages img { width:100%; aspect-ratio:3/4; object-fit:cover; border-radius:10px; background:#111; }
          .pages figcaption { font-size:11.5px; color:#8f98ae; text-align:center; margin-top:5px; }
          .read { margin-top:14px; background:#ffffff0a; border-radius:14px; padding:12px 14px; overflow:auto; }
          .read h3 { font-size:15px; margin-bottom:8px; }
          .chips { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
          .chips span { font-size:12px; font-weight:700; padding:4px 10px; border-radius:99px; background:linear-gradient(135deg,#5b6cff55,#8b5cf655); }
          .read li { list-style:none; font: 12.5px ui-monospace, Menlo, monospace; color:#c7cde0; padding:3px 0; border-top:1px solid #ffffff0d; }
          .who { display:flex; align-items:center; gap:8px; margin-bottom:12px; font-weight:700; }
          .who span { font-size:12px; font-weight:600; color:#9aa3b8; background:#ffffff0d; padding:3px 9px; border-radius:99px; }
          .cols { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; flex:1; min-height:0; }
          .col h4 { font-size:12px; color:#8f98ae; margin-bottom:8px; display:flex; align-items:center; gap:6px; }
          .col h4 i { width:8px; height:8px; border-radius:50%; }
          .card { background:#ffffff0d; border:1px solid #ffffff10; border-radius:12px; padding:9px 10px; margin-bottom:8px; transition:all .4s; }
          .card.flash { box-shadow:0 0 0 2px #a78bfa, 0 0 24px #a78bfa66; }
          .card b { display:block; font-size:13.5px; }
          .card small { color:#9aa3b8; font-size:11.5px; display:block; margin-top:2px; }
          .tags { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
          .tags span { font-size:10.5px; font-weight:700; padding:2px 7px; border-radius:99px; background:#ffffff12; }
          .tags .esc { background:#f04e5e33; color:#ffb4bd; } .tags .help { background:#3b82f633; color:#bcd4ff; }
          .empty { color:#6f7890; font-size:13px; }
        </style>
      </head>
      <body>
        <header>
          <span class="logo">Juno</span><span class="live"><i></i>live</span>
          <span class="clock" id="clock"></span>
          <span class="ctr" id="ctr"></span>
        </header>
        <main>
          <section><h2>What Juno is doing</h2><ul id="feed"></ul></section>
          <section><h2>Reading the paperwork</h2><div id="vision"><p class="empty">Waiting for a photo…</p></div></section>
          <section><h2>Care plan</h2><div id="board" style="display:flex;flex-direction:column;flex:1;min-height:0"><p class="empty">No plan yet.</p></div></section>
        </main>
        <script>window.S0 = ${json(state())};</script>
        <script>
          ${raw(BRAIN_JS)}
        </script>
      </body>
    </html>`),
);

const BRAIN_JS = String.raw`
(function () {
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var feed = document.getElementById("feed"), prev = {}, shown = {};
  var COL = { todo: ["To do", "#FF7A59"], booked: ["Booked", "#3B82F6"], done: ["Done", "#22C55E"] };

  function add(e) {
    var key = e.t + e.msg;
    if (shown[key]) return; // EventSource reconnects replay recent events
    shown[key] = 1;
    var li = document.createElement("li");
    li.innerHTML = "<b>" + e.emoji + "</b><span>" + esc(e.msg) + "</span><time>" + new Date(e.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) + "</time>";
    feed.insertBefore(li, feed.firstChild);
    while (feed.children.length > 60) feed.removeChild(feed.lastChild);
  }

  function render(s) {
    document.getElementById("clock").innerHTML = esc(s.clock.label) + (s.clock.days ? "<em>+" + s.clock.days + " day" + (s.clock.days > 1 ? "s" : "") + " (demo clock)</em>" : "");
    document.getElementById("ctr").innerHTML = "<span>🤖 " + s.counters.gemini + " Gemini calls</span><span>💾 " + s.counters.cached + " from cache</span><span>⚡ " + s.counters.local + " understood locally</span>";
    var v = document.getElementById("vision");
    if (s.doc) {
      var p = s.doc.pages[0];
      v.innerHTML = '<div class="pages"><figure><img src="' + p.raw + '"><figcaption>Photo from iMessage</figcaption></figure>' +
        '<figure><img src="' + p.contour + '"><figcaption>OpenCV finds the page</figcaption></figure>' +
        '<figure><img src="' + p.clean + '" style="background:#fff"><figcaption>Flattened → Gemini</figcaption></figure></div>' +
        '<div class="read"><h3>' + esc(s.doc.title) + (s.doc.pages.length > 1 ? " · " + s.doc.pages.length + " pages" : "") + '</h3><div class="chips">' +
        s.doc.chips.map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("") + "</div><ul style='padding:0'>" +
        s.doc.lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul></div>";
    }
    var b = document.getElementById("board");
    if (s.patients.length) {
      var pt = s.patients[0];
      b.innerHTML = '<div class="who">' + esc(pt.name) + pt.circle.map(function (c) { return "<span>👪 " + esc(c.name) + (c.share ? " · sees " + (c.share === "everything" ? "everything" : "to-dos") : " · invited") + "</span>"; }).join("") + "</div>" +
        '<div class="cols">' + ["todo", "booked", "done"].map(function (st) {
          return '<div class="col"><h4><i style="background:' + COL[st][1] + '"></i>' + COL[st][0] + "</h4>" + pt.todos.filter(function (t) { return t.status === st; }).map(function (t) {
            var tags = [];
            if (t.nudges) tags.push("<span>🔔 " + t.nudges + " reminder" + (t.nudges > 1 ? "s" : "") + (t.read ? " · read" : "") + "</span>");
            if (t.escalated && st === "todo") tags.push('<span class="esc">↗ asked family</span>');
            if (t.helper) tags.push('<span class="help">with ' + esc(t.helper) + "</span>");
            var changed = prev[t.id] && prev[t.id] !== t.status;
            return '<div class="card' + (changed ? " flash" : "") + '"><b>' + esc(t.title) + "</b><small>" + esc(t.when) + "</small>" + (tags.length ? '<div class="tags">' + tags.join("") + "</div>" : "") + "</div>";
          }).join("") + "</div>";
        }).join("") + "</div>";
      pt.todos.forEach(function (t) { prev[t.id] = t.status; });
    }
  }

  function refresh() { fetch("/brain/state").then(function (r) { return r.json(); }).then(render).catch(function () {}); }
  render(window.S0);
  var es = new EventSource("/brain/events");
  es.onmessage = function (m) { add(JSON.parse(m.data)); setTimeout(refresh, 250); };
  setInterval(refresh, 3000);
})();
`;
