// Lab results: an interactive body map. In the bubble: figure + tappable organ
// list → organ view with range bars → "Full view". Full page (Safari or a tall
// view): labeled figure whose organs light up in turn, a results ring, every
// test on an animated range bar, and printable questions for the doctor.
// Colors come from code (labs.ts), never the LLM.
import { html, raw } from "hono/html";
import { ORGANS, worst, type Band, type Grouped, type Organ } from "../labs.ts";
import { theme } from "./theme.ts";
import { json } from "./tracker.ts";

const ORDER: Organ[] = ["heart", "kidneys", "pancreas", "liver", "thyroid", "blood"];

// Right half of a stylized figure as cubic segments [start, c1, c2, end];
// the left half is the mirror image (x → 200 − x), traversed in reverse.
type Pt = [number, number];
type Seg = [Pt, Pt, Pt, Pt];
const RIGHT: Seg[] = [
  [[108, 66], [108, 74], [109, 80], [112, 84]],
  [[112, 84], [124, 86], [140, 88], [147, 99]],
  [[147, 99], [154, 110], [157, 138], [159, 168]],
  [[159, 168], [161, 196], [165, 224], [167, 247]],
  [[167, 247], [169, 262], [161, 268], [157, 258]],
  [[157, 258], [153, 238], [150, 206], [148, 182]],
  [[148, 182], [146, 160], [143, 142], [139, 131]],
  [[139, 131], [138, 160], [137, 192], [139, 222]],
  [[139, 222], [141, 262], [137, 330], [131, 391]],
  [[131, 391], [131, 401], [113, 404], [109, 397]],
  [[109, 397], [108, 350], [106, 292], [102, 247]],
];

function figurePath(): string {
  const p = (pt: Pt) => `${pt[0]} ${pt[1]}`;
  const m = (pt: Pt): Pt => [200 - pt[0], pt[1]];
  const right = RIGHT.map(([, c1, c2, e]) => `C ${p(c1)} ${p(c2)} ${p(e)}`).join(" ");
  const left = [...RIGHT].reverse().map(([s, c1, c2]) => `C ${p(m(c2))} ${p(m(c1))} ${p(m(s))}`).join(" ");
  return `M ${p(RIGHT[0]![0])} ${right} L 100 242 L ${p(m(RIGHT[RIGHT.length - 1]![3]))} ${left} Z`;
}

const ORGAN_SVG: Record<Organ, string> = {
  thyroid: `<path d="M100 88 q-5 -8 -12 -5 q-5 4 0 9 q6 4 12 0 q6 4 12 0 q5 -5 0 -9 q-7 -3 -12 5z"/>`,
  heart: `<path d="M111 142 c-11 -8 -21 -15 -18 -25 c2 -7 12 -8 17 -2 c5 -7 15 -5 17 2 c3 10 -7 17 -16 25z"/>`,
  liver: `<path d="M67 156 Q72 143 98 146 Q107 148 103 158 Q96 171 74 169 Q63 166 67 156Z"/>`,
  pancreas: `<path d="M93 177 Q111 168 128 173 Q132 178 125 181 Q110 184 95 184 Q88 182 93 177Z"/>`,
  kidneys: `<path d="M86 188 q-10 3 -9 15 q1 12 10 13 q6 -1 4 -8 q-3 -5 1 -10 q3 -6 -6 -10z"/><path d="M114 188 q10 3 9 15 q-1 12 -10 13 q-6 -1 -4 -8 q3 -5 -1 -10 q-3 -6 6 -10z"/>`,
  blood: `<path transform="translate(166,282)" d="M8 0 C8 0 0 10 0 15 a8 8 0 0 0 16 0 C16 10 8 0 8 0Z"/>`,
};

// Label leader lines: [organ point, elbow, text anchor, text-anchor].
const LABELS: Record<Organ, [Pt, Pt, "start" | "end"]> = {
  thyroid: [[113, 86], [150, 74], "start"],
  heart: [[126, 122], [150, 110], "start"],
  pancreas: [[129, 177], [152, 166], "start"],
  blood: [[183, 298], [190, 298], "start"],
  liver: [[67, 156], [40, 148], "end"],
  kidneys: [[77, 204], [40, 214], "end"],
};

