// Phase 1 prototype of the live tracker card (`/cardlive`), on mock data.
import { Hono } from "hono";
import { toLocalIso } from "../clock.ts";
import { log } from "../log.ts";
import { trackerPage, type CardTodo } from "./tracker.ts";

function mockTodos(state: number): CardTodo[] {
  const base = { helper: null, notes: null, when: null, whenShort: null };
  return [
    {
      ...base,
      id: "demo-lab",
      title: "Fasting blood test",
      status: state >= 2 ? "booked" : "todo",
      due: "by Oct 15",
      when: state >= 2 ? "Thu, Oct 15 · 9:00 AM" : null,
      whenShort: state >= 2 ? "Thu 9:00 AM" : null,
      helper: state >= 2 ? "Tvisha" : null,
      clinic: "Peachtree Labs",
      phone: "(404) 555-0178",
      why: "Checks your potassium and cholesterol after your new medicines.",
      script: "Hi, I'm calling to schedule a fasting blood test — a BMP and lipid panel — ordered by Dr. Brooks after my hospital stay.",
      prep: "Nothing to eat or drink except water for 10–12 hours before.",
    },
    { ...base, id: "demo-pcp", title: "See your family doctor", status: "todo", due: "by Oct 15", clinic: "Midtown Family Medicine · Dr. Chen", phone: "(404) 555-0115", why: "A check-in after your hospital stay.", script: "Hi, I was discharged from Peachtree Regional on October 8 and need a follow-up visit within 7 days.", prep: null },
    { ...base, id: "demo-heart", title: "See a heart doctor", status: "todo", due: "by Oct 22", clinic: "Peachtree Heart Associates · Dr. Okafor", phone: "(404) 555-0142", why: "Follow-up for your new AFib diagnosis.", script: "Hi, I'm calling to schedule a follow-up with Dr. Okafor. I was just diagnosed with AFib at Peachtree Regional.", prep: "Bring your medication list." },
    { ...base, id: "demo-rx", title: "Pick up new medicines", status: "done", due: "Oct 9", clinic: "CVS · Ponce de Leon Ave", phone: "(404) 555-0163", why: "Your new prescriptions were sent electronically.", script: null, prep: null },
  ];
}

export const demo = new Hono();

demo.get("/beacon", (c) => {
  log("📐", `card viewport ${c.req.query("w")}×${c.req.query("h")}pt @${c.req.query("dpr")}x · ${c.req.query("view")} view · v=${c.req.query("v")}`);
  return c.body(null, 204);
});

demo.get("/c/demo", (c) => {
  const state = Number(c.req.query("state") ?? "1");
  const v = c.req.query("v") ?? "1";
  log("📱", `demo card opened (state=${state}, v=${v})`);
  return c.html(trackerPage(mockTodos(state), { subtitle: "From your Oct 8 hospital visit", token: null, nowLocal: toLocalIso(Date.now()), defaultLocal: toLocalIso(Date.now() + 86_400_000), beaconTag: v }));
});

// ---- tap test: do touches reach the page inside the bubble? ----------------

demo.get("/probe", (c) => {
  log("🧪", `probe ${JSON.stringify(c.req.query())}`);
  return c.body(null, 204);
});

demo.get("/c/probe", (c) => {
  const step = c.req.query("step") ?? "1";
  log("📱", `probe card opened (step ${step}, ${c.req.header("user-agent")?.slice(-40)})`);
  return c.html(`<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin:0; padding:12px; font:15px -apple-system, sans-serif; background:#211C17; color:#F6EFE6; }
    h1 { font-size:18px; margin:0 0 8px; }
    .b { display:block; width:100%; box-sizing:border-box; margin:6px 0; padding:12px; border:0; border-radius:12px;
         font:600 15px -apple-system, sans-serif; text-align:center; text-decoration:none; color:#2B2B2B; background:#F5B83D; }
    .ok { background:#27AE60; color:#fff; }
    p { font-size:12px; color:#D2B88E; margin:6px 0 0; }
  </style></head><body>
  ${step === "2"
    ? `<h1>✅ Links work inside the bubble</h1><a class="b" href="/c/probe?step=1">← Back</a>`
    : `<h1>Tap test</h1>
       <button class="b" id="js">① Tap this button</button>
       <a class="b" href="/c/probe?step=2" onclick="ping('link')">② Tap: open page 2</a>
       <a class="b" href="tel:+14045550142" onclick="ping('tel')">③ Tap: call (404) 555-0142</a>`}
  <p id="env"></p>
  <script>
    function ping(what, extra) { new Image().src = "/probe?step=${step}&what=" + what + (extra ? "&" + extra : "") + "&t=" + Date.now(); }
    var n = 0, b = document.getElementById("js");
    if (b) b.onclick = function () { n++; b.textContent = "Tapped ✓ ×" + n; b.className = "b ok"; ping("button", "n=" + n); };
    document.addEventListener("touchstart", function () { ping("touch"); }, { once: true });
    try {
      var f = document.createElement("iframe"); f.style.display = "none"; document.body.appendChild(f);
      var base = new Set(Object.getOwnPropertyNames(f.contentWindow));
      var extra = Object.getOwnPropertyNames(window).filter(function (k) { return !base.has(k) && !/^(ping|n|b|f|base|extra|mh)$/.test(k); }).slice(0, 30);
      var mh = window.webkit && window.webkit.messageHandlers ? Object.getOwnPropertyNames(window.webkit.messageHandlers).join(",") || "(present)" : "none";
      ping("load", "size=" + innerWidth + "x" + innerHeight + "&handlers=" + encodeURIComponent(mh) + "&globals=" + encodeURIComponent(extra.join(",")));
    } catch (e) { ping("load", "err=" + encodeURIComponent(e.message)); }
  </script></body></html>`);
});
