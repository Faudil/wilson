import type React from "react";
import type { Avatar as AvatarData } from "@wilson/contracts";
import { Icon } from "./Icon";

/** Stable fallback colour from the person's id, so an unnamed person still keeps the same colour everywhere. */
const FALLBACK = ["teal", "orange", "plum", "sky", "moss", "rose", "sand", "slate"] as const;
function colorFor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}

/**
 * The little round face volunteers see for a person: the emoji chosen for them, else the first letter of their nickname,
 * else a neutral person icon. Purely decorative next to the label (which always says who it is), hence aria-hidden.
 */
export function Avatar({ avatar, seed, size = 40 }: { avatar: AvatarData | null | undefined; seed: string; size?: number }) {
  const color = avatar?.color ?? colorFor(seed);
  const initial = avatar?.name?.trim() ? Array.from(avatar.name.trim())[0]!.toLocaleUpperCase() : null;
  return (
    <span className={`face face-${color}`} style={{ inlineSize: size, blockSize: size, fontSize: size * 0.45 }} aria-hidden="true">
      {avatar?.emoji ? <span className="face-emoji">{avatar.emoji}</span> : initial ?? <Icon name="user" size={Math.round(size * 0.5)} />}
    </span>
  );
}

/** A person's avatar with their label (nickname, or masked phone read left to right) and an optional second line. */
export function Who({ label, avatar, seed, sub, size = 40 }: { label: string; avatar: AvatarData | null | undefined; seed: string; sub?: React.ReactNode; size?: number }) {
  return (
    <span className="who">
      <Avatar avatar={avatar} seed={seed} size={size} />
      <span className="who-text">
        <span className="who-name" dir={labelDir(label)}>{label}</span>
        {sub ? <span className="who-sub">{sub}</span> : null}
      </span>
    </span>
  );
}

/** Masked phones read left to right in every UI language; a nickname takes its own script's direction. */
export const labelDir = (label: string): "ltr" | "auto" => (label.startsWith("•") ? "ltr" : "auto");
