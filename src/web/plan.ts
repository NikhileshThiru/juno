// The care plan: a full-screen page for Mom (from the checklist card) and for
// family (sent to the caregiver). Warning signs first, then progress, a
// timeline of visits with call / add-to-calendar, medicines, and the circle.
import { html, raw } from "hono/html";
import { theme } from "./theme.ts";
import { json, type CardTodo } from "./tracker.ts";

export type PlanStep = CardTodo & { date: string; ics: string | null };
export type PlanMed = { name: string; dose: string | null; how: string | null; status: "new" | "continue" | "stop" | "changed" };
export type PlanData = {
  title: string;
  subtitle: string;
  reason: string | null;
  warnings: string[];
  meds: PlanMed[];
  steps: PlanStep[];
  circle: { name: string; share: string | null }[];
  family: boolean;
  token: string;
  ogImage: string;
  ogDescription: string;
};

export function planPage(d: PlanData) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>${d.title}</title>
        <meta property="og:title" content="${d.title}" />
        <meta property="og:description" content="${d.ogDescription}" />
        <meta property="og:image" content="${d.ogImage}" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <script>if (!/[?&]still/.test(location.search)) document.documentElement.classList.add("anim");</script>
        <style>
          ${theme}
          body { padding:22px 16px 48px; max-width:640px; margin:0 auto; }
          .brand { font-weight:800; font-size:15px; background:linear-gradient(135deg, var(--accent), var(--accent2)); -webkit-background-clip:text; color:transparent; }
          h1 { font-size:28px; font-weight:800; letter-spacing:-.4px; margin-top:4px; }
          .sub { color:var(--muted); margin-top:3px; }
          .card { background:var(--card); border-radius:18px; padding:16px; margin-top:14px; }
          .hero { display:flex; align-items:center; gap:16px; }
          .ring { width:96px; height:96px; flex:none; position:relative; }
          .ring svg { transform:rotate(-90deg); }
          .ring circle { fill:none; stroke-width:11; }
          .ring .fg { stroke:url(#g); stroke-linecap:round; }
          .anim .ring .fg { transition:stroke-dasharray 1.1s cubic-bezier(.2,.8,.2,1); }
          .ring b { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:24px; line-height:1; }
          .ring small { font-size:11px; color:var(--muted); margin-top:4px; font-weight:600; }
          .next { font-size:13px; color:var(--muted); font-weight:600; }
          .next b { display:block; color:var(--ink); font-size:17px; margin-top:3px; }
          .warn { background:color-mix(in srgb, var(--bad) 14%, var(--card)); border:1px solid color-mix(in srgb, var(--bad) 40%, transparent); }
          .warn h2 { color:var(--bad); }
          h2 { font-size:17px; font-weight:750; display:flex; align-items:center; gap:8px; margin-bottom:8px; }
          .warn li { margin:4px 0 0 18px; font-weight:600; }
          .tl { position:relative; margin-top:6px; padding-left:22px; }
          .tl:before { content:""; position:absolute; left:6px; top:8px; bottom:8px; width:2px; background:var(--line); }
          .step { position:relative; background:var(--card); border-radius:16px; padding:13px 14px; margin-top:10px; }
          .anim .step { opacity:0; transform:translateY(6px); animation:up .5s ease-out forwards; animation-delay:var(--d); }
          @keyframes up { to { opacity:1; transform:none } }
          .step:before { content:""; position:absolute; left:-21px; top:17px; width:12px; height:12px; border-radius:50%; background:var(--todo); box-shadow:0 0 0 4px var(--bg); }
          .step.booked:before { background:var(--booked); } .step.done:before { background:var(--done); }
          .step .when { font-size:12.5px; font-weight:700; color:var(--muted); display:flex; align-items:center; gap:6px; }
          .step h3 { font-size:17px; margin:5px 0 2px; }
          .step.done h3 { color:var(--muted); text-decoration:line-through; }
          .step p { font-size:13.5px; color:var(--muted); margin-top:4px; line-height:1.4; }
          .step .note { color:var(--ink); background:var(--card2); padding:7px 9px; border-radius:10px; }
          .acts { display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }
          .acts .btn { flex:1; min-width:120px; height:38px; font-size:13.5px; }
          details { margin-top:8px; } summary { font-size:13.5px; font-weight:700; color:var(--accent); cursor:pointer; }
          details p { font-style:italic; color:var(--ink) !important; }
          .med { display:flex; gap:10px; padding:10px 0; border-top:1px solid var(--line); }
          .med:first-of-type { border-top:0; }
          .badge { font-size:10.5px; font-weight:800; padding:3px 7px; border-radius:6px; height:fit-content; color:#fff; letter-spacing:.3px; }
          .badge.new { background:var(--done); } .badge.stop { background:var(--bad); } .badge.continue { background:var(--card2); color:var(--muted); } .badge.changed { background:var(--booked); }
          .med b { font-size:15px; } .med.stop b { text-decoration:line-through; color:var(--muted); }
          .med p { font-size:13px; color:var(--muted); margin-top:2px; }
          .when-chips { display:flex; gap:5px; margin-top:5px; flex-wrap:wrap; }
          .when-chips span { font-size:11px; font-weight:700; padding:2px 8px; border-radius:99px; background:var(--card2); }
          .circle span { display:inline-flex; align-items:center; gap:6px; font-size:14px; font-weight:650; background:var(--card2); padding:6px 11px; border-radius:99px; margin:4px 6px 0 0; }
          .foot { text-align:center; color:var(--muted); font-size:12.5px; margin-top:18px; line-height:1.45; }
        </style>
      </head>
      <body>
        <div id="app"></div>
        <script>window.P = ${json(d)};</script>
        <script>
          ${raw(PLAN_JS)}
        </script>
      </body>
    </html>`;
}

const PLAN_JS = String.raw`
(function () {
  var P = window.P, app = document.getElementById("app");
  var LABEL = { todo: "To do", booked: "Booked", done: "Done" };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var tel = function (p) { var d = p.replace(/\D/g, ""); return "tel:+1" + d.replace(/^1(?=\d{10}$)/, ""); };

  function schedule(how) {
    var s = String(how || ""), out = [];
    if (/twice|two times|morning and evening/i.test(s)) out.push("☀️ Morning", "🌙 Evening");
    else if (/nightly|at night|bedtime/i.test(s)) out.push("🌙 Bedtime");
    else if (/once (a |per )?day|once daily|every day|daily/i.test(s)) out.push("☀️ Daily");
    var days = s.match(/for (\d+) days/i); if (days) out.push(days[1] + " days");
    if (/with food/i.test(s)) out.push("🍽 With food");
    return out;
  }

  var done = P.steps.filter(function (s) { return s.status === "done"; }).length, total = P.steps.length;
  var next = P.steps.filter(function (s) { return s.status !== "done"; })[0];
  var C = 2 * Math.PI * 41;

  app.innerHTML =
    '<div class="brand">Juno</div><h1>' + esc(P.title) + '</h1><p class="sub">' + esc(P.subtitle) + "</p>" +
    '<div class="card hero"><div class="ring"><svg width="96" height="96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent2)"/></linearGradient></defs>' +
    '<circle r="41" cx="48" cy="48" stroke="var(--card2)"/>' + (done ? '<circle class="fg" r="41" cx="48" cy="48" style="stroke-dasharray:0 999" data-len="' + (done / total * C).toFixed(1) + '"/>' : "") + "</svg>" +
    "<b>" + done + "/" + total + "<small>done</small></b></div>" +
    '<div class="next">' + (next ? "Next up<b>" + esc(next.title) + "</b>" + esc(next.status === "booked" ? next.when : next.due) : "Everything is done 🎉") + (P.reason && !P.family ? '<p style="margin-top:6px;font-weight:500">' + esc(P.reason) + "</p>" : "") + "</div></div>" +
    (P.warnings.length ? '<div class="card warn"><h2>🚑 Call 911 or go to the ER if ' + (P.family ? "she has" : "you have") + ":</h2><ul style='padding:0'>" + P.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul></div>" : "") +
    '<h2 style="margin-top:22px">📋 Follow-ups</h2><div class="tl">' + P.steps.map(function (s, i) {
      var acts = [];
      if (s.status === "todo" && s.phone) acts.push('<a class="btn primary" href="' + tel(s.phone) + '">📞 Call ' + esc(s.phone) + "</a>");
      if (s.status === "booked" && s.ics) acts.push('<a class="btn soft" href="' + s.ics + '">📅 Add to calendar</a>');
      return '<div class="step ' + s.status + '" style="--d:' + (0.1 + i * 0.08) + 's"><div class="when"><span class="chip ' + s.status + '">' + LABEL[s.status] + "</span>" + esc(s.date) + "</div>" +
        "<h3>" + esc(s.title) + "</h3>" + (s.clinic ? "<p>" + esc(s.clinic) + "</p>" : "") + (s.why ? "<p>" + esc(s.why) + "</p>" : "") +
        (s.helper ? '<p class="note">💜 Booked with ' + esc(s.helper) + "'s help</p>" : "") +
        (s.prep && s.status !== "done" ? '<p class="note">⚠️ ' + esc(s.prep) + "</p>" : "") + (s.notes ? '<p class="note">📝 ' + esc(s.notes) + "</p>" : "") +
        (s.status === "todo" && s.script ? "<details><summary>💬 What to say when you call</summary><p>“" + esc(s.script) + "”</p></details>" : "") +
        (acts.length ? '<div class="acts">' + acts.join("") + "</div>" : "") + "</div>";
    }).join("") + "</div>" +
    (P.meds.length ? '<div class="card"><h2>💊 Medicines</h2>' + P.meds.map(function (m) {
      var chips = m.status === "stop" ? [] : schedule(m.how);
      return '<div class="med ' + m.status + '"><span class="badge ' + m.status + '">' + m.status.toUpperCase() + "</span><div><b>" + esc(m.name) + "</b>" + (m.dose ? ' <span style="color:var(--muted)">' + esc(m.dose) + "</span>" : "") +
        (m.how && m.status !== "stop" ? "<p>" + esc(m.how) + "</p>" : m.status === "stop" ? "<p>Stop taking this.</p>" : "") +
        (chips.length ? '<div class="when-chips">' + chips.map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("") + "</div>" : "") + "</div></div>";
    }).join("") + "</div>" : "") +
    (P.circle.length ? '<div class="card circle"><h2>👪 Care circle</h2>' + P.circle.map(function (c) { return "<span>" + esc(c.name) + " · " + (c.share === "everything" ? "sees everything" : c.share === "todos" ? "sees the to-dos" : "invited") + "</span>"; }).join("") + "</div>" : "") +
    '<p class="foot">Juno explains the paperwork and keeps track of next steps.<br/>' + (P.family ? "Her" : "Your") + " doctor or pharmacist can answer any medical questions.</p>";

  requestAnimationFrame(function () { requestAnimationFrame(function () {
    var r = document.querySelector(".ring .fg"); if (r) r.style.strokeDasharray = r.getAttribute("data-len") + " 999";
  }); });
  fetch("/api/" + P.token + "/opened", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "plan" }) }).catch(function () {});
})();
`;
