/** Every text of the beneficiaries' web space ("Mon espace", apps/backoffice/src/moi). Each key exists in all 28 catalogs (test-enforced). */
export const WEB_KEYS = [
  "app_title", "intro", "start_signup", "start_login", "language", "step_of", "continue", "back",
  "about_title", "about_does", "about_not", "about_keeps", "understand",
  "name_title", "name_hint", "name_placeholder", "shared_device",
  "words_title", "words_title_new", "words_hint", "words_handle", "words_saved", "open_space",
  "login_hint", "clear", "error_words", "error_locked", "error_too_many", "error_generic", "signup_closed",
  "lost_words", "lost_hint", "code_label", "unlock", "error_code",
  "hello", "tab_messages", "tab_documents", "write", "send", "send_letter", "send_document", "error_send",
  "documents_empty", "valid_until", "no_date",
  "account_number", "account_name", "sign_out", "delete_title", "delete_hint", "delete_confirm", "cancel",
] as const;
export type WebKey = (typeof WEB_KEYS)[number];
