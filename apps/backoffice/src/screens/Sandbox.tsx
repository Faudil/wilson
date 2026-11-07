import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { ConfirmSheet, ErrorBox, Empty, useToast } from "../components/ui";
import { useI18n } from "../i18n";
import { orpc } from "../lib/api";
import { addDays, todayParis } from "../lib/format";
import { formatDateTime } from "../lib/wilson-i18n";

/** Place de la République, Paris: used when the browser does not give a position. */
const SAMPLE_POINT = { lat: 48.8674, lon: 2.3636 };

const FAKE_PHONES = ["33600000001", "33600000002", "33600000003"];

/** The phone shows a menu's options as buttons, not as "1 - …" lines in the text. */
const withoutOptionLines = (text: string): string =>
  text
    .split("\n")
    .filter((l) => !/^[\u200e\u200f\s]*\d{1,2}\s*-\s/.test(l))
    .join("\n")
    .trim();

export function Sandbox() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const qc = useQueryClient();
  const [phone, setPhone] = useState(FAKE_PHONES[0]!);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(() => addDays(todayParis(), 23));
  const validPhone = /^\d{8,15}$/.test(phone);

  const thread = useQuery({
    ...orpc.sandbox.thread.queryOptions({ input: { phone } }),
    enabled: validPhone,
    refetchInterval: 2000,
  });
  const threadKey = orpc.sandbox.thread.key();
  const send = useMutation({
    ...orpc.sandbox.send.mutationOptions(),
    onSuccess: () => {
      setText("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      void qc.invalidateQueries({ queryKey: threadKey });
    },
  });
  const reset = useMutation({
    ...orpc.sandbox.reset.mutationOptions(),
    onSuccess: () => {
      setConfirmReset(false);
      return qc.invalidateQueries({ queryKey: threadKey });
    },
  });
  const reminders = useMutation({
    ...orpc.sandbox.runReminders.mutationOptions(),
    onSuccess: (d) => {
      toast(t("sandbox.remindersSent", { count: d.sent }));
      return qc.invalidateQueries({ queryKey: threadKey });
    },
  });

  const endRef = useRef<HTMLDivElement>(null);
  const count = thread.data?.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  /** Like WhatsApp's 📎 → Location: the browser's position, or a sample point in Paris if it is refused. */
  const sendLocation = () => {
    if (!validPhone) return;
    const go = (latitude: number, longitude: number) => send.mutate({ phone, location: { latitude, longitude } });
    if (!navigator.geolocation) return go(SAMPLE_POINT.lat, SAMPLE_POINT.lon);
    navigator.geolocation.getCurrentPosition(
      (p) => go(p.coords.latitude, p.coords.longitude),
      () => go(SAMPLE_POINT.lat, SAMPLE_POINT.lon),
      { timeout: 8000, maximumAge: 600_000 },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validPhone || (!text.trim() && !file)) return;
    send.mutate({ phone, text: text.trim() || undefined, file: file ?? undefined });
  };

  return (
    <section className="stack">
      <h1>{t("sandbox.title")}</h1>
      <p className="notice notice-info">
        <Icon name="info" />
        <span className="notice-body">{t("sandbox.intro")}</span>
      </p>

      <label className="field">
        <span className="field-label">{t("sandbox.phone")}</span>
        <input list="fake-phones" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} dir="ltr" />
        <datalist id="fake-phones">
          {FAKE_PHONES.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {!validPhone && <small className="notice notice-error">{t("sandbox.phoneInvalid")}</small>}
      </label>

      <div className="phone" aria-live="polite">
        {thread.isError && <ErrorBox error={thread.error} />}
        {thread.data?.length === 0 && <Empty art="chat">{t("sandbox.empty")}</Empty>}
        {thread.data?.map((m) => (
          <div key={m.id} className={`bubble bubble-${m.direction}`}>
            {m.hasMedia && (
              <div className="muted small">
                <Icon name="image" size={14} /> {t("sandbox.media")}
              </div>
            )}
            {m.text && (
              <div dir="auto" className="bubble-text">
                {m.choices.length > 0 ? withoutOptionLines(m.text) : m.text}
              </div>
            )}
            {m.choices.length > 0 && (
              <div className="wa-choices" role="group" aria-label={t("sandbox.choices")}>
                {m.choices.map((c) => (
                  <button key={c.id} type="button" className="wa-choice" disabled={send.isPending || !validPhone} onClick={() => send.mutate({ phone, text: c.id })}>
                    {c.title}
                  </button>
                ))}
              </div>
            )}
            <div className="bubble-time small muted">{formatDateTime(m.at, lang)}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="sandbox-form" onSubmit={submit}>
        {file && (
          <div className="file-chip">
            <Icon name="paperclip" size={16} />
            <span className="file-name">{file.name}</span>
            <button
              type="button"
              className="icon-btn icon-btn-small"
              aria-label={t("sandbox.removeFile")}
              onClick={() => {
                setFile(null);
                if (fileInput.current) fileInput.current.value = "";
              }}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <div className="composer-inner">
          <label className="icon-btn attach-btn" title={t("sandbox.attach")}>
            <Icon name="paperclip" />
            <span className="visually-hidden">{t("sandbox.attach")}</span>
            <input ref={fileInput} className="visually-hidden" type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="icon-btn attach-btn" title={t("sandbox.location")} onClick={sendLocation} disabled={send.isPending || !validPhone}>
            <Icon name="pin" />
            <span className="visually-hidden">{t("sandbox.location")}</span>
          </button>
          <div className="composer-field">
            <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} dir="auto" placeholder={t("sandbox.message")} aria-label={t("sandbox.message")} />
          </div>
          <button type="submit" className="send-btn" disabled={send.isPending || !validPhone || (!text.trim() && !file)} aria-label={t("sandbox.send")}>
            <Icon name="send" size={22} />
          </button>
        </div>
        {send.isError && <p className="notice notice-error">{t("error.generic")}</p>}
        <button type="button" className="btn btn-quiet btn-small" disabled={reset.isPending || !validPhone} onClick={() => setConfirmReset(true)}>
          <Icon name="trash" size={16} />
          {t("sandbox.reset")}
        </button>
      </form>

      <div className="card stack">
        <h2>
          <Icon name="bell" size={18} /> {t("sandbox.remindersTitle")}
        </h2>
        <p className="muted small">{t("sandbox.remindersHelp")}</p>
        <label className="field">
          <span className="field-label">{t("sandbox.remindersDate")}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
        </label>
        <button type="button" className="btn btn-block" disabled={reminders.isPending || !date} onClick={() => reminders.mutate({ date })}>
          {t("sandbox.remindersRun")}
        </button>
        {reminders.isError && <p className="notice notice-error">{t("error.generic")}</p>}
      </div>

      <ConfirmSheet
        open={confirmReset}
        title={t("sandbox.resetTitle")}
        body={t("sandbox.confirmReset")}
        confirmLabel={t("sandbox.resetYes")}
        tone="danger"
        busy={reset.isPending}
        onConfirm={() => reset.mutate({ phone })}
        onClose={() => setConfirmReset(false)}
      />
    </section>
  );
}
