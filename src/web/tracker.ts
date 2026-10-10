// The tracker card. Inside the iMessage bubble (~271×300pt, taps work, no
// scrolling) it's a small app: list → tap a to-do → details with Call,
// "I booked it" (native date/time picker), Done, and "What to say". Actions
// POST to /api/:token/…, which runs the same flow as texting Juno (card
// update, calendar invite, caregiver update). Tall screens show everything.
import { html, raw } from "hono/html";
import { theme } from "./theme.ts";

export type CardTodo = {
  id: string;
  title: string;
  status: "todo" | "booked" | "done";
  due: string | null;
  when: string | null;
  /** Short appointment time for the bubble ("Thu 9:00 AM" or "Oct 20, 2:00 PM"). */
  whenShort: string | null;
  helper: string | null;
  clinic: string | null;
  phone: string | null;
  why: string | null;
  script: string | null;
  prep: string | null;
  notes: string | null;
};

export type TrackerOpts = {
  subtitle: string;
  /** Per-user token for actions; null = read-only demo card. */
  token: string | null;
  /** Virtual "now" in America/New_York, yyyy-mm-ddThh:mm (picker min). */
  nowLocal: string;
  /** Picker default: the next 9:00 AM, yyyy-mm-ddThh:mm. */
  defaultLocal: string;
  beaconTag?: string;
};

export const json = (v: unknown) => raw(JSON.stringify(v).replace(/</g, "\\u003c"));

