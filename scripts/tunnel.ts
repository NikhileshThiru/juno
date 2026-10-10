// Starts a cloudflared quick tunnel to :PORT and writes its URL to data/tunnel-url.
// Juno reads that file at send time, so restarting the tunnel needs no .env edit.
import { mkdirSync, writeFileSync } from "node:fs";

const port = process.env.PORT ?? "3000";
mkdirSync("data", { recursive: true });

const proc = Bun.spawn(["cloudflared", "tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], {
  stdout: "inherit",
  stderr: "pipe",
});

const decoder = new TextDecoder();
let found = false;
for await (const chunk of proc.stderr) {
  const s = decoder.decode(chunk);
  if (!found) {
    const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      found = true;
      writeFileSync("data/tunnel-url", m[0]);
      console.log(`\n🚇 tunnel up: ${m[0]}  (written to data/tunnel-url)\n`);
    }
  }
  if (/ERR|error/i.test(s)) process.stderr.write(s);
}
process.exit(await proc.exited);
