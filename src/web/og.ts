// Link-preview images (og:image, 1200×630) drawn on the server, so links Juno
// sends show a designed card in the chat instead of a plain gray link.
import { svgToJpeg } from "../cards/render.ts";
import type { Grouped } from "../labs.ts";
import { bandsOf, figureSvg, LITERAL } from "./bodymap.ts";

const FONT = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const frame = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#141726"/><stop offset="1" stop-color="#271c42"/></linearGradient>
    <radialGradient id="g1" cx="0.15" cy="0.15" r="0.7"><stop offset="0" stop-color="#5B6CFF" stop-opacity=".32"/><stop offset="1" stop-color="#5B6CFF" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="0.95" cy="1" r="0.6"><stop offset="0" stop-color="#C084FC" stop-opacity=".22"/><stop offset="1" stop-color="#C084FC" stop-opacity="0"/></radialGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8E9BFF"/><stop offset="1" stop-color="#C084FC"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#g1)"/><rect width="1200" height="630" fill="url(#g2)"/>
  ${body}
</svg>`;

const pill = (x: number, y: number, label: string) =>
  `<rect x="${x}" y="${y}" width="${label.length * 15 + 60}" height="58" rx="29" fill="url(#brand)"/>
   <text x="${x + 30}" y="${y + 38}" font-size="26" font-weight="700" fill="#fff" ${FONT}>${esc(label)}</text>`;

export function labsOg(g: Grouped, meta: { collected: string | null; doctor: string | null }): Uint8Array<ArrayBuffer> {
  const counts = { normal: 0, borderline: 0, out: 0 };
  for (const list of Object.values(g)) for (const { band } of list) counts[band]++;
  const rows = [
    [counts.normal, "in range", LITERAL.band.normal],
    [counts.borderline, "slightly outside", LITERAL.band.borderline],
    [counts.out, "outside the range", LITERAL.band.out],
  ].filter(([n]) => (n as number) > 0) as [number, string, string][];
  const sub = [meta.collected && `Collected ${meta.collected}`, meta.doctor].filter(Boolean).join(" · ");
  return svgToJpeg(
    frame(`
    ${figureSvg(bandsOf(g), { css: false, labels: true, attrs: 'x="40" y="30" width="420" height="570"' })}
    <text x="520" y="118" font-size="30" font-weight="800" fill="url(#brand)" ${FONT}>Juno</text>
    <text x="520" y="196" font-size="66" font-weight="800" fill="#F4F5F8" ${FONT}>Your lab results</text>
    <text x="522" y="244" font-size="27" fill="#9097A6" ${FONT}>${esc(clip(sub, 52))}</text>
    ${rows
      .map(
        ([n, label, color], i) => `<circle cx="538" cy="${312 + i * 62}" r="13" fill="${color}"/>
      <text x="566" y="${324 + i * 62}" font-size="36" font-weight="700" fill="#F4F5F8" ${FONT}>${n} <tspan font-weight="400" fill="#C3C8D6">${label}</tspan></text>`,
      )
      .join("")}
    ${pill(520, 500, "Tap an organ to explore")}`),
    1200,
    88,
  );
}

type OgStep = { title: string; status: "todo" | "booked" | "done"; date: string };
const STATUS = { todo: ["To do", "#FF7A59"], booked: ["Booked", "#3B82F6"], done: ["Done", "#22C55E"] } as const;

export function planOg(meta: { title: string; subtitle: string; steps: OgStep[] }): Uint8Array<ArrayBuffer> {
  const done = meta.steps.filter((s) => s.status === "done").length;
  const total = meta.steps.length || 1;
  const C = 2 * Math.PI * 118;
  const steps = meta.steps.slice(0, 4);
  return svgToJpeg(
    frame(`
    <text x="70" y="104" font-size="30" font-weight="800" fill="url(#brand)" ${FONT}>Juno</text>
    <text x="70" y="178" font-size="62" font-weight="800" fill="#F4F5F8" ${FONT}>${esc(clip(meta.title, 30))}</text>
    <text x="72" y="224" font-size="26" fill="#9097A6" ${FONT}>${esc(clip(meta.subtitle, 70))}</text>
    <g transform="translate(220 418)">
      <circle r="118" fill="none" stroke="#2A2D36" stroke-width="30"/>
      <circle r="118" fill="none" stroke="url(#brand)" stroke-width="30" stroke-linecap="round" stroke-dasharray="${((done / total) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90)"/>
      <text y="14" text-anchor="middle" font-size="64" font-weight="800" fill="#F4F5F8" ${FONT}>${done}/${meta.steps.length}</text>
      <text y="54" text-anchor="middle" font-size="24" fill="#9097A6" ${FONT}>steps done</text>
    </g>
    ${steps
      .map((s, i) => {
        const [label, color] = STATUS[s.status];
        const y = 288 + i * 78;
        return `<rect x="440" y="${y}" width="700" height="64" rx="18" fill="#FFFFFF" fill-opacity=".06"/>
        <rect x="458" y="${y + 17}" width="${label.length * 13 + 30}" height="30" rx="15" fill="${color}"/>
        <text x="${458 + 15}" y="${y + 39}" font-size="18" font-weight="800" fill="#fff" ${FONT}>${label}</text>
        <text x="${458 + label.length * 13 + 48}" y="${y + 41}" font-size="27" font-weight="700" fill="#F4F5F8" ${FONT}>${esc(clip(s.title, 26))}</text>
        <text x="1120" y="${y + 41}" text-anchor="end" font-size="22" fill="#9097A6" ${FONT}>${esc(s.date)}</text>`;
      })
      .join("")}`),
    1200,
    88,
  );
}
