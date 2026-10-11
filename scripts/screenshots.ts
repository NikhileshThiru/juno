// `bun scripts/screenshots.ts` — renders the README images in docs/screenshots/
// from the real pages and the real OpenCV output (fictional demo data). The
// dashboard shot uses whatever is in juno.db, so run a demo first.
import { mkdirSync } from "node:fs";
import type { Discharge } from "../src/gemini.ts";
import { group } from "../src/labs.ts";
import { log } from "../src/log.ts";
import { labsPage } from "../src/web/bodymap.ts";
import { labsOg, planOg } from "../src/web/og.ts";
import { planPage } from "../src/web/plan.ts";
import { web } from "../src/web/server.ts";
import { trackerPage, type CardTodo } from "../src/web/tracker.ts";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = "data/shots";
const OUT = "docs/screenshots";
mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const base = { why: null, notes: null, helper: null, when: null, whenShort: null, prep: null };
const todos: CardTodo[] = [
  { ...base, id: "rx", title: "Pick up new prescriptions", status: "done", due: "Done", clinic: "CVS Pharmacy", phone: "(404) 555-0163", script: null },
  {
    ...base, id: "lab", title: "Fasting blood test", status: "booked", due: "by Oct 15", when: "Thu, Oct 15 · 9:00 AM", whenShort: "Thu 9:00 AM",
    helper: "Tvisha", clinic: "Peachtree Labs", phone: "(404) 555-0178", script: null, prep: "Nothing to eat or drink except water for 10–12 hours before.",
    why: "To recheck your potassium and kidney function on the new medicines.",
  },
  {
    ...base, id: "pcp", title: "See primary care doctor", status: "todo", due: "by Oct 15", clinic: "Midtown Family Medicine · Linda Chen, MD", phone: "(404) 555-0115",
    why: "To review your hospital stay and your new medicines.",
    script: "Hi, this is Anjali Talwar. I was discharged from Peachtree Regional on October 8 and need a follow-up visit within 7 days.",
    notes: "Ask about: potassium, creatinine, eGFR, LDL",
  },
  {
    ...base, id: "heart", title: "See a heart doctor", status: "todo", due: "by Oct 22", clinic: "Peachtree Heart Associates · Raymond Okafor, MD", phone: "(404) 555-0142",
    why: "For your new AFib diagnosis and blood thinner.",
    script: "Hi, this is Anjali Talwar. I need a follow-up with Dr. Okafor within 2 weeks of my hospital stay for my new AFib.", prep: "Bring your medication list to this visit.",
  },
];

const labs = JSON.parse(await Bun.file("docs/fixtures/labs.json").text()); // Gemini output for docs/labs.png
const discharge = JSON.parse(await Bun.file("docs/fixtures/discharge.json").text()) as Discharge; // Gemini output for the discharge photos

await Bun.write(`${SHOTS}/tracker.html`, String(await trackerPage(todos, { subtitle: "From your Oct 8 hospital visit", token: null, nowLocal: "2026-10-12T18:00", defaultLocal: "2026-10-13T09:00" })));
await Bun.write(`${SHOTS}/labs.html`, String(await labsPage(group(labs.tests), { collected: "Oct 15, 2026", doctor: labs.ordering_provider, token: "demo", docId: "demo", fullUrl: "#", ogImage: "" })));
const order = { booked: 0, todo: 1, done: 2 } as const;
await Bun.write(
  `${SHOTS}/plan.html`,
  String(
    await planPage({
      title: "Anjali's care plan",
      subtitle: "From her Oct 8 hospital visit · Peachtree Regional Medical Center",
      reason: discharge.reason_plain,
      warnings: discharge.warning_signs,
      meds: discharge.medications.map((m) => ({ name: m.name, dose: m.dose, how: m.how_to_take_plain, status: m.status })),
      steps: [...todos].sort((a, b) => order[a.status] - order[b.status]).map((t) => ({ ...t, date: t.status === "booked" ? t.when! : t.due!, ics: t.status === "booked" ? "#" : null })),
      circle: [{ name: "Tvisha", share: "everything" }],
      family: true,
      token: "demo",
      ogImage: "",
      ogDescription: "",
    }),
  ),
);

// Link previews exactly as iMessage shows them (og:image).
await Bun.write(`${SHOTS}/og-labs.jpg`, labsOg(group(labs.tests), { collected: "Oct 15, 2026", doctor: labs.ordering_provider }));
await Bun.write(
  `${SHOTS}/og-plan.jpg`,
  planOg({
    title: "Anjali's care plan",
    subtitle: "From her Oct 8 hospital visit · Peachtree Regional Medical Center",
    steps: todos.map((t) => ({ title: t.title, status: t.status, date: t.status === "booked" ? t.whenShort! : t.due! })),
  }),
);

// Real OpenCV output for the first demo photo.
await Bun.spawn([".venv/bin/python", "cv/flatten.py", "docs/photos/1-discharge-page1.jpg", `${SHOTS}/cv`]).exited;

