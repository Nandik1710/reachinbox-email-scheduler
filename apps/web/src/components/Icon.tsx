import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "clock"
  | "send"
  | "search"
  | "filter"
  | "refresh"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "upload"
  | "calendar"
  | "close"
  | "bold"
  | "italic"
  | "underline"
  | "align"
  | "list"
  | "quote"
  | "link"
  | "strikethrough"
  | "sliders"
  | "expand"
  | "google";

const paths: Record<IconName, ReactNode> = {
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  send: <path d="m3 4 18 8-18 8 3.5-8L3 4Zm3.5 8H21" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  filter: <path d="M4 5h16l-6.2 7v5l-3.6 2v-7L4 5Z" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.8-3L4 10m0-4v4h4m-4 2a8 8 0 0 0 14.8 3L20 14m0 4v-4h-4" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4h14v-4" />,
  calendar: <path d="M5 6h14v13H5zM8 3v6m8-6v6M5 10h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  bold: (
    <path d="M8 4h5a4 4 0 0 1 1.1 7.8A4 4 0 0 1 13 20H8V4Zm0 7h4.5a3 3 0 0 0 0-6H8m0 12h5a3 3 0 0 0 0-6H8" />
  ),
  italic: <path d="M10 4h8M6 20h8m-3-16L7 20" />,
  underline: <path d="M7 4v6a5 5 0 0 0 10 0V4M5 20h14" />,
  align: <path d="M5 6h14M5 10h10M5 14h14M5 18h10" />,
  list: <path d="M9 6h10M9 12h10M9 18h10M5 6h.01M5 12h.01M5 18h.01" />,
  quote: <path d="M9 10H5v5h4v-5Zm10 0h-4v5h4v-5ZM5 15v2m10-2v2" />,
  link: (
    <path d="m10 13 4-4a3 3 0 0 1 4 4l-2 2a3 3 0 0 1-4 0m-2-5-2 2a3 3 0 0 1-4-4l2-2a3 3 0 0 1 4 0m-4 4h8" />
  ),
  strikethrough: <path d="M5 12h14M8 7c0-2 8-3 8 1 0 1.5-1 2.3-2.2 3M8 17c0 2 8 3 8-1" />,
  sliders: <path d="M4 7h16M4 17h16M8 4v6m8 4v6" />,
  expand: <path d="M9 4H4v5m11-5h5v5M9 20H4v-5m11 5h5v-5" />,
  google: (
    <path d="M21 12.2c0-.7-.1-1.4-.2-2H12v3.8h5a4.3 4.3 0 0 1-1.9 2.8v2.3h3.1c1.8-1.7 2.8-4.1 2.8-6.9Z" />
  ),
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
