# Juno demo & video guide

Everything needed to run the demo and record the submission video, without touching code. For what Juno is and how it's built, see the [README](../README.md).

## Who's who

| | Plays | Device |
|---|---|---|
| **Mom** | Anjali, the patient (fictional) | Nikhilesh's iPhone. The four demo photos are in its camera roll ([`docs/photos/`](photos)). |
| **Tvisha** | The daughter / caregiver | Tvisha's iPhone |
| **Juno** | The agent | Runs on Nikhilesh's laptop |
| **Dashboard** | "Juno's brain": live feed, photo reading, care board | Any laptop, through a private link |

## The demo photos

All four are fictional and live in [`docs/photos/`](photos). They're already in Mom's camera roll; if not, AirDrop them from that folder. The camera roll doesn't show file names, so here's how to tell them apart:

| Photo | File | What it is | How it looks on the phone |
|---|---|---|---|
| **1** | [`1-discharge-page1.jpg`](photos/1-discharge-page1.jpg) | Discharge papers, page 1: diagnoses, medicine table, follow-up table | Paper on a wooden table, header *AFTER VISIT SUMMARY — DISCHARGE INSTRUCTIONS* |
| **2** | [`2-discharge-page2.jpg`](photos/2-discharge-page2.jpg) | Discharge papers, page 2: warning signs, activity, diet | Same paper style, a **red box** near the top (*CALL 911…*) and lots of blank space at the bottom |
| **3** | [`3-appointment-card.jpg`](photos/3-appointment-card.jpg) | Appointment reminder card: Peachtree Heart Associates, **Tue Oct 20, 2:00 PM**, Dr. Okafor | A small card with a **dark-red border**, not a full page |
| **4** | [`4-lab-results.jpg`](photos/4-lab-results.jpg) | Lab report: 24 results, collected Oct 15 | Full page, green *PEACHTREE LABS* header, typewriter-style font |

- Send **1 and 2 together** (select both, one send). They're the ones that create the to-dos, so they always go first.
- Send the original photos, not screenshots or edited copies: Juno has already read these exact files, so they're instant and use no AI quota.

## What runs where (important)

- **Juno runs on Nikhilesh's laptop only.** Keep it plugged in and awake. Never start a second copy: two copies would both answer every message.
- **Nikhilesh sends you two private links** (they change if his tunnel restarts; he gets fresh ones with `bun run admin links`):
  - **Dashboard**: open it in a browser window for the recording.
  - **Controls**: buttons for *Skip 2 days*, *Skip 1 day*, and *Reset*. Keep this window **off-camera**.
- Don't post the links anywhere; they open the dashboard for whoever has them.
- Nothing in the demo uses Gemini quota: the demo photos are already cached, and the demo texts are understood without AI.

## Before every run (1 minute)

1. **Controls → Reset.**
2. **Delete the Juno chat on both phones** (Messages → swipe left on Juno → Delete).
3. **Reload the dashboard.** The board is empty and the counters are 0.
4. Both phones: **Do Not Disturb on**, brightness up, other apps closed.

## The run (about 4 minutes before editing)

**Order matters: photos 1 + 2 first (they create the to-dos), photo 3 and photo 4 later. Don't text Juno from Tvisha's phone until step 4.**

| # | Do | You should see |
|---|---|---|
| 1 | **Mom** sends photos 1 + 2 **together** (one album) | 👀 on the photos, a welcome, "Got both pages…", then warning signs, a plain summary + medicines, the **checklist card**, and the numbers to call (about 15 s). Dashboard: photo → detected page → flattened scan, 4 to-dos on the board. |
| 2 | **Mom** asks: *can I eat before my blood test?* | "For the fasting blood test: Nothing to eat or drink except water for 10–12 hours before…" |
| 3 | **Mom** taps the card → **See primary care doctor** → **I booked it** → picks a time → **Save** | The card flips that step to **Booked**, plus a calendar invite in the chat. *(Use the primary care visit here: photo 3 books the heart doctor later.)* |
| 4 | **Mom** texts: *add my daughter Tvisha* + Tvisha's number, then votes **Everything** in the poll | **Tvisha's phone**: an intro from Juno, Mom's list, and a **care plan link** with a preview image. Tvisha can open it. |
| 5 | **Controls → Skip 2 days** | Mom gets **reminder 1** (fasting blood test). **Open Mom's chat** so it shows *Read*. |
| 6 | Wait about a minute. **Controls → Skip 1 day** | **Reminder 2.** **Open Mom's chat.** About 10 s later **Tvisha's phone** gets the heads-up: *"your mom hasn't booked her fasting blood test… She's seen my reminders"*. |
| 7 | **Tvisha** taps ❤️ on that message, then texts *booked it Thu 9am* | ❤️ → *"Thank you 💜 When it's booked…"*. After the text: Mom's card shows **Booked · Tvisha**, Mom gets *"Tvisha booked your fasting blood test…"* + a calendar invite, Tvisha gets a thank-you. |
| 8 | **Tvisha** asks: *when is mom's blood test?* | "📅 Her fasting blood test is Thu, Oct 15 at 9:00 AM at Peachtree Labs. You booked it 💜" |
| 9 | **Mom** sends photo 3 (the appointment reminder card) | Juno reads it and books the **heart doctor visit**, Tue, Oct 20 at 2:00 PM: card updates + calendar invite. *("She just snaps the reminder card.")* |
| 10 | **Mom** sends photo 4 (lab results) → taps **Kidneys** → **Full view** | Lab message + **body-map card** → range bars → Juno sends the full view as a link (with a preview image) → it opens an animated lab page with *Questions for Dr. Chen*. |
| 11 | **Mom** asks: *what was my potassium?* | "Your potassium: 3.3 mmol/L (range 3.5–5.1), a little low compared with the printed range. Dr. Chen can explain…" |
| 12 | End on the dashboard | The feed shows every step, each tagged with the Spectrum feature behind it. |

