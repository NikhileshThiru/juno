// In-process event bus for the laptop dashboard ("Juno's brain"): every log
// line becomes a feed event, plus counters for how Juno understood things.
type Listener = (e: FeedEvent) => void;
export type FeedEvent = { t: number; emoji: string; msg: string };

const listeners = new Set<Listener>();
const recent: FeedEvent[] = [];

export function emit(emoji: string, msg: string) {
  const e = { t: Date.now(), emoji, msg };
  recent.push(e);
  if (recent.length > 200) recent.shift();
  for (const l of listeners) l(e);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const recentEvents = () => recent.slice();

/** How messages got understood today: Gemini calls, photo-cache hits, local parses. */
export const counters = { gemini: 0, cached: 0, local: 0 };