export function trackerPage(todos: CardTodo[], opts: TrackerOpts) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Your next steps</title>
        <meta property="og:title" content="Your next steps" />
        <style>
          ${theme}
          body { padding:12px 12px 0; height:100vh; overflow:hidden; }
          body.tall { height:auto; overflow:auto; padding:18px 16px 40px; }
          .bar { height:4px; border-radius:2px; background:var(--card2); margin:8px 0 9px; overflow:hidden; }
          .bar i { display:block; height:100%; border-radius:2px; background:linear-gradient(90deg, var(--accent), var(--accent2)); }
          .row { display:flex; align-items:center; gap:8px; width:100%; padding:7px 9px 7px 10px; margin-bottom:5px; background:var(--card); border-radius:12px; }
          .row .dot { width:9px; height:9px; border-radius:50%; flex:none; }
          .dot.todo { background:var(--todo); } .dot.booked { background:var(--booked); } .dot.done { background:var(--done); }
          .row .txt { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
          .row .t { font-size:14.5px; font-weight:650; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .row .d { font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .row.done .t { color:var(--muted); text-decoration:line-through; }
          .row .chev { color:var(--muted); font-size:18px; line-height:1; }
          .more { text-align:center; font-size:11.5px; color:var(--muted); }
          .back { font-size:14px; font-weight:650; color:var(--accent); }
          #app { height:100%; }
          body.tall #app { height:auto; }
          .detail { display:flex; flex-direction:column; height:100%; padding-bottom:12px; }
          .tall .detail { height:auto; padding-bottom:0; }
          .detail h2 { font-size:17px; font-weight:750; margin:6px 0 4px; line-height:1.2; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
          .tall .detail h2 { font-size:19px; -webkit-line-clamp:unset; }
          .detail .meta { display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--muted); }
          .detail p { font-size:13px; color:var(--muted); margin-top:6px; line-height:1.35; }
          .detail .one { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .detail .note { color:var(--ink); background:var(--card); padding:6px 9px; border-radius:10px; }
          .detail .note span { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
          .tall .detail .note span { -webkit-line-clamp:unset; }
          .link { font-size:13px; font-weight:650; color:var(--accent); margin-top:7px; }
          .actions { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:auto; padding-top:8px; }
          .tall .actions { margin-top:10px; }
          .actions .wide { grid-column:1 / -1; }
          input[type=datetime-local] { width:100%; height:42px; margin-top:10px; padding:0 10px; border-radius:12px; border:1px solid var(--line);
                                       background:var(--card); color:var(--ink); font:600 15px -apple-system, sans-serif; }
          .script { font-size:14px; line-height:1.4; font-style:italic; background:var(--card); padding:10px 11px; border-radius:12px; margin-top:8px; }
          .item { background:var(--card); border-radius:16px; padding:14px; margin-bottom:10px; }
          .tall .hdr { margin-left:0; } .tall .hdr h1 { font-size:24px; }
        </style>
      </head>
      <body>
        <div id="app"></div>
        <div class="toast" id="toast"></div>
        <script>window.D = ${json({ todos, ...opts })};</script>
        <script>
          ${raw(TRACKER_JS)}
        </script>
      </body>
    </html>`;
}

const TRACKER_JS = String.raw`
(function () {
  var D = window.D, app = document.getElementById("app"), toastEl = document.getElementById("toast");
  var LABEL = { todo: "To do", booked: "Booked", done: "Done" }, ORDER = { todo: 0, booked: 1, done: 2 };
  var view = { name: "list" };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var tel = function (p) { var d = p.replace(/\D/g, ""); return "tel:+1" + d.replace(/^1(?=\d{10}$)/, ""); };
  var byId = function (id) { return D.todos.filter(function (t) { return t.id === id; })[0]; };
  var sub = function (t) { return t.status === "booked" ? (t.whenShort || t.when) + (t.helper ? " · " + t.helper : "") : t.status === "done" ? "Done" : (t.due || ""); };
  var done = function () { return D.todos.filter(function (t) { return t.status === "done"; }).length; };
  var tall = function () { return window.innerHeight >= 480; };

  function toast(msg) { toastEl.textContent = msg; toastEl.className = "toast on"; setTimeout(function () { toastEl.className = "toast"; }, 2600); }

  function header(title) {
    return '<div class="hdr"><h1>' + title + '</h1><span class="pill">' + done() + " of " + D.todos.length + " done</span></div>" +
      '<div class="bar"><i style="width:' + (D.todos.length ? Math.round(done() / D.todos.length * 100) : 0) + '%"></i></div>';
  }

  function list() {
    var sorted = D.todos.slice().sort(function (a, b) { return ORDER[a.status] - ORDER[b.status]; });
    var shown = sorted.slice(0, 4), more = sorted.length - shown.length;
    return header("Your next steps") + shown.map(function (t) {
      return '<button class="row ' + t.status + '" data-act="open" data-id="' + t.id + '"><span class="dot ' + t.status + '"></span>' +
        '<span class="txt"><span class="t">' + esc(t.title) + '</span><span class="d">' + esc(sub(t)) + '</span></span><span class="chev">›</span></button>';
    }).join("") + (more > 0 ? '<p class="more">+' + more + " more</p>" : "");
  }

  // One row of buttons, pinned to the bottom of the bubble so they never get cut off.
  function actions(t) {
    var a = [];
    if (t.status === "todo" && t.phone) a.push('<a class="btn primary" href="' + tel(t.phone) + '">📞 Call</a>');
    if (t.status === "todo") a.push('<button class="btn soft' + (t.phone ? "" : " wide") + '" data-act="book" data-id="' + t.id + '">📅 I booked it</button>');
    if (t.status === "booked") a.push('<button class="btn primary wide" data-act="done" data-id="' + t.id + '">✓ Mark done</button>');
    return a.length ? '<div class="actions">' + a.join("") + "</div>" : "";
  }

  function detail(t) {
    var note = t.status === "booked" ? "📅 " + esc(t.when) + (t.helper ? " · booked with " + esc(t.helper) + "'s help" : "") : t.prep ? "⚠️ " + esc(t.prep) : t.notes ? "📝 " + esc(t.notes) : "";
    return '<div class="detail"><div class="hdr"><button class="back" data-act="list">‹ All steps</button></div>' +
      "<h2>" + esc(t.title) + "</h2>" +
      '<div class="meta"><span class="chip ' + t.status + '">' + LABEL[t.status] + "</span><span>" + esc(t.status === "booked" ? t.whenShort : t.due) + "</span></div>" +
      (t.clinic ? '<p class="one">' + esc(t.clinic) + "</p>" : "") +
      (note ? '<p class="note"><span>' + note + "</span></p>" : "") +
      (t.status === "todo" && t.script ? '<button class="link" data-act="say" data-id="' + t.id + '">💬 What to say when you call ›</button>' : "") +
      actions(t) + "</div>";
  }

  function book(t) {
    return '<div class="detail"><div class="hdr"><button class="back" data-act="open" data-id="' + t.id + '">‹ Back</button></div>' +
      "<h2>When is it?</h2>" + '<p class="one">' + esc(t.title) + "</p>" +
      '<input type="datetime-local" id="at" min="' + D.nowLocal + '" value="' + D.defaultLocal + '">' +
      '<div class="actions"><button class="btn primary wide" data-act="save" data-id="' + t.id + '">Save — I booked it</button></div>' +
      "<p>I'll add it to your calendar and let your family know.</p></div>";
  }

  function say(t) {
    return '<div class="detail"><div class="hdr"><button class="back" data-act="open" data-id="' + t.id + '">‹ Back</button></div>' +
      "<h2>What to say</h2>" + '<p class="one">When you call ' + esc((t.clinic || "them").split(" · ")[0]) + ":</p>" +
      '<p class="script">“' + esc(t.script) + "”</p></div>";
  }

  function full() {
    return '<div class="hdr"><h1>Your next steps</h1><span class="pill">' + done() + " of " + D.todos.length + " done</span></div>" +
      "<p style='color:var(--muted);margin:4px 0 14px'>" + esc(D.subtitle) + "</p>" +
      D.todos.map(function (t) {
        return '<div class="item detail"><div class="meta"><span class="chip ' + t.status + '">' + LABEL[t.status] + "</span><span>" + esc(t.status === "booked" ? t.when : t.due) + "</span></div>" +
          "<h2>" + esc(t.title) + "</h2>" + (t.why ? "<p>" + esc(t.why) + "</p>" : "") +
          (t.clinic ? "<p>" + esc(t.clinic) + (t.phone ? " · " + esc(t.phone) : "") + "</p>" : "") +
          (t.prep ? '<p class="note">⚠️ ' + esc(t.prep) + "</p>" : "") + (t.notes ? '<p class="note">📝 ' + esc(t.notes) + "</p>" : "") +
          (t.status === "todo" && t.script ? '<p class="script">“' + esc(t.script) + "”</p>" : "") + actions(t) + "</div>";
      }).join("") + "<p class='more' style='margin-top:6px'>Juno helps you keep track — your doctor can answer any questions.</p>";
  }

  function render() {
    document.body.className = tall() ? "tall" : "";
    var t = view.id ? byId(view.id) : null;
    app.innerHTML = tall() ? full() : view.name === "detail" && t ? detail(t) : view.name === "book" && t ? book(t) : view.name === "say" && t ? say(t) : list();
  }

  function post(id, kind, body) {
    if (!D.token) { toast("This is a demo card"); return Promise.resolve(false); }
    return fetch("/api/" + D.token + "/todo/" + id + "/" + kind, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  app.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act]");
    if (!el) return;
    var act = el.getAttribute("data-act"), id = el.getAttribute("data-id"), t = id && byId(id);
    if (act === "list") view = { name: "list" };
    else if (act === "open") view = { name: "detail", id: id };
    else if (act === "book") view = { name: "book", id: id };
    else if (act === "say") view = { name: "say", id: id };
    else if (act === "save") {
      var at = document.getElementById("at").value;
      if (!at) return toast("Pick a day and time");
      el.textContent = "Saving…";
      post(id, "booked", { at: at }).then(function (ok) {
        if (!ok) { el.textContent = "Save — I booked it"; return toast("Couldn't save — text me the day and time instead"); }
        t.status = "booked"; t.whenShort = at.replace("T", " "); view = { name: "list" }; render(); toast("Booked ✓ Check your messages");
      });
      return;
    } else if (act === "done") {
      post(id, "done").then(function (ok) {
        if (!ok) return toast("Couldn't save — text me instead");
        t.status = "done"; view = { name: "list" }; render(); toast("Nice work ✓");
      });
      return;
    }
    render();
  });

  var h = location.hash.match(/^#(detail|book|say)=([\w-]+)/); // deep link, e.g. #detail=todo_123 (also used for previews)
  if (h) view = { name: h[1], id: h[2] };
  window.addEventListener("resize", render);
  render();
  if (D.beaconTag) new Image().src = "/beacon?w=" + innerWidth + "&h=" + innerHeight + "&dpr=" + devicePixelRatio + "&view=" + (tall() ? "full" : "compact") + "&v=" + encodeURIComponent(D.beaconTag);
})();
`;
