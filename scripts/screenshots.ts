// `bun scripts/screenshots.ts` — renders the README images in docs/screenshots/
// from the real card pages and the real OpenCV output (fictional demo data).
import { mkdirSync } from "node:fs";
import { group } from "../src/labs.ts";
import { labsPage } from "../src/web/bodymap.ts";
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
  },
  {
    ...base, id: "pcp", title: "See primary care doctor", status: "todo", due: "by Oct 15", clinic: "Midtown Family Medicine · Linda Chen, MD", phone: "(404) 555-0115",
    why: "To review your hospital stay and your new medicines.",
    script: "Hi, this is Anjali Talwar. I was discharged from Peachtree Regional on October 8 and need a follow-up visit within 7 days.",
    notes: "Ask about: potassium, creatinine, eGFR, LDL",
  },
  {
    ...base, id: "heart", title: "See a heart doctor", status: "todo", due: "by Oct 22", clinic: "Peachtree Heart Associates · Raymond Okafor, MD", phone: "(404) 555-0142",
    script: "Hi, this is Anjali Talwar. I need a follow-up with Dr. Okafor within 2 weeks of my hospital stay for my new AFib.", prep: "Bring your medication list to this visit.",
  },
];

await Bun.write(`${SHOTS}/tracker.html`, String(await trackerPage(todos, { subtitle: "From your Oct 8 hospital visit", token: null, nowLocal: "2026-10-12T18:00", defaultLocal: "2026-10-13T09:00" })));
const labs = JSON.parse(await Bun.file("docs/fixtures/labs.json").text()); // Gemini output for docs/labs.png
await Bun.write(`${SHOTS}/labs.html`, String(await labsPage(group(labs.tests), { collected: "Oct 15, 2026", doctor: labs.ordering_provider, token: "demo", docId: "demo", fullUrl: "#", ogImage: "" })));

// Real OpenCV output for the first demo photo.
await Bun.spawn([".venv/bin/python", "cv/flatten.py", "docs/photos/1-discharge-page1.jpg", `${SHOTS}/cv`]).exited;

const page = (body: string, bg = "linear-gradient(135deg,#171923,#251c36)") => `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:${bg}; font:600 14px -apple-system, sans-serif; color:#E8E9F0; }
  .grid { display:grid; gap:26px 22px; padding:30px; }
  figure { margin:0; } figcaption { margin-top:9px; text-align:center; color:#A9ADC0; font-weight:600; }
  iframe { display:block; border:0; border-radius:18px; box-shadow:0 10px 30px rgba(0,0,0,.35); }
  img { display:block; width:100%; height:400px; object-fit:cover; border-radius:12px; }
</style></head><body>${body}</body></html>`;

const bubble = (src: string, caption: string) => `<figure><iframe src="${src}" style="width:271px;height:300px"></iframe><figcaption>${caption}</figcaption></figure>`;

const shots: [string, string, number, number][] = [
  [
    "cards",
    page(`<div class="grid" style="grid-template-columns:repeat(3,271px)">
      ${bubble("tracker.html", "Checklist card in the chat")}
      ${bubble("tracker.html#detail=heart", "Tap a step: call, book, or done")}
      ${bubble("tracker.html#book=heart", "“I booked it” → calendar invite")}
      ${bubble("labs.html", "Lab results as a body map")}
      ${bubble("labs.html#organ=kidneys", "Tap an organ: values vs. range")}
      ${bubble("tracker.html#say=heart", "What to say when you call")}
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
  ],
  [
    "labs-full",
    page(`<div class="grid" style="grid-template-columns:390px"><figure><iframe src="labs.html" style="width:390px;height:1060px"></iframe></figure></div>`),
    450,
    1120,
  ],
];

for (const [name, html, w, h] of shots) {
  await Bun.write(`${SHOTS}/${name}-compose.html`, html);
  const png = `${SHOTS}/${name}.png`;
  await Bun.spawn(
    [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", `--window-size=${w},${h}`,
      "--allow-file-access-from-files", "--virtual-time-budget=3000", `--screenshot=${png}`, `file://${process.cwd()}/${SHOTS}/${name}-compose.html`],
    { stdout: "ignore", stderr: "ignore" },
  ).exited;
  // Photos compress far better as JPEG; UI shots stay PNG for crisp text.
  const out = name === "cv-pipeline" ? `${OUT}/${name}.jpg` : `${OUT}/${name}.png`;
  if (out.endsWith(".jpg")) await Bun.spawn(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", png, "--out", out], { stdout: "ignore" }).exited;
  else await Bun.write(out, Bun.file(png));
  console.log(`wrote ${out}`);
}
