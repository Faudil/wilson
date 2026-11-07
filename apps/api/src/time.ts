/** Timezone helpers (no deps). Calendar dates are `YYYY-MM-DD` strings. */

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` reads `isoDate` `hour`:00. DST-safe. */
export function zonedTime(isoDate: string, hour: number, timeZone: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour);
  let result = guess - offsetMs(guess, timeZone);
  result = guess - offsetMs(result, timeZone);
  return new Date(result);
}

/** Calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(toIso) - ms(fromIso)) / 86_400_000);
}

/** The instant at which the wall clock in `timeZone` reads `isoDate` `hhmm` ("09:30"). DST-safe. */
export function zonedDateTime(isoDate: string, hhmm: string, timeZone: string): Date {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return new Date(zonedTime(isoDate, h, timeZone).getTime() + m * 60_000);
}

/** Wall-clock "HH:MM" of an instant in `timeZone`. */
export function localTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}
