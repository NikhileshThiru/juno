// `bun run doctor` — verifies Phase 0 setup without sending any messages.
import { existsSync, readFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { cloud } from "spectrum-ts";

const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => console.log(`❌ ${m}`);
const warn = (m: string) => console.log(`⚠️  ${m}`);

const { SPECTRUM_PROJECT_ID: id, SPECTRUM_PROJECT_SECRET: secret, GEMINI_API_KEY: gemini } = process.env;

if (!id || !secret) bad("SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET not set in .env");
else {
  try {
    const project = await cloud.getProject(id, secret);
    ok(`Photon project "${project.name}" (${project.slug}) — credentials work`);
    const billing = Bun.spawnSync(["bunx", "photon", "billing", "show", "-p", id]);
    console.log("   " + billing.stdout.toString().trim().replace(/\n/g, "\n   "));
    console.log("   profile:", project.profile);
  } catch (e) {
    bad(`Photon credentials rejected: ${e instanceof Error ? e.message : e}`);
  }
}

const users = Bun.spawnSync(["bunx", "photon", "spectrum", "users", "ls", "--json", ...(id ? ["-p", id] : [])]);
if (users.exitCode === 0) console.log("   registered users:", users.stdout.toString().trim());
else warn(`couldn't list users via CLI (logged in? \`bunx photon login\`): ${users.stderr.toString().trim().slice(0, 200)}`);

if (!gemini) bad("GEMINI_API_KEY not set in .env");
else {
  try {
    const ai = new GoogleGenAI({ apiKey: gemini });
    const flash: string[] = [];
    for await (const m of await ai.models.list()) {
      const name = m.name?.replace(/^models\//, "") ?? "";
      if (/flash/.test(name) && !/tts|image|live|audio|embed|native/.test(name) && m.supportedActions?.includes("generateContent")) flash.push(name);
    }
    ok(`Gemini key works — Flash models: ${flash.join(", ")}`);
    if (process.env.GEMINI_MODEL) ok(`GEMINI_MODEL=${process.env.GEMINI_MODEL}`);
    else warn("GEMINI_MODEL not set — pick the newest stable Flash above");
  } catch (e) {
    bad(`Gemini key rejected: ${e instanceof Error ? e.message : e}`);
  }
}

const base = process.env.PUBLIC_BASE_URL || (existsSync("data/tunnel-url") ? readFileSync("data/tunnel-url", "utf8").trim() : "");
if (!base) warn("no public URL yet — run `bun run tunnel` in its own terminal");
else {
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) ok(`tunnel reaches Juno: ${base}`);
    else bad(`tunnel answered ${r.status} — is Juno running?`);
  } catch (e) {
    bad(`tunnel unreachable (${base}): ${e instanceof Error ? e.message : e}`);
  }
}