Other things Juno understands, if you want extra shots: *what is Eliquis for?*, *what's my next appointment?*, *show me my list*, *show my plan*, *what are my warning signs?*. Saying a symptom like *I have chest pain* gets a "call 911" reply and alerts Tvisha (good for a 3-second safety shot; not required).

### If something goes off-script

- **No reminder after a skip:** wait 10 s; reminders also need about a minute between them.
- **No heads-up to Tvisha:** make sure Mom's chat was opened after reminder 2 (it must show *Read*). If still nothing, Skip 1 day again (Juno also asks family after a day of silence).
- **Tvisha texted Juno too early, or anything looks wrong:** Reset and start over.
- **Juno goes quiet entirely:** check the dashboard feed, then message Nikhilesh (his laptop may be asleep or off the internet).

## Recording setup (your Mac)

1. **Phones on screen:** plug each iPhone into the Mac with a cable and tap *Trust*. In **QuickTime Player** → *File → New Movie Recording* → click the ⌄ next to the record button → pick the iPhone. Do it twice (one window per phone). Don't press record in QuickTime; mute its volume.
2. **Dashboard:** browser window with the dashboard link, between the two phone windows. **Controls** in a separate window outside the recording area.
3. **Record:** ⌘⇧5 → *Record Selected Portion* → drag around the three windows only. Record without narration; add voiceover later.
4. Do one practice run without recording.

## The video: aim it at Photon's "Agents in iMessage" prize

**Angle:** Juno is an agent that lives entirely inside iMessage. No app, no login: just a conversation and live cards, built on Photon Spectrum. Show as many iMessage-native features as the story allows, and **name each one on screen** (short caption in the corner). The dashboard tags every step with its Spectrum feature, so zooming into the feed works as a caption too.

**Length:** 2:00–2:45. Phones are the star; cut to the dashboard only to show what's happening underneath.

| Time | Scene | On-screen caption (Spectrum feature) |
|---|---|---|
| 0:00 | Title card: *"Hospital paperwork → a plan that actually happens, inside iMessage"* | |
| 0:05 | Mom sends both photos | *Album message → one turn · typing indicator · read · 👀 reaction* |
| 0:20 | Zoom: dashboard "Reading the paperwork" | *OpenCV flattens the page · Gemini reads it* |
| 0:30 | Warning signs, summary, checklist card | *Live app card: a mini-app inside the bubble* |
| 0:45 | Tap step → I booked it → time → Save | *Tap actions inside the card · card edits itself in place · .ics attachment* |
| 1:00 | Add Tvisha → poll → her phone lights up, plan link | *Native poll · new 1:1 chat · rich link with designed preview* |
| 1:15 | Skip → reminder 1 → read → skip → reminder 2 → read | *Proactive messages (max 2) · read receipts* |
| 1:30 | Tvisha's heads-up, ❤️, "booked it Thu 9am", Mom's card updates | *Read receipts drive the escalation · tapback as input · edit in place* |
| 1:50 | Tvisha asks "when is mom's blood test?" | *An agent you can just ask* |
| 1:55 | Mom snaps the appointment card (photo 3) | *Attachment → read → card edit + .ics* |
| 2:00 | Lab photo → body map → organ → full view | *Interactive live card → rich link to the full page* |
| 2:20 | Closing card | see below |

**Closing card:** *Built on Photon Spectrum: live app cards with tap actions and in-place edits · polls · read receipts · tapbacks · typing · rich links · attachments · message effects · contact card · multiple 1:1 chats. Follows Photon's best practices: bursts handled as one turn, no links in a first message, at most two reminders. Found and patched a spectrum-ts bug (empty poll titles dropped votes).* Then the team and the GitHub link.

**Voiceover lines** (one per scene, warm and simple):
- "Leaving the hospital means a stack of paperwork, and follow-ups that are easy to miss. Juno lives in iMessage and makes sure they happen."
- "Mom just photographs her papers. Juno reads them and answers with warning signs first, a plain summary, and a checklist she can tap."
- "Every step has the number, what to say, and a one-tap 'I booked it'."
- "She loops in her daughter with a native poll, and her daughter gets her own chat."
- "Days later, nothing's booked. Juno nudges, twice. Mom reads both, but still doesn't book."
- "So Juno quietly asks her daughter, who books it from anywhere. Mom's card updates itself."
- "Lab results become a body map. The colors come from the printed ranges, never from AI."
- "Juno never diagnoses and never books for you. It just makes sure the follow-ups happen."

## Editing (iMovie)

- Trim dead time, including the minute between the two skips.
- Speed up the ~15 s while Juno reads photos (select clip → speedometer → 2×–4×).
- Zoom per scene with *Crop → Ken Burns / Crop to fill*: phones for the conversation, dashboard for "what's happening underneath".
- Captions: *Titles* → a lower-third style, short.
- Voiceover: microphone button under the viewer.
- Export 1080p → upload to YouTube (unlisted is fine) → put the link in Devpost.
