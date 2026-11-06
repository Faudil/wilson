import { useEffect, useState } from "react";

/** Hand-written hash router: "#/letters/<id>" → ["letters", "<id>"]. */
export function parseHash(hash: string): string[] {
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

export function useRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return parseHash(hash);
}

export function href(...parts: string[]): string {
  return `#/${parts.map(encodeURIComponent).join("/")}`;
}

export function navigate(...parts: string[]): void {
  window.location.hash = href(...parts);
}
