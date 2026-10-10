import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const schema = z.object({
  SPECTRUM_PROJECT_ID: z.string().min(1, "missing — run `bunx photon projects ls`"),
  SPECTRUM_PROJECT_SECRET: z.string().min(1, "missing — run `bunx photon projects secret`"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default(""),
  PUBLIC_BASE_URL: z.string().default(""),
  ADMIN_NUMBERS: z.string().default("").transform(list),
  MOM_NUMBER: z.string().default(""),
  CAREGIVER_NUMBER: z.string().default(""),
  CARD_MODE: z.enum(["app", "image"]).default("app"),
  PORT: z.coerce.number().default(3000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ .env is incomplete:");
  for (const issue of parsed.error.issues) console.error(`   ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;

export const TUNNEL_URL_FILE = "data/tunnel-url";

/**
 * Public base URL for card pages. Prefers PUBLIC_BASE_URL; otherwise reads the
 * URL `bun run tunnel` wrote, so a restarted quick tunnel is picked up without
 * editing .env or restarting Juno.
 */
export function publicBaseUrl(): string {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/$/, "");
  if (existsSync(TUNNEL_URL_FILE)) return readFileSync(TUNNEL_URL_FILE, "utf8").trim();
  throw new Error("No public URL — start `bun run tunnel` or set PUBLIC_BASE_URL");
}

export function isAdmin(handle: string | undefined): boolean {
  if (!handle) return false;
  // Before ADMIN_NUMBERS is set, any registered user may run commands (Free
  // plan only delivers messages from registered users anyway).
  return env.ADMIN_NUMBERS.length === 0 || env.ADMIN_NUMBERS.includes(handle);
}
