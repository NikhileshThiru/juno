// `bun scripts/try-doc.ts docs/discharge-p1.png docs/discharge-p2.png`
// Runs the same OpenCV → classify → extract pipeline as a photo burst, offline.
import { classify, extractAppointment, extractDischarge, extractLabs } from "../src/gemini.ts";
import { bandOf, group, organOf, worst, type Organ } from "../src/labs.ts";
import { asImage, cleanPhoto } from "../src/vision.ts";

const files = process.argv.slice(2);
const t0 = Date.now();
const cleaned = await Promise.all(files.map((f, i) => cleanPhoto(f, f.endsWith(".png") ? "image/png" : "image/jpeg", `data/try/${i}`)));
const images = await Promise.all(cleaned.map((c) => asImage(c.clean)));
const { kind, confidence } = await classify(images);
console.log(`classified: ${kind} (${confidence})`);

if (kind === "discharge") {
  const d = await extractDischarge(images);
  console.log(JSON.stringify(d, null, 2));
  console.log(`\n→ ${d.todos.length} todos, ${d.warning_signs.length} warning signs, ${d.medications.length} meds`);
} else if (kind === "lab") {
  const labs = await extractLabs(images);
  for (const t of labs.tests) console.log(`${t.name.padEnd(26)} ${String(t.value).padEnd(6)} ${(t.ref_text ?? "").padEnd(12)} ${organOf(t.name).padEnd(9)} ${bandOf(t)}`);
  const g = group(labs.tests);
  console.log("\norgans:", Object.fromEntries((Object.keys(g) as Organ[]).map((o) => [o, worst(g[o].map((x) => x.band))])));
} else if (kind === "appointment") {
  console.log(await extractAppointment(images));
}
console.log(`\n⏱️ ${((Date.now() - t0) / 1000).toFixed(1)}s`);
