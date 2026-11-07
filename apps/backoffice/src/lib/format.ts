/** Today as YYYY-MM-DD in Europe/Paris (deadlines are calendar dates in that zone). */
export function todayParis(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export const linesToList = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const PARIS = "Europe/Paris";

/** Wall-clock date ("YYYY-MM-DD") and time ("HH:MM") of an instant in Paris, whatever the device's own time zone. */
export function parisParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: todayParis(d),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: PARIS, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d),
  };
}

/** The instant at which Paris clocks read `date` `time` (DST-safe), as an ISO string. */
export function parisToIso(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const n = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !n) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(n[1]), Number(n[2]));
  const offset = (at: number) => {
    const p = parisParts(new Date(at).toISOString());
    return Date.parse(`${p.date}T${p.time}:00Z`) - Math.floor(at / 60_000) * 60_000;
  };
  let at = guess - offset(guess);
  at = guess - offset(at);
  return new Date(at).toISOString();
}
