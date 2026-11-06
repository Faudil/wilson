import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyDocumentLanguage, I18nProvider, readStoredLanguage } from "./i18n";
import { errorCode } from "./lib/api";
import { ME_KEY } from "./lib/me";
import "./styles/fonts.css";
import "./styles/app.css";

applyDocumentLanguage(readStoredLanguage());

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // Session expired: go back to the login screen.
    onError: (error, query) => {
      if (errorCode(error) === "UNAUTHORIZED" && query.queryKey[0] !== ME_KEY[0]) queryClient.setQueryData(ME_KEY, null);
    },
  }),
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
