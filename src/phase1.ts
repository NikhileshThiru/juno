// Phase 1 test bench: one text command per unknown in the plan. Everything
// here is throwaway except what we learn — results go in plan.md §9.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { app, attachment, edit, poll, text, type Message, type Space } from "spectrum-ts";
import { effect, imessage } from "spectrum-ts/providers/imessage";
import { testBackgroundPng, testCardJpeg } from "./cards/render.ts";
import { publicBaseUrl } from "./env.ts";
import { log, logError } from "./log.ts";

type Ctx = { space: Space; message: Message };
type Command = { help: string; run: (ctx: Ctx) => Promise<void> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- card handles ---------------------------------------------------------

const CARDS_FILE = "data/phase1-cards.json";

function saveCard(label: string, sent: Message | undefined) {
  const session = sent ? (sent as unknown as { miniAppCardSession?: unknown }).miniAppCardSession : undefined;
  log("💳", `${label}: sent id=${sent?.id ?? "∅"} session=${session ? "yes" : "NO"}`, session);
  if (!sent || !session) return;
  const all = existsSync(CARDS_FILE) ? JSON.parse(readFileSync(CARDS_FILE, "utf8")) : {};
  all.last = { label, id: sent.id, session, savedAt: new Date().toISOString() };
  writeFileSync(CARDS_FILE, JSON.stringify(all, null, 2));
}

const cardUrl = (v: string) => `${publicBaseUrl()}/c/test?v=${encodeURIComponent(v)}`;

// ---- read receipts / poll votes (called from the router) -------------------

const pendingReads = new Map<string, { label: string; sentAt: number; space: Space }>();

function trackRead(label: string, sent: Message | undefined, space: Space) {
  if (sent) pendingReads.set(sent.id, { label, sentAt: Date.now(), space });
}

export async function onReadReceipt(targetId: string) {
  const p = pendingReads.get(targetId);
  if (!p) return;
  pendingReads.delete(targetId);
  const secs = Math.round((Date.now() - p.sentAt) / 1000);
  log("👁️", `read receipt for "${p.label}" after ${secs}s`);
  // One-shot confirmation tied to a test message — never a generic reply to reads.
  await p.space.send(`👁️ Read receipt arrived for “${p.label}” (${secs}s after I sent it).`);
}

export async function onPollVote(space: Space, title: string, selected: boolean, pollTitle: string) {
  log("🗳️", `poll vote: "${title}" selected=${selected} (poll: ${pollTitle})`);
  if (selected) await space.send(`🗳️ Got your vote: ${title}`);
}

// ---- helpers ---------------------------------------------------------------

function icsTest(): Buffer {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(14, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Juno//Hacklanta//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:juno-test-${Date.now()}@juno`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    "SUMMARY:Cardiology – Dr. Okafor (Juno test)",
    "LOCATION:Peachtree Heart Associates\\, Atlanta GA",
    "DESCRIPTION:Bring your medication list.\\nCall (404) 555-0142 if you need to reschedule.",
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    "DESCRIPTION:Cardiology tomorrow",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return Buffer.from(lines.join("\r\n") + "\r\n");
}

async function* words(s: string) {
  for (const w of s.split(" ")) {
    yield `${w} `;
    await sleep(90);
  }
}

// ---- commands --------------------------------------------------------------

export const commands: Record<string, Command> = {
  "/cardtest": {
    help: "app card (text layout, live) → edit in place after 5s",
    async run({ space }) {
      const layout = { caption: "Juno test card", subcaption: "Tap me" };
      const card = await space.send(app(cardUrl("1"), { live: true, layout }));
      saveCard("cardtest", card);
      await sleep(5000);
      await space.send(edit(app(cardUrl("2"), { live: true, layout: { caption: "Updated ✅", subcaption: "Edited in place" } }), card!));
      log("💳", "cardtest: edit sent");
    },
  },
  "/cardstatic": {
    help: "app card with live:false (static layout)",
    async run({ space }) {
      const card = await space.send(app(cardUrl("static"), { live: false, layout: { caption: "Static card", subcaption: "live: false" } }));
      saveCard("cardstatic", card);
    },
  },
  "/cardimg": {
    help: "app card with image layout → swap image after 5s",
    async run({ space }) {
      const layout = { image: testCardJpeg("3 to-dos · tap to see details"), imageTitle: "Your next steps", caption: "3 to-dos", subcaption: "Tap to see details" };
      const card = await space.send(app(cardUrl("img1"), { live: true, layout }));
      saveCard("cardimg", card);
      await sleep(5000);
      await space.send(
        edit(app(cardUrl("img2"), { live: true, layout: { ...layout, image: testCardJpeg("Updated — 1 booked ✅"), caption: "1 booked ✅" } }), card!),
      );
      log("💳", "cardimg: edit sent");
    },
  },
  "/cardog": {
    help: "app card with NO layout (Spectrum fetches OpenGraph from the tunnel)",
    async run({ space }) {
      const card = await space.send(app(cardUrl("og"), { live: true }));
      saveCard("cardog", card);
    },
  },
  "/cardrestore": {
    help: "edit the last card from its SAVED session (simulates a server restart)",
    async run({ space }) {
      if (!existsSync(CARDS_FILE)) return void (await space.send("No saved card yet — run /cardtest first."));
      const { last } = JSON.parse(readFileSync(CARDS_FILE, "utf8"));
      // Only miniAppCardSession is read by the iMessage provider's edit path.
      const target = {
        id: last.id,
        direction: "outbound",
        platform: "imessage",
        space,
        content: { type: "text", text: "" },
        sender: undefined,
        timestamp: new Date(),
        miniAppCardSession: last.session,
      } as unknown as Message;
      const layout = { caption: "Restored ✅", subcaption: `Edited from a saved handle (${last.label})` };
      await space.send(edit(app(cardUrl("restored"), { live: true, layout }), target));
      log("💳", `cardrestore: edit sent for ${last.label} saved ${last.savedAt}`);
    },
  },
  "/cardlive": {
    help: "realistic tracker card: compact in the bubble, full view on tap → blood test flips to Booked after 8s",
    async run({ space }) {
      const url = (state: number) => `${publicBaseUrl()}/c/demo?state=${state}&v=${Date.now()}`;
      const card = await space.send(
        app(url(1), { live: true, layout: { caption: "Your next steps", subcaption: "1 of 4 done · next: blood test by Oct 15" } }),
      );
      saveCard("cardlive", card);
      await sleep(8000);
      await space.send(
        edit(app(url(2), { live: true, layout: { caption: "Your next steps", subcaption: "Blood test booked ✅ Thu 9:00 AM" } }), card!),
      );
      log("💳", "cardlive: edit sent (state 2)");
    },
  },
  "/cardprobe": {
    help: "tap test: do taps, links, and tel: links work inside a live card?",
    async run({ space }) {
      const card = await space.send(app(`${publicBaseUrl()}/c/probe?v=${Date.now()}`, { live: true, layout: { caption: "Tap test", subcaption: "Tap the buttons inside" } }));
      saveCard("cardprobe", card);
    },
  },
  "/poll": {
    help: "native poll; your vote should come back",
    async run({ space }) {
      const sent = await space.send(poll("What should Tvisha see?", "Just my to-dos", "Everything"));
      log("🗳️", `poll sent id=${sent?.id}`);
    },
  },
  "/edit": {
    help: "send ☐ text → edit to ✅ after 4s",
    async run({ space }) {
      const sent = await space.send("☐ Fasting blood test — by Oct 15");
      await sleep(4000);
      await space.send(edit(text("✅ Fasting blood test — booked Thu 9:00 AM"), sent!));
      log("✏️", "text edit sent");
    },
  },
  "/ics": {
    help: "calendar invite attachment (tomorrow 2pm)",
    async run({ space }) {
      await space.send(attachment(icsTest(), { name: "Cardiology.ics", mimeType: "text/calendar" }));
      log("📅", "ics sent");
    },
  },
  "/read": {
    help: "send a message and report when its read receipt arrives",
    async run({ space }) {
      const sent = await space.send("👀 Read-receipt test: leave this chat, then come back and open it.");
      trackRead("read test", sent, space);
    },
  },
  "/effect": {
    help: "confetti effect",
    async run({ space }) {
      await space.send(effect("You did everything on your list 🎉", imessage.effect.message.confetti));
    },
  },
  "/contact": {
    help: "share Juno's contact card (name + photo)",
    async run({ space }) {
      await imessage(space).shareContactCard();
      await space.send("Save me as Juno so you can find me 💛");
    },
  },
  "/stream": {
    help: "streamed text (first chunk sent, then edited as it grows)",
    async run({ space }) {
      await space.send(
        text(words("You were in the hospital for an irregular heartbeat called AFib. You have 3 new medicines and 4 things to do in the next 2 weeks. I'll help you keep track of each one.")),
      );
    },
  },
  "/bg": {
    help: "set a soft warm chat background (iOS 26)",
    async run({ space }) {
      await imessage(space).background(Buffer.from(testBackgroundPng()), { mimeType: "image/png" });
    },
  },
  "/bgclear": {
    help: "clear the chat background",
    async run({ space }) {
      await imessage(space).background("clear");
    },
  },
};

const CORE = ["/cardtest", "/cardimg", "/poll", "/edit", "/ics", "/read"];

commands["/all"] = {
  help: `run the core checks in order: ${CORE.join(" ")}`,
  async run(ctx) {
    for (const name of CORE) {
      await ctx.space.send(`▶️ ${name}`);
      try {
        await commands[name]!.run(ctx);
      } catch (err) {
        logError(name, err);
        await ctx.space.send(`❌ ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(2500);
    }
  },
};

commands["/help"] = {
  help: "list test commands",
  async run({ space }) {
    await space.send(Object.entries(commands).map(([k, v]) => `${k} — ${v.help}`).join("\n"));
  },
};
