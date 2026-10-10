import { emit } from "./events.ts";

const time = () => new Date().toLocaleTimeString("en-US", { hour12: false });

export function log(emoji: string, msg: string, extra?: unknown) {
  emit(emoji, msg);
  const line = `${time()} ${emoji} ${msg}`;
  if (extra === undefined) console.log(line);
  else console.log(line, extra);
}

export function logError(msg: string, err: unknown) {
  console.error(`${time()} 💥 ${msg}`, err instanceof Error ? (err.stack ?? err.message) : err);
}