// The live dashboard needs a server: serve the web app locally with a few feed events.
const server = Bun.serve({ port: 3101, fetch: web.fetch });
for (const [e, m] of [
  ["📷", "received 2 photos → doc_x"], ["🧼", "OpenCV: page found (54% of photo), flattened"], ["🗂️", "classified as discharge"],
  ["🤖", "discharge: 4 todos, 6 warning signs, 5 meds"], ["💳", "tracker card sent (v1)"], ["🔔", "nudge 1 → Anjali: Fasting blood test"],
  ["🔔", "nudge 2 → Anjali: Fasting blood test"], ["🚨", "escalated Fasting blood test to Tvisha (both nudges read)"],
] as const)
  log(e, m);

const page = (body: string, bg = "linear-gradient(135deg,#171923,#251c36)") => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:${bg}; font:600 14px -apple-system, sans-serif; color:#E8E9F0; }
  .grid { display:grid; gap:26px 22px; padding:30px; }
  figure { margin:0; } figcaption { margin-top:9px; text-align:center; color:#A9ADC0; font-weight:600; }
  iframe { display:block; border:0; border-radius:18px; box-shadow:0 10px 30px rgba(0,0,0,.35); }
  img { display:block; width:100%; height:400px; object-fit:cover; border-radius:12px; }
</style></head><body>${body}</body></html>`;

const bubble = (src: string, caption: string) => `<figure><iframe src="${src}" style="width:271px;height:300px"></iframe><figcaption>${caption}</figcaption></figure>`;

const shots: [string, string, number, number, string?][] = [
  [
    "cards",
    page(`<div class="grid" style="grid-template-columns:repeat(3,271px)">
      ${bubble("tracker.html?still", "Checklist card in the chat")}
      ${bubble("tracker.html?still#detail=heart", "Tap a step: call, book, or done")}
      ${bubble("tracker.html?still#book=heart", "“I booked it” → calendar invite")}
      ${bubble("labs.html?still", "Lab results as a body map")}
      ${bubble("labs.html?still#organ=kidneys", "Tap an organ: values vs. range")}
      ${bubble("tracker.html?still#say=heart", "What to say when you call")}
    </div>`),
    919,
    780,
  ],
  [
    "cv-pipeline",
    page(`<div class="grid" style="grid-template-columns:repeat(3,300px)">
      <figure><img src="../../docs/photos/1-discharge-page1.jpg"><figcaption>① Photo Mom sends in iMessage</figcaption></figure>
      <figure><img src="cv/debug_contour.jpg"><figcaption>② OpenCV finds the page</figcaption></figure>
      <figure><img src="cv/clean.jpg" style="background:#fff"><figcaption>③ Flattened + enhanced → Gemini</figcaption></figure>
    </div>`),
    1004,
    500,
    "jpg",
  ],
  [
    "full-pages",
    page(`<div class="grid" style="grid-template-columns:390px 390px">
      <figure><iframe src="plan.html?still" style="width:390px;height:1180px"></iframe><figcaption>Care plan (opens from the checklist; sent to family)</figcaption></figure>
      <figure><iframe src="labs.html?still" style="width:390px;height:1180px;background:#131418"></iframe><figcaption>Full lab results (opens from the body map)</figcaption></figure>
    </div>`),
    866,
    1270,
  ],
  [
    "link-previews",
    page(`<div class="grid" style="grid-template-columns:520px 520px">
      <figure><img src="og-plan.jpg" style="height:auto"><figcaption>Care plan link, as it appears in iMessage</figcaption></figure>
      <figure><img src="og-labs.jpg" style="height:auto"><figcaption>Lab results link, as it appears in iMessage</figcaption></figure>
    </div>`),
    1126,
    400,
    "jpg",
  ],
  ["brain", "", 1440, 900],
];

for (const [name, html, w, h, fmt] of shots) {
  const png = `${SHOTS}/${name}.png`;
  const url = name === "brain" ? "http://localhost:3101/brain?still" : `file://${process.cwd()}/${SHOTS}/${name}-compose.html`;
  if (html) await Bun.write(`${SHOTS}/${name}-compose.html`, html);
  await Bun.spawn(
    [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", `--force-device-scale-factor=${name === "brain" ? 1.5 : 2}`, `--window-size=${w},${h}`,
      "--allow-file-access-from-files", "--virtual-time-budget=4000", `--screenshot=${png}`, url],
    { stdout: "ignore", stderr: "ignore" },
  ).exited;
  // Photos compress far better as JPEG; UI shots stay PNG for crisp text.
  const out = fmt === "jpg" || name === "brain" ? `${OUT}/${name}.jpg` : `${OUT}/${name}.png`;
  if (out.endsWith(".jpg")) await Bun.spawn(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "84", png, "--out", out], { stdout: "ignore" }).exited;
  else await Bun.write(out, Bun.file(png));
  console.log(`wrote ${out}`);
}
server.stop(true);
process.exit(0);
