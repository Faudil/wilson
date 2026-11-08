import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import "../styles/app.css";
import "./moi.css";

// Self-hosted fonts (see ../main.tsx): the production build links them from moi.html, the dev server does not.
if (!document.querySelector('link[href^="/fonts/"]')) {
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/fonts/fonts.css" }));
}

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
