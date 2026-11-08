import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/ui";
import { applyDocumentLanguage, I18nProvider, readStoredLanguage } from "./i18n";
import { loadCatalog } from "./i18n/core";
import { errorCode } from "./lib/api";
import { ME_KEY } from "./lib/me";
import "./styles/app.css";

// Self-hosted fonts, served as separate files by serve.ts (see fonts.ts) so unicode-range only downloads what a page uses.
// The production build already links them from index.html; the dev server has no build step, so add the link here.
if (!document.querySelector('link[href^="/fonts/"]')) {
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/fonts/fonts.css" }));
}

const initialLanguage = readStoredLanguage();
applyDocumentLanguage(initialLanguage);

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // Session expired: go back to the login screen.
    onError: (error, query) => {
      if (errorCode(error) === "UNAUTHORIZED" && query.queryKey[0] !== ME_KEY[0]) queryClient.setQueryData(ME_KEY, null);
    },
  }),
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: 1 } },
});

// Fetch the saved language's catalog before the first paint (fr and en are already in the bundle).
await loadCatalog(initialLanguage);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
