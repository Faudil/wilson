export const MAX_CHUNK_CHARS = 1500;

/** Splits text on paragraph (then sentence, then hard) boundaries into pieces of at most `max` characters. */
export function splitText(text: string, max = MAX_CHUNK_CHARS): string[] {
  const clean = text.replace(/\r/g, "").trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const pieces: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) pieces.push(cur.trim());
    cur = "";
  };
  const units: string[] = [];
  for (const para of clean.split(/\n+/)) {
    if (para.length <= max) units.push(para);
    else {
      for (const s of para.match(/[^.!?]+[.!?]*\s*/g) ?? [para]) {
        if (s.length <= max) units.push(s);
        else for (let i = 0; i < s.length; i += max) units.push(s.slice(i, i + max));
      }
    }
  }
  for (const u of units) {
    if (cur && cur.length + u.length + 1 > max) push();
    cur += (cur ? "\n" : "") + u;
  }
  push();
  return pieces;
}
