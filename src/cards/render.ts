import { Resvg } from "@resvg/resvg-js";
import jpeg from "jpeg-js";

const rasterize = (svg: string, width: number) =>
  new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true, defaultFontFamily: "Helvetica Neue" },
  }).render();

export function svgToPng(svg: string, width: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(rasterize(svg, width).asPng());
}

/** App-card `layout.image` must be JPEG (Photon rejects PNG upstream). */
export function svgToJpeg(svg: string, width: number, quality = 90): Uint8Array<ArrayBuffer> {
  const img = rasterize(svg, width);
  const { data } = jpeg.encode({ data: Buffer.from(img.pixels), width: img.width, height: img.height }, quality);
  return new Uint8Array(data);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Phase 1 test image: a mock tracker so we can judge size/legibility in the bubble. */
export function testCardJpeg(label: string): Uint8Array<ArrayBuffer> {
  const rows = [
    ["To do", "#F2994A", "See a heart doctor", "by Oct 22"],
    ["Booked", "#2D9CDB", "Fasting blood test", "Thu 9:00 AM"],
    ["Done", "#27AE60", "Pick up new medicines", "Oct 9"],
  ] as const;
  const rowSvg = rows
    .map(
      ([chip, color, title, due], i) => `
      <g transform="translate(40, ${150 + i * 110})">
        <rect width="820" height="90" rx="22" fill="#FFFFFF"/>
        <rect x="20" y="25" width="120" height="40" rx="20" fill="${color}"/>
        <text x="80" y="53" font-size="22" font-weight="700" fill="#fff" text-anchor="middle">${chip}</text>
        <text x="165" y="55" font-size="30" font-weight="600" fill="#2B2B2B">${esc(title)}</text>
        <text x="800" y="55" font-size="24" fill="#8A8A8A" text-anchor="end">${esc(due)}</text>
      </g>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520">
    <rect width="900" height="520" fill="#FFF6E9"/>
    <text x="40" y="80" font-size="44" font-weight="800" fill="#2B2B2B">Your next steps</text>
    <text x="40" y="120" font-size="24" fill="#8A6D3B">${esc(label)}</text>
    <path transform="translate(800,38) scale(2.2)" d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4 6.2 4c2.2 0 3.8 1.3 4.8 2.9C12 5.3 13.6 4 15.8 4c3.9 0 5.8 4.4 4.2 7.7C19.5 16.4 12 21 12 21z" fill="#F5B83D"/>
    ${rowSvg}
  </svg>`;
  return svgToJpeg(svg, 900);
}

/** Soft full-screen gradient for the chat-background test (iPhone portrait). */
export function testBackgroundPng(): Uint8Array<ArrayBuffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="2532">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFF4E3"/><stop offset="1" stop-color="#FCE3D3"/>
    </linearGradient></defs>
    <rect width="1170" height="2532" fill="url(#g)"/>
  </svg>`;
  return svgToPng(svg, 1170);
}