export const LITERAL = {
  fig1: "#2C3039", fig2: "#22252D", line: "#3A3F4B", muted: "#9097A6",
  band: { normal: "#22C55E", borderline: "#FF9A4D", out: "#F04E5E", none: "#2A2D36" } as Record<Band | "none", string>,
};

/**
 * The body figure as SVG. `css` uses theme variables (web pages, both color
 * schemes); `literal` uses fixed colors (server-rendered preview images).
 */
export function figureSvg(bands: Record<Organ, Band | null>, opts: { css: boolean; labels: boolean; cls?: string; attrs?: string }) {
  const c = opts.css
    ? { fig1: "var(--fig1)", fig2: "var(--fig2)", line: "var(--figline)", muted: "var(--muted)", band: (b: Band | "none") => `var(--${b})` }
    : { ...LITERAL, band: (b: Band | "none") => LITERAL.band[b] };
  const present = ORDER.filter((o) => bands[o]);
  const organs = present.map((o, i) => {
    const b = bands[o] ?? "none";
    return `<g class="organ ${b}" data-organ="${o}" style="fill:${c.band(b)};--d:${(0.15 + i * 0.12).toFixed(2)}s">
      <g class="glow" filter="url(#blur)">${ORGAN_SVG[o]}</g>${ORGAN_SVG[o]}</g>`;
  });
  const labels = opts.labels
    ? present
        .map((o) => {
          const [from, to, anchor] = LABELS[o];
          const tx = anchor === "start" ? to[0] + 3 : to[0] - 3;
          return `<g class="lbl" data-organ="${o}"><path d="M${from[0]} ${from[1]} L${to[0]} ${to[1]}" stroke="${c.muted}" stroke-width="0.8" fill="none" opacity=".7"/>
            <text x="${tx}" y="${to[1] + 4}" text-anchor="${anchor}" font-size="11" font-weight="600" fill="${c.muted}" font-family="-apple-system, Helvetica Neue, sans-serif">${ORGANS[o].label.replace("Heart & vessels", "Heart").replace("Blood & general", "Blood")}</text></g>`;
        })
        .join("")
    : "";
  const viewBox = opts.labels ? "-28 8 252 400" : "18 8 170 400";
  return `<svg class="${opts.cls ?? ""}" viewBox="${viewBox}" ${opts.attrs ?? ""} xmlns="http://www.w3.org/2000/svg" aria-label="Body map">
    <defs>
      <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
      <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.fig1}"/><stop offset="1" stop-color="${c.fig2}"/></linearGradient>
    </defs>
    <ellipse cx="100" cy="40" rx="22" ry="26" fill="url(#skin)" stroke="${c.line}"/>
    <path d="${figurePath()}" fill="url(#skin)" stroke="${c.line}" stroke-linejoin="round"/>
    ${organs.join("")}${labels}
  </svg>`;
}

export const bandsOf = (g: Grouped) => Object.fromEntries(ORDER.map((o) => [o, worst(g[o].map((x) => x.band))])) as Record<Organ, Band | null>;

export type LabMeta = { collected: string | null; doctor: string | null; token: string; docId: string; fullUrl: string; ogImage: string };

