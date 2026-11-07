import type { SVGProps } from "react";

/** Small stroke icon set in the Lucide style (24x24 grid, 2px round strokes). Written by hand, no dependency. */
const PATHS = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5",
  mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3 7l9 6 9-6",
  chat: "M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5A8.4 8.4 0 1 1 21 11.5Z",
  users: "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1.5a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
  user: "M19 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-5A4.5 4.5 0 0 0 5 19.5V21M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  calendar: "M8 2v4M16 2v4M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z",
  book: "M4 19.5V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 6 21.5h13M8.5 7.5h6",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.500 5.500 12 3Z",
  flask: "M9 3h6M10 3v6.2L4.600 18a2 2 0 0 0 1.700 3h11.400a2 2 0 0 0 1.700-3L14 9.200V3M7.500 14.500h9",
  chevron: "m9 6 6 6-6 6",
  chevronDown: "m6 9 6 6 6-6",
  arrow: "M19 12H5m6-6-6 6 6 6",
  arrowRight: "M5 12h14m-6-6 6 6-6 6",
  check: "m5 12.500 4.500 4.500L19 7.500",
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-3.500-9 2.500 2.500 4.500-5",
  x: "M6 6l12 12M18 6 6 18",
  alert: "M10.300 3.900 2.400 17.500A2 2 0 0 0 4.100 20.500h15.800a2 2 0 0 0 1.700-3L13.700 3.900a2 2 0 0 0-3.400 0ZM12 9.500v4M12 17h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM21 21l-4.300-4.300",
  send: "M21.500 2.500 10.500 13.500M21.500 2.500l-7 19-4-8.500-8.500-4 19.500-6.500Z",
  edit: "M4 20h4L19.500 8.500a2.100 2.100 0 0 0-3-3L5 17v3ZM14.500 7.500l3 3",
  eye: "M2 12s3.500-7 10-7 10 7 10 7-3.500 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  image: "M5 3.500h14a1.500 1.500 0 0 1 1.500 1.500v14a1.500 1.500 0 0 1-1.500 1.500H5A1.500 1.500 0 0 1 3.500 19V5A1.500 1.500 0 0 1 5 3.500ZM8.500 10a1.500 1.500 0 1 0 0-3 1.500 1.500 0 0 0 0 3ZM20.500 15.500l-5-5-9 10",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h6",
  zoom: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM21 21l-4.300-4.300M11 8v6M8 11h6",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  bot: "M12 8V4M8 4h8M5 8h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM9 13v2M15 13v2",
  phone: "M7 2.500h10a1.500 1.500 0 0 1 1.500 1.500v16a1.500 1.500 0 0 1-1.500 1.500H7A1.500 1.500 0 0 1 5.500 20V4A1.500 1.500 0 0 1 7 2.500ZM11 18.500h2",
  archive: "M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4",
  refresh: "M20 11a8 8 0 0 0-14.500-3.500L3 10M3 4v6h6M4 13a8 8 0 0 0 14.500 3.500L21 14M21 20v-6h-6",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9ZM10.300 21a1.900 1.900 0 0 0 3.400 0",
  megaphone: "M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1ZM17 9a4 4 0 0 1 0 6M19.500 6.500a7.500 7.500 0 0 1 0 11",
  building: "M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M15 9h3a1 1 0 0 1 1 1v11M3 21h18M9 7h2M9 11h2M9 15h2",
  chart: "M3 3v18h18M8 17v-4M13 17V8M18 17v-7",
  hash: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  more: "M12 6h.01M12 12h.01M12 18h.01",
  sparkles: "M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800L12 3ZM19 16l.8 2.200L22 19l-2.200.8L19 22l-.8-2.200L16 19l2.200-.8L19 16Z",
  hand: "M8 13V5.500a1.500 1.500 0 0 1 3 0V11M11 10V4a1.500 1.500 0 0 1 3 0v6M14 10V5.500a1.500 1.500 0 0 1 3 0V13M17 9a1.500 1.500 0 0 1 3 0v5a7 7 0 0 1-7 7h-1.200a7 7 0 0 1-5.500-2.600L3.500 14.800a1.600 1.600 0 0 1 2.400-2.100L8 15",
  shield: "M12 3l8 3v6c0 4.500-3.200 8-8 9-4.800-1-8-4.500-8-9V6l8-3Zm-3.500 9 2.500 2.500 4.500-5",
  link: "M10 14a4.500 4.500 0 0 0 6.400 0l3-3a4.500 4.500 0 0 0-6.400-6.400l-1 1M14 10a4.500 4.500 0 0 0-6.400 0l-3 3a4.500 4.500 0 0 0 6.400 6.400l1-1",
  plus: "M12 5v14M5 12h14",
  undo: "M9 14 4 9l5-5M4 9h10.500a5.500 5.500 0 0 1 0 11H11",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3",
  eyeOff: "M3 3l18 18M10.600 5.100A9.500 9.500 0 0 1 12 5c6.500 0 10 7 10 7a17 17 0 0 1-3 3.900M6.600 6.600A16.800 16.800 0 0 0 2 12s3.500 7 10 7a9.500 9.500 0 0 0 4.400-1.100M9.900 9.900a3 3 0 0 0 4.200 4.200",
  paperclip: "M21 11.500 12.500 20a5.500 5.500 0 0 1-7.800-7.800l8.500-8.500a3.700 3.700 0 0 1 5.200 5.200L10 17.400a1.900 1.900 0 0 1-2.600-2.600l7.800-7.800",
} as const;

export type IconName = keyof typeof PATHS;
/** Icons that point somewhere and therefore flip in right-to-left languages. */
const DIRECTIONAL = new Set<IconName>(["chevron", "arrow", "arrowRight", "send", "undo", "logout"]);

export function Icon({ name, size = 20, className = "", ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  const dotted = name === "more";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={dotted ? 2.6 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`icon${DIRECTIONAL.has(name) ? " icon-dir" : ""}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
