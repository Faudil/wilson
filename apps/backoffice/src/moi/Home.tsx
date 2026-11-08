import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LanguageCode, Me, MeMessage } from "@wilson/contracts";
import { LANGUAGE_CODES, LANGUAGES } from "@wilson/contracts/values";
import mark from "../brand/mark.svg";
import { client } from "../lib/api";
import { documentTypeName, formatDate } from "../lib/wilson-i18n";
import { ME_KEY } from "./keys";
import { useT } from "./i18n";

type Tab = "messages" | "documents" | "space";
const THREAD_KEY = ["moi", "thread"] as const;

/** Menus come as buttons: their "N - …" lines are not repeated in the text (as on WhatsApp). */
const withoutOptionLines = (text: string): string =>
  text.split("\n").filter((l) => !/^[‎‏\s]*\d{1,2}\s*-\s/.test(l)).join("\n").trim();

export function Home({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const { t, lang, setLang } = useT();
  const [tab, setTab] = useState<Tab>("messages");
  // The space speaks the language the person chose for Wilson (they may change it on the "My space" tab).
  useEffect(() => {
    if (me.language !== lang) setLang(me.language);
  }, [me.language]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="moi-shell moi-home">
      <header className="moi-top">
        <span className="moi-brand"><img src={mark} alt="" width={28} height={28} /> {t("hello", { name: me.name })}</span>
      </header>
      <main className="moi-main moi-main-home">
        {tab === "messages" && <Messages />}
        {tab === "documents" && <Documents />}
        {tab === "space" && <Space me={me} onSignedOut={onSignedOut} />}
      </main>
      <nav className="moi-tabs" aria-label={t("app_title")}>
        {([["messages", "💬", t("tab_messages")], ["documents", "📁", t("tab_documents")], ["space", "👤", t("app_title")]] as const).map(([k, icon, label]) => (
          <button key={k} type="button" className={`moi-tab ${tab === k ? "is-current" : ""}`} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
            <span aria-hidden="true">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Messages() {
  const { t, dir } = useT();
  const qc = useQueryClient();
  // Answers come later (a volunteer checks letter explanations): look again every few seconds while the page is open.
  const thread = useQuery({ queryKey: THREAD_KEY, queryFn: () => client.me.thread(), refetchInterval: 4000 });
  const [text, setText] = useState("");
  const letterInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const send = useMutation({
    mutationFn: (input: { text?: string; file?: File; fileKind?: "letter" | "document" }) => client.me.send(input),
    onSuccess: (_d, input) => {
      if (input.text) setText("");
      return qc.invalidateQueries({ queryKey: THREAD_KEY });
    },
  });
  const endRef = useRef<HTMLDivElement>(null);
  const count = thread.data?.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const pick = (kind: "letter" | "document") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) send.mutate({ file, fileKind: kind });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) send.mutate({ text: text.trim() });
  };
  const lastChoices = thread.data?.at(-1)?.choices ?? [];

  return (
    <div className="moi-chat">
      <div className="moi-thread" aria-live="polite">
        {thread.data?.map((m) => <Bubble key={m.id} m={m} dir={dir} />)}
        {lastChoices.length > 0 && (
          <div className="moi-choices">
            {lastChoices.map((c) => (
              <button key={c.id} type="button" className="moi-choice" disabled={send.isPending} onClick={() => send.mutate({ text: c.id })}>{c.title}</button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="moi-composer">
        <div className="moi-quick">
          <button type="button" className="btn moi-quick-btn" disabled={send.isPending} onClick={() => letterInput.current?.click()}>
            <span aria-hidden="true">📷</span> {t("send_letter")}
          </button>
          <button type="button" className="btn moi-quick-btn" disabled={send.isPending} onClick={() => documentInput.current?.click()}>
            <span aria-hidden="true">📄</span> {t("send_document")}
          </button>
          <input ref={letterInput} type="file" accept="image/*,application/pdf" hidden onChange={pick("letter")} />
          <input ref={documentInput} type="file" accept="image/*,application/pdf" hidden onChange={pick("document")} />
        </div>
        {send.error && <p className="notice notice-error" role="alert">{t("error_send")}</p>}
        <form className="moi-write" onSubmit={submit}>
          <textarea className="moi-input" rows={1} value={text} maxLength={2000} placeholder={t("write")} aria-label={t("write")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }} />
          <button type="submit" className="btn btn-primary moi-send" disabled={!text.trim() || send.isPending} aria-label={t("send")}>
            <span aria-hidden="true" className="moi-send-icon">➤</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function Bubble({ m, dir }: { m: MeMessage; dir: "ltr" | "rtl" }) {
  const text = m.text ? (m.choices.length ? withoutOptionLines(m.text) : m.text) : "";
  if (!text) return null;
  return (
    <div className={`moi-bubble ${m.direction === "inbound" ? "moi-bubble-me" : "moi-bubble-wilson"}`} dir="auto">
      <p>{text}</p>
      <time dateTime={m.at}>{new Date(m.at).toLocaleTimeString(dir === "rtl" ? undefined : [], { hour: "2-digit", minute: "2-digit" })}</time>
    </div>
  );
}

function Documents() {
  const { t, lang } = useT();
  const docs = useQuery({ queryKey: ["moi", "documents"], queryFn: () => client.me.documents() });
  if (docs.isPending) return <div className="moi-boot" aria-busy="true" />;
  if (!docs.data?.length) return <p className="moi-empty">📁<br />{t("documents_empty")}</p>;
  return (
    <ul className="moi-docs">
      {docs.data.map((d) => (
        <li key={d.id} className="moi-doc">
          <span className="moi-doc-icon" aria-hidden="true">📄</span>
          <div>
            <strong>{documentTypeName(d.type, lang)}</strong>
            <span className="muted">{d.expiresAt ? t("valid_until", { date: formatDate(d.expiresAt, lang) }) : t("no_date")}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Space({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const setLanguage = useMutation({
    mutationFn: (language: LanguageCode) => client.me.setLanguage({ language }),
    onSuccess: (m) => qc.setQueryData(ME_KEY, m),
  });
  const logout = useMutation({ mutationFn: () => client.me.logout(), onSettled: () => { qc.clear(); onSignedOut(); } });
  const remove = useMutation({ mutationFn: () => client.me.deleteAll(), onSuccess: () => { qc.clear(); onSignedOut(); } });

  return (
    <div className="moi-space">
      <dl className="moi-facts">
        <div><dt>{t("account_name")}</dt><dd>{me.name}</dd></div>
        <div><dt>{t("account_number")}</dt><dd className="moi-handle-big" dir="ltr">{me.handle}</dd></div>
      </dl>
      <label className="field">
        <span className="field-label">🌐 {t("language")}</span>
        <select className="moi-input" value={me.language} onChange={(e) => setLanguage.mutate(e.target.value as LanguageCode)}>
          {LANGUAGE_CODES.map((c) => <option key={c} value={c} lang={c}>{LANGUAGES[c].nativeName}</option>)}
        </select>
      </label>
      <p className="moi-assoc-contact">{me.associationName} · <span dir="ltr">{me.associationContact}</span></p>
      <button type="button" className="btn btn-block btn-lg" onClick={() => logout.mutate()}>{t("sign_out")}</button>
      {!confirm ? (
        <button type="button" className="btn btn-block moi-danger-link" onClick={() => setConfirm(true)}>{t("delete_title")}</button>
      ) : (
        <div className="notice notice-warn moi-confirm" role="alertdialog">
          <p><strong>{t("delete_title")}</strong></p>
          <p>{t("delete_hint")}</p>
          <button type="button" className="btn btn-danger btn-block" disabled={remove.isPending} onClick={() => remove.mutate()}>{t("delete_confirm")}</button>
          <button type="button" className="btn btn-block" onClick={() => setConfirm(false)}>{t("cancel")}</button>
        </div>
      )}
    </div>
  );
}
