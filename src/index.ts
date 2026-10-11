import { env } from "./env.ts";
import { tick } from "./flows/nudges.ts";
import { log, logError } from "./log.ts";
import { onMessage } from "./router.ts";
import { bootSpectrum } from "./spectrum.ts";
import { web } from "./web/server.ts";

Bun.serve({ port: env.PORT, fetch: web.fetch, idleTimeout: 255 }); // the dashboard keeps a live event stream open
log("🌐", `web server on http://localhost:${env.PORT} · Juno's brain: http://localhost:${env.PORT}/brain`);

const spectrum = await bootSpectrum();
log("💛", `Juno is listening on iMessage (project "${spectrum.config.name}")`);

setInterval(tick, 10_000);

for await (const [space, message] of spectrum.messages) {
  // Don't await: a slow turn (Gemini, OpenCV) must not block receipts or other chats.
  onMessage(space, message).catch((err) => logError("message failed", err));
}

