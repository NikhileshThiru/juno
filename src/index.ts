import { env } from "./env.ts";
import { tick } from "./flows/nudges.ts";
import { log, logError } from "./log.ts";
import { onMessage } from "./router.ts";
import { bootSpectrum, spaceFor } from "./spectrum.ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { db, getSetting, setSetting } from "./db.ts";
import { web } from "./web/server.ts";

Bun.serve({ port: env.PORT, fetch: web.fetch });
log("🌐", `web server on http://localhost:${env.PORT} · Juno's brain: http://localhost:${env.PORT}/brain`);

const spectrum = await bootSpectrum();
log("💛", `Juno is listening on iMessage (project "${spectrum.config.name}")`);

setInterval(tick, 10_000);
clearBackgrounds().catch((err) => logError("clear backgrounds", err));

for await (const [space, message] of spectrum.messages) {
  // Don't await: a slow turn (Gemini, OpenCV) must not block receipts or other chats.
  onMessage(space, message).catch((err) => logError("message failed", err));
}

/** We no longer set a chat background; remove the one earlier builds set (once per chat). */
async function clearBackgrounds() {
  const users = db.query("SELECT id FROM users WHERE space_id IS NOT NULL").all() as { id: string }[];
  for (const { id } of users) {
    if (getSetting(`bg_cleared:${id}`)) continue;
    await imessage(await spaceFor(id)).background("clear");
    setSetting(`bg_cleared:${id}`, "1");
    log("🧽", `cleared chat background for ${id}`);
  }
}
