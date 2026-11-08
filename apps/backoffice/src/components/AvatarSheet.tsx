import type { Avatar as AvatarData } from "@wilson/contracts";
import { AVATAR_COLORS, AVATAR_EMOJIS } from "@wilson/contracts/values";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { orpc } from "../lib/api";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Sheet, useToast } from "./ui";

/** Choose the nickname, emoji and colour the team sees for a person. Back-office only: the person never sees it. */
export function AvatarSheet({ open, onClose, id, avatar }: { open: boolean; onClose: () => void; id: string; avatar: AvatarData | null }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(avatar?.name ?? "");
  const [emoji, setEmoji] = useState<AvatarData["emoji"]>(avatar?.emoji ?? null);
  const [color, setColor] = useState<AvatarData["color"]>(avatar?.color ?? null);
  useEffect(() => {
    if (!open) return;
    setName(avatar?.name ?? "");
    setEmoji(avatar?.emoji ?? null);
    setColor(avatar?.color ?? null);
  }, [open, avatar]);
  const save = useMutation({
    ...orpc.beneficiaries.setAvatar.mutationOptions(),
    onSuccess: () => {
      // Every list shows the nickname: refresh them all.
      void qc.invalidateQueries();
      toast(t("avatar.saved"));
      onClose();
    },
  });
  const preview: AvatarData = { name: name.trim() || null, emoji, color };
  return (
    <Sheet open={open} onClose={onClose} title={t("avatar.title")}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ id, avatar: preview });
        }}
      >
        <div className="avatar-preview">
          <Avatar avatar={preview} seed={id} size={72} />
        </div>
        <label className="field">
          <span className="field-label">{t("avatar.name")}</span>
          <input value={name} maxLength={24} dir="auto" autoComplete="off" onChange={(e) => setName(e.target.value)} placeholder={t("avatar.namePlaceholder")} />
          <small className="muted">{t("avatar.nameHelp")}</small>
        </label>
        <fieldset className="field">
          <legend className="field-label">{t("avatar.emoji")}</legend>
          <div className="pick-grid">
            <button type="button" className="pick" aria-pressed={emoji === null} aria-label={t("avatar.noEmoji")} onClick={() => setEmoji(null)}>
              <Icon name="user" size={20} />
            </button>
            {AVATAR_EMOJIS.map((e) => (
              <button key={e} type="button" className="pick" aria-pressed={emoji === e} onClick={() => setEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend className="field-label">{t("avatar.color")}</legend>
          <div className="pick-grid">
            {AVATAR_COLORS.map((c) => (
              <button key={c} type="button" className={`pick face-${c} pick-color`} aria-pressed={color === c} aria-label={t(`avatar.color.${c}`)} onClick={() => setColor(c)} />
            ))}
          </div>
        </fieldset>
        {save.isError && <p className="notice notice-error">{t("error.generic")}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={save.isPending}>
          {t("avatar.save")}
        </button>
      </form>
    </Sheet>
  );
}
