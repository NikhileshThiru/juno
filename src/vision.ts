// Runs cv/flatten.py on each photo. Never blocks the flow: any failure falls
// back to the raw image so Gemini still gets something to read.
import { mkdirSync } from "node:fs";
import type { Image } from "./gemini.ts";
import { log } from "./log.ts";

const PY = ".venv/bin/python";

export type Cleaned = { raw: string; clean: string; foundPage: boolean; dir: string };

async function toJpeg(path: string, mimeType: string): Promise<string> {
  if (/jpe?g/i.test(mimeType)) return path;
  const out = path.replace(/\.[^.]+$/, "") + ".jpg";
  const p = Bun.spawn(["sips", "-s", "format", "jpeg", path, "--out", out], { stdout: "ignore", stderr: "ignore" });
  return (await p.exited) === 0 ? out : path;
}

export async function cleanPhoto(rawPath: string, mimeType: string, dir: string): Promise<Cleaned> {
  mkdirSync(dir, { recursive: true });
  const jpg = await toJpeg(rawPath, mimeType); // iPhone photos often arrive as HEIC
  try {
    const p = Bun.spawn([PY, "cv/flatten.py", jpg, dir], { stdout: "pipe", stderr: "pipe" });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    const res = JSON.parse(out.trim().split("\n").pop() ?? "{}");
    if (code !== 0 || !res.ok) throw new Error(res.error ?? `exit ${code}`);
    log("🧼", `OpenCV: ${res.found_page ? `page found (${Math.round(res.page_fraction * 100)}% of photo), flattened` : "no page edge, contrast only"}`);
    return { raw: jpg, clean: res.clean, foundPage: !!res.found_page, dir };
  } catch (err) {
    log("⚠️", `OpenCV failed, using raw photo: ${err instanceof Error ? err.message : err}`);
    return { raw: jpg, clean: jpg, foundPage: false, dir };
  }
}

export async function asImage(path: string): Promise<Image> {
  return { mimeType: "image/jpeg", data: Buffer.from(await Bun.file(path).arrayBuffer()) };
}
