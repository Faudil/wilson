import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ErrorBox } from "../components/ui";
import { useI18n } from "../i18n";
import { orpc } from "../lib/api";
import { addDays, todayParis } from "../lib/format";
import { formatDateTime } from "../lib/wilson-i18n";

const FAKE_PHONES = ["33600000001", "33600000002", "33600000003"];

export function Sandbox() {
  const { t, lang } = useI18n();
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
  const reset = useMutation({ ...orpc.sandbox.reset.mutationOptions(), onSuccess: () => qc.invalidateQueries({ queryKey: threadKey }) });
  const reminders = useMutation({ ...orpc.sandbox.runReminders.mutationOptions(), onSuccess: () => qc.invalidateQueries({ queryKey: threadKey }) });

  const endRef = useRef<HTMLDivElement>(null);
  const count = thread.data?.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validPhone || (!text.trim() && !file)) return;
    send.mutate({ phone, text: text.trim() || undefined, file: file ?? undefined });
  };

  return (
    <section className="stack">
      <h1>{t("sandbox.title")}</h1>
      <p className="notice notice-info">{t("sandbox.intro")}</p>

      <label className="field">
        <span>{t("sandbox.phone")}</span>
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
        {thread.data?.length === 0 && <p className="muted center">{t("sandbox.empty")}</p>}
        {thread.data?.map((m) => (
          <div key={m.id} className={`bubble bubble-${m.direction}`}>
            {m.hasMedia && <div className="muted small">{t("sandbox.media")}</div>}
            {m.text && (
              <div dir="auto" className="bubble-text">
                {m.text}
              </div>
            )}
            <div className="bubble-time small muted">{formatDateTime(m.at, lang)}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>{t("sandbox.message")}</span>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
        </label>
        <label className="field">
          <span>{t("sandbox.file")}</span>
          <input ref={fileInput} type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {send.isError && <p className="notice notice-error">{t("error.generic")}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={send.isPending || !validPhone || (!text.trim() && !file)}>
          {t("sandbox.send")}
        </button>
        <button type="button" className="btn btn-block" disabled={reset.isPending || !validPhone} onClick={() => window.confirm(t("sandbox.confirmReset")) && reset.mutate({ phone })}>
          {t("sandbox.reset")}
        </button>
      </form>

      <div className="card stack">
        <h2>{t("sandbox.remindersTitle")}</h2>
        <p className="muted small">{t("sandbox.remindersHelp")}</p>
        <label className="field">
          <span>{t("sandbox.remindersDate")}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
        </label>
        <button type="button" className="btn btn-block" disabled={reminders.isPending || !date} onClick={() => reminders.mutate({ date })}>
          {t("sandbox.remindersRun")}
        </button>
        {reminders.isSuccess && <p className="notice notice-ok">{t("sandbox.remindersSent", { count: reminders.data.sent })}</p>}
        {reminders.isError && <p className="notice notice-error">{t("error.generic")}</p>}
      </div>
    </section>
  );
}
