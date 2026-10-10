import { markdown, Spectrum, type ContentInput, type Message, type Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { getUser, recordOutbound, upsertUser } from "./db.ts";
import { env } from "./env.ts";
import { now } from "./clock.ts";

const create = () =>
  Spectrum({
    projectId: env.SPECTRUM_PROJECT_ID,
    projectSecret: env.SPECTRUM_PROJECT_SECRET,
    providers: [imessage.config()],
    options: { logLevel: "warn" },
  });

export let spectrum: Awaited<ReturnType<typeof create>>;
export async function bootSpectrum() {
  spectrum = await create();
  return spectrum;
}

const spaces = new Map<string, Space>();

export function rememberSpace(userId: string, space: Space) {
  spaces.set(userId, space);
  if (getUser(userId)?.space_id !== space.id) upsertUser(userId, { space_id: space.id });
}

/** The 1:1 chat with a user: cached, rebuilt from the stored id after a restart, or created. */
export async function spaceFor(userId: string): Promise<Space> {
  const cached = spaces.get(userId);
  if (cached) return cached;
  const im = imessage(spectrum);
  const stored = getUser(userId)?.space_id;
  const space = stored ? await im.space.get(stored) : await im.space.create(await im.user(userId));
  rememberSpace(userId, space);
  return space;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Send with outbound bookkeeping (read receipts map back to nudges via this table). */
export async function send(userId: string, content: ContentInput, meta: { kind?: string; todoId?: string } = {}): Promise<Message | undefined> {
  const space = await spaceFor(userId);
  const sent = await space.send(content);
  if (sent?.id) recordOutbound(sent.id, userId, meta.kind ?? "msg", meta.todoId ?? null, now());
  return sent;
}

// Copy uses *italic* / **bold**; send those strings as markdown so the
// asterisks render as styling instead of showing up literally.
const styled = (c: ContentInput) => (typeof c === "string" && /\*[^*\s][^*]*\*/.test(c) ? markdown(c) : c);

/** Several messages with typing in between, paced like a person. */
export async function say(userId: string, ...contents: ContentInput[]) {
  const space = await spaceFor(userId);
  for (const [i, raw] of contents.entries()) {
    const c = styled(raw);
    if (i > 0) {
      await space.startTyping();
      await sleep(900 + Math.min(1600, typeof c === "string" ? c.length * 12 : 600));
    }
    await send(userId, c);
  }
  await space.stopTyping().catch(() => {});
}
