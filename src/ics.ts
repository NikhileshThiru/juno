import type { Todo } from "./db.ts";

const utc = (t: number) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");

export function buildIcs(t: Todo): { name: string; data: Buffer } {
  const start = t.appt_at!;
  const notes = [t.prep, t.category === "specialist" || t.category === "primary_care" ? "Bring your medication list." : null, t.phone ? `Clinic: ${t.phone}` : null, "From Juno 💛"]
    .filter(Boolean)
    .join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Juno//Hacklanta//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${t.id}@juno`,
    `DTSTAMP:${utc(Date.now())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(start + 60 * 60 * 1000)}`,
    `SUMMARY:${esc(`${t.title}${t.provider ? ` – ${t.provider}` : ""}`)}`,
    ...(t.clinic ? [`LOCATION:${esc(t.clinic)}`] : []),
    `DESCRIPTION:${esc(notes)}`,
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(`Tomorrow: ${t.title}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const name = `${t.title.replace(/[^\w ]/g, "").trim().replace(/\s+/g, "-") || "appointment"}.ics`;
  return { name, data: Buffer.from(lines.join("\r\n") + "\r\n") };
}