export function labsPage(g: Grouped, meta: LabMeta) {
  const present = ORDER.filter((o) => g[o].length);
  const bands = bandsOf(g);
  const flaggedCount = present.reduce((n, o) => n + g[o].filter((x) => x.band !== "normal").length, 0);
  const data = {
    ...meta,
    organs: present.map((o) => ({
      id: o,
      label: ORGANS[o].label,
      plain: ORGANS[o].plain,
      band: bands[o],
      tests: g[o].map(({ test, band }) => ({
        name: test.name,
        value: test.value,
        valueText: test.value_text,
        unit: test.unit,
        low: test.ref_low,
        high: test.ref_high,
        refText: test.ref_text,
        meaning: test.plain_meaning,
        band,
      })),
    })),
  };
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Your lab results</title>
        <meta property="og:title" content="Your lab results" />
        <meta property="og:description" content="${flaggedCount ? `${flaggedCount} results to ask your doctor about` : "Every result inside its printed range"} · tap an organ to explore" />
        <meta property="og:image" content="${meta.ogImage}" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <script>if (!/[?&]still/.test(location.search)) document.documentElement.classList.add("anim");</script>
        <style>
          ${theme}
          :root { --normal:var(--ok); --borderline:var(--warn); --out:var(--bad); --none:var(--card2);
                  --fig1:#E4E7F0; --fig2:#D3D8E5; --figline:#C7CCDA; }
          @media (prefers-color-scheme: dark) { :root { --fig1:#2C3039; --fig2:#22252D; --figline:#3A3F4B; } }
          body { padding:12px 12px 0; height:100vh; overflow:hidden; }
          body.tall { height:auto; overflow:auto; padding:20px 16px 48px; }
          .organ { cursor:pointer; transform-box:fill-box; transform-origin:center; transition:opacity .25s; }
          .anim .organ { opacity:0; animation:pop .55s cubic-bezier(.2,.9,.3,1.3) forwards; animation-delay:var(--d); }
          .organ .glow { opacity:.55; }
          .anim .organ.out .glow { animation:pulse 1.8s ease-in-out infinite; }
          @keyframes pop { from { opacity:0; transform:scale(.4) } to { opacity:1; transform:none } }
          @keyframes pulse { 0%,100% { opacity:.3 } 50% { opacity:1 } }
          .fig.focus .organ:not(.on), .fig.focus .lbl:not(.on) { opacity:.18 !important; }
          .lbl { cursor:pointer; }
          .anim .lbl { opacity:0; animation:fade .5s ease-out forwards; animation-delay:.9s; }
          @keyframes fade { to { opacity:1 } }
          .mini { display:flex; gap:4px; align-items:flex-start; margin-top:6px; }
          .mini svg { width:84px; flex:none; }
          .olist { flex:1; display:flex; flex-direction:column; gap:4px; }
          .orow { display:flex; align-items:center; gap:7px; padding:7px 9px; background:var(--card); border-radius:10px; font-size:13.5px; font-weight:650; white-space:nowrap; }
          .anim .orow { opacity:0; animation:slide .4s ease-out forwards; animation-delay:var(--d); }
          @keyframes slide { from { opacity:0; transform:translateX(8px) } to { opacity:1; transform:none } }
          .orow .n { margin-left:auto; font-size:11px; font-weight:700; color:var(--muted); }
          .fine { font-size:11.5px; color:var(--muted); margin:2px 2px 0; line-height:1.3; }
          .olist .open { margin-top:6px; }
          i.d { width:9px; height:9px; border-radius:50%; flex:none; display:inline-block; }
          .open { margin-top:8px; }
          .back { font-size:14px; font-weight:650; color:var(--accent); }
          .test { background:var(--card); border-radius:12px; padding:9px 10px; margin-top:6px; }
          .tt { display:flex; justify-content:space-between; gap:8px; font-size:13.5px; font-weight:650; }
          .tt span:last-child { white-space:nowrap; }
          .rb { position:relative; height:8px; margin:9px 2px 3px; border-radius:4px; background:var(--card2); }
          .rb .ok { position:absolute; top:0; bottom:0; left:50%; width:0; border-radius:4px; background:color-mix(in srgb, var(--ok) 45%, transparent); }
          .rb .mk { position:absolute; top:50%; left:0; width:14px; height:14px; margin:-7px 0 0 -7px; border-radius:50%; border:2.5px solid var(--card); box-shadow:0 0 0 1px rgba(0,0,0,.15); }
          .anim .rb .ok { transition:all .7s cubic-bezier(.2,.8,.2,1); }
          .anim .rb .mk { transition:left .9s cubic-bezier(.2,.8,.2,1) .15s; }
          .rl { text-align:center; font-size:10.5px; color:var(--muted); }
          .mean { font-size:12.5px; color:var(--muted); margin-top:5px; line-height:1.35; }
          .more { text-align:center; font-size:11.5px; color:var(--muted); margin-top:5px; }
          .top { display:flex; align-items:center; gap:16px; margin:10px 0 4px; }
          .ring { width:108px; height:108px; flex:none; position:relative; }
          .ring svg { transform:rotate(-90deg); }
          .ring circle { fill:none; stroke-width:12; stroke-linecap:butt; }
          .anim .ring circle { transition:stroke-dasharray 1s cubic-bezier(.2,.8,.2,1); }
          .ring b { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; font-size:26px; line-height:1; }
          .ring b small { font-size:11px; color:var(--muted); font-weight:600; margin-top:3px; }
          .legend { display:flex; flex-direction:column; gap:6px; font-size:14px; font-weight:650; }
          .legend span { display:flex; align-items:center; gap:8px; }
          .hero { display:flex; justify-content:center; margin:6px 0 8px; }
          .hero svg { width:300px; max-width:100%; }
          .sec { background:var(--card); border-radius:18px; padding:14px; margin-bottom:12px; scroll-margin-top:12px; transition:box-shadow .3s; }
          .sec.hit { box-shadow:0 0 0 2px var(--accent); }
          .sec h2 { font-size:18px; display:flex; align-items:center; gap:8px; }
          .sec .plain { font-size:13px; color:var(--muted); margin:2px 0 4px; }
          .sec .test { background:var(--bg); }
          .ask { background:linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, var(--card)), var(--card)); }
          .ask li { list-style:none; display:flex; gap:8px; padding:7px 0; border-top:1px solid var(--line); font-size:14px; }
          .ask li:first-child { border-top:0; }
          .print { margin-top:10px; width:100%; }
          .tall .hdr { margin-left:0; } .tall .hdr h1 { font-size:24px; }
          .note { font-size:12.5px; color:var(--muted); text-align:center; margin-top:10px; line-height:1.4; }
          @media print {
            body * { visibility:hidden; } .ask, .ask * { visibility:visible; }
            .ask { position:absolute; left:0; top:0; width:100%; background:#fff; color:#000; } .print { display:none; }
          }
        </style>
      </head>
      <body>
        <div id="app"></div>
        <template id="fig-mini">${raw(figureSvg(bands, { css: true, labels: false, cls: "fig" }))}</template>
        <template id="fig-big">${raw(figureSvg(bands, { css: true, labels: true, cls: "fig big" }))}</template>
        <div class="toast" id="toast"></div>
        <script>window.L = ${json(data)};</script>
        <script>
          ${raw(LABS_JS)}
        </script>
      </body>
    </html>`;
}

const LABS_JS = String.raw`
(function () {
  var L = window.L, app = document.getElementById("app"), toastEl = document.getElementById("toast");
  var WORD = { normal: "in range", borderline: "slightly outside", out: "outside range" };
  var COLOR = { normal: "var(--ok)", borderline: "var(--warn)", out: "var(--bad)" };
  var SHORT = { heart: "Heart", kidneys: "Kidneys", pancreas: "Blood sugar", liver: "Liver", thyroid: "Thyroid", blood: "Blood" };
  var view = { name: "home" }, inBubble = /Spectrum/.test(navigator.userAgent);
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var tall = function () { return window.innerHeight >= 480; };
  var flagged = function (o) { return o.tests.filter(function (t) { return t.band !== "normal"; }); };
  var allFlagged = function () { return L.organs.reduce(function (a, o) { return a.concat(flagged(o)); }, []); };
  var organ = function (id) { return L.organs.filter(function (o) { return o.id === id; })[0]; };
  var fig = function (big) { return document.getElementById(big ? "fig-big" : "fig-mini").innerHTML; };
  function toast(m) { toastEl.textContent = m; toastEl.className = "toast on"; setTimeout(function () { toastEl.className = "toast"; }, 2600); }

  // Bars render collapsed, then slide to their values once on screen.
  function bar(t) {
    if (t.value == null || (t.low == null && t.high == null)) return "";
    var lo = t.low, hi = t.high, v = t.value, min, max;
    if (lo != null && hi != null) { var s = hi - lo; min = Math.min(lo - s * 0.6, v - s * 0.15); max = Math.max(hi + s * 0.6, v + s * 0.15); }
    else if (hi != null) { min = 0; max = Math.max(hi * 1.6, v * 1.15); }
    else { min = Math.min(lo * 0.4, v * 0.85); max = Math.max(lo * 1.8, v * 1.15); }
    min = Math.max(0, min);
    var pct = function (x) { return Math.max(0, Math.min(100, (x - min) / (max - min) * 100)); };
    var a = pct(lo == null ? min : lo), b = pct(hi == null ? max : hi);
    return '<div class="rb"><div class="ok" data-l="' + a + '" data-w="' + (b - a) + '"></div><div class="mk" data-v="' + pct(v) + '" style="background:' + COLOR[t.band] + '"></div></div>' +
      '<div class="rl">normal range ' + esc(t.refText || "") + "</div>";
  }
  function animateBars() {
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      [].forEach.call(document.querySelectorAll(".rb .ok"), function (e) { e.style.left = e.getAttribute("data-l") + "%"; e.style.width = e.getAttribute("data-w") + "%"; });
      [].forEach.call(document.querySelectorAll(".rb .mk"), function (e) { e.style.left = e.getAttribute("data-v") + "%"; });
      [].forEach.call(document.querySelectorAll(".ring circle[data-len]"), function (e) { e.style.strokeDasharray = e.getAttribute("data-len") + " 999"; });
      var still = !document.documentElement.classList.contains("anim");
      [].forEach.call(document.querySelectorAll("[data-count]"), function (e) {
        var n = +e.getAttribute("data-count"), t0 = performance.now();
        if (still) { e.textContent = n; return; }
        (function step(t) { var k = Math.min(1, (t - t0) / 700); e.textContent = Math.round(n * k); if (k < 1) requestAnimationFrame(step); })(t0);
      });
    }); });
  }

  function test(t, withMeaning) {
    return '<div class="test"><div class="tt"><span>' + esc(t.name) + '</span><span style="color:' + COLOR[t.band] + '">' + esc(t.valueText) + (t.unit ? " " + esc(t.unit) : "") + "</span></div>" +
      bar(t) + (withMeaning ? '<p class="mean">' + esc(t.meaning) + " · <b>" + WORD[t.band] + "</b></p>" : "") + "</div>";
  }

  function home() {
    var n = allFlagged().length;
    var flaggedOrgans = L.organs.filter(function (o) { return flagged(o).length; }).slice(0, 4);
    var fine = L.organs.filter(function (o) { return !flagged(o).length; }).map(function (o) { return SHORT[o.id]; });
    return '<div class="hdr"><h1>Lab results</h1><span class="pill">' + (n ? n + " to ask about" : "all in range") + "</span></div>" +
      '<div class="mini">' + fig(false) + '<div class="olist">' + flaggedOrgans.map(function (o, i) {
        return '<button class="orow" style="--d:' + (0.2 + i * 0.08) + 's" data-act="organ" data-id="' + o.id + '"><i class="d" style="background:' + COLOR[o.band] + '"></i>' + esc(SHORT[o.id]) +
          '<span class="n">' + flagged(o).length + " ›</span></button>";
      }).join("") +
      (fine.length ? '<p class="fine">✓ ' + esc(fine.join(", ")) + " in range</p>" : "") +
      '<button class="btn primary open" data-act="full">Full view ↗</button></div></div>';
  }

  function organView(o) {
    var tests = flagged(o).length ? flagged(o) : o.tests, shown = tests.slice(0, 2);
    return '<div class="hdr"><button class="back" data-act="home">‹ Body map</button><span class="pill">' + esc(o.label) + "</span></div>" +
      shown.map(function (t) { return test(t, false); }).join("") +
      (o.tests.length > shown.length ? '<p class="more">+' + (o.tests.length - shown.length) + " more in the full view</p>" : "") +
      '<button class="btn primary open" data-act="full" style="width:100%">Open full view ↗</button>';
  }

  function ring(counts, total) {
    var C = 2 * Math.PI * 46, off = 0, arcs = "";
    ["normal", "borderline", "out"].forEach(function (k) {
      var len = total ? counts[k] / total * C : 0;
      arcs += '<circle r="46" cx="54" cy="54" stroke="' + COLOR[k] + '" data-len="' + Math.max(0, len - 1.5).toFixed(1) + '" style="stroke-dasharray:0 999;stroke-dashoffset:' + (-off).toFixed(1) + '"/>';
      off += len;
    });
    return '<div class="ring"><svg width="108" height="108"><circle r="46" cx="54" cy="54" stroke="var(--card2)"/>' + arcs + '</svg><b><span data-count="' + total + '">0</span><small>tests</small></b></div>';
  }

  function full() {
    var f = allFlagged(), counts = { normal: 0, borderline: 0, out: 0 }, total = 0;
    L.organs.forEach(function (o) { o.tests.forEach(function (t) { counts[t.band]++; total++; }); });
    return '<div class="hdr"><h1>Your lab results</h1></div>' +
      "<p style='color:var(--muted);margin-top:2px'>" + esc([L.collected && "Collected " + L.collected, L.doctor && "ordered by " + L.doctor].filter(Boolean).join(" · ")) + "</p>" +
      '<div class="top">' + ring(counts, total) + '<div class="legend">' +
      '<span><i class="d" style="background:var(--ok)"></i><b data-count="' + counts.normal + '">0</b> in range</span>' +
      (counts.borderline ? '<span><i class="d" style="background:var(--warn)"></i><b data-count="' + counts.borderline + '">0</b> slightly outside</span>' : "") +
      (counts.out ? '<span><i class="d" style="background:var(--bad)"></i><b data-count="' + counts.out + '">0</b> outside</span>' : "") + "</div></div>" +
      '<div class="hero">' + fig(true) + "</div>" +
      (f.length ? '<div class="sec ask"><h2>💬 Questions for ' + esc(L.doctor || "your doctor") + "</h2><ul style='padding:0;margin-top:6px'>" +
        f.map(function (t) { return "<li><span>☐</span><span>What does my <b>" + esc(t.name) + "</b> result mean for me? <span style='color:var(--muted)'>(" + esc(t.valueText) + ", range " + esc(t.refText || "") + ")</span></span></li>"; }).join("") +
        '</ul><button class="btn soft print" data-act="print">🖨 Print these questions</button></div>' : "") +
      L.organs.map(function (o) {
        return '<div class="sec" id="sec-' + o.id + '"><h2><i class="d" style="background:' + COLOR[o.band] + '"></i>' + esc(o.label) + '</h2><p class="plain">' + esc(o.plain) + "</p>" +
          o.tests.map(function (t) { return test(t, true); }).join("") + "</div>";
      }).join("") +
      '<p class="note">Colors compare each result to the range printed on your report. They are not a diagnosis — ' + esc(L.doctor || "your doctor") + " can explain what they mean for you.</p>";
  }

  function render() {
    document.body.className = tall() ? "tall" : "";
    app.innerHTML = tall() ? full() : view.name === "organ" ? organView(organ(view.id)) : home();
    animateBars();
  }

  function openFull() {
    fetch("/api/" + L.token + "/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "labs", doc: L.docId }) }).catch(function () {});
    var w = null;
    try { w = window.open(L.fullUrl, "_blank"); } catch (e) {}
    toast(w ? "Opening…" : "Sending you the full view…");
  }

  // Full view: tapping an organ spotlights it and jumps to its tests.
  function focus(id) {
    var svg = document.querySelector(".fig.big");
    if (svg) {
      svg.classList.add("focus");
      [].forEach.call(svg.querySelectorAll("[data-organ]"), function (e) { e.classList.toggle("on", e.getAttribute("data-organ") === id); });
      setTimeout(function () { svg.classList.remove("focus"); }, 1800);
    }
    var s = document.getElementById("sec-" + id);
    if (s) { s.scrollIntoView({ behavior: "smooth", block: "start" }); s.classList.add("hit"); setTimeout(function () { s.classList.remove("hit"); }, 1600); }
  }

  app.addEventListener("click", function (e) {
    var el = e.target.closest("[data-act],[data-organ]");
    if (!el) return;
    var id = el.getAttribute("data-organ") || el.getAttribute("data-id"), act = el.getAttribute("data-act") || "organ";
    if (act === "full") return openFull();
    if (act === "print") return window.print();
    if (tall()) return focus(id);
    if (act === "home") view = { name: "home" };
    else if (act === "organ" && organ(id)) view = { name: "organ", id: id };
    render();
  });

  var h = location.hash.match(/^#organ=(\w+)/); // deep link, e.g. #organ=kidneys (also used for previews)
  if (h && organ(h[1])) view = { name: "organ", id: h[1] };
  window.addEventListener("resize", function () { if (tall() !== document.body.classList.contains("tall")) render(); });
  render();
  if (!inBubble) fetch("/api/" + L.token + "/opened", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "labs", doc: L.docId }) }).catch(function () {});
})();
`;
