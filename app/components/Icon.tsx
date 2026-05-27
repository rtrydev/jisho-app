import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function withDefaults({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    ...rest,
  };
}

export const Read = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <path d="M3 5.5c2-1 5-1.5 7.5-1 .8.2 1.5.5 1.5 1.2v13c0-.7-.7-1-1.5-1.2-2.5-.5-5.5 0-7.5 1V5.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    <path d="M21 5.5c-2-1-5-1.5-7.5-1-.8.2-1.5.5-1.5 1.2v13c0-.7.7-1 1.5-1.2 2.5-.5 5.5 0 7.5 1V5.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
  </svg>
);

export const History = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M3 4v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 7v5.5l3.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/** Outlined seal frame containing 印 (in / seal). Matches the outlined
 *  stroke style of the other tab icons (Read, Kanji, History, Settings)
 *  while keeping the seal/hanko semantic for favorites. Same viewBox /
 *  type weight / character size as the Kanji icon's 字, so the two
 *  destinations read as a matched pair. */
export const Favorites = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.4"
      fill="none"
    />
    <text
      x="12"
      y="18"
      textAnchor="middle"
      fontFamily='"Noto Serif JP", serif'
      fontSize="14"
      fontWeight="700"
      fill="currentColor"
    >
      印
    </text>
  </svg>
);

export const Settings = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <path
      d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.59-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.48-.41h-3.84a.5.5 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.5.5 0 0 0-.59.22L2.74 8.87a.5.5 0 0 0 .12.61l2.03 1.58c-.05.3-.09.62-.09.94 0 .31.02.64.07.94L2.84 14.52a.5.5 0 0 0-.12.61l1.92 3.32a.5.5 0 0 0 .59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54a.5.5 0 0 0 .48.41h3.84a.5.5 0 0 0 .47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96a.5.5 0 0 0 .59-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.01-1.58z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      fill="none"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.3" fill="none"/>
  </svg>
);

export const Search = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export const Close = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export const Trash = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 12.5a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9L17.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const Share = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <circle cx="6" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.4"/>
    <circle cx="17" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.4"/>
    <circle cx="17" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M8 11l7-4M8 13l7 4" stroke="currentColor" strokeWidth="1.4"/>
  </svg>
);

export const Copy = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <rect x="5" y="5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M9 2.5h9A2 2 0 0 1 20 4.5v9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

export const Collapse = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const Play = (p: IconProps) => (
  <svg {...withDefaults({ ...p, viewBox: "0 0 14 14" })}>
    <path d="M4 3l7 4-7 4V3z" fill="currentColor"/>
  </svg>
);

export const Check = (p: IconProps) => (
  <svg {...withDefaults({ ...p, viewBox: "0 0 14 14" })}>
    <path d="M3 7.5L6 10.5L11 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const ShareArrow = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <path d="M12 3v9M8 7L12 3L16 7M5 12v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export const Seal = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <svg {...withDefaults({ ...p, viewBox: "0 0 14 14" })}>
    <rect
      x="2.2" y="2.2" width="9.6" height="9.6" rx="1.6"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.2"
    />
    {filled && (
      <text x="7" y="9.6" textAnchor="middle"
            fontFamily='"Noto Serif JP", serif'
            fontSize="6.5" fontWeight="700"
            fill="var(--paper-card)">印</text>
    )}
  </svg>
);

export const Brush = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <path d="M15.5 4.5l4 4-8.5 8.5-4-4 8.5-8.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    <path d="M7 13l4 4-1.5 1.5a3 3 0 0 1-4-4L7 13z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    <path d="M14 6l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
);

export const Undo = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <path d="M9 7L4.5 11.5L9 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4.5 11.5h9a5 5 0 0 1 5 5v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

export const Info = (p: IconProps) => (
  <svg {...withDefaults({ ...p, viewBox: "0 0 14 14" })}>
    <circle cx="7" cy="7" r="5.4" stroke="currentColor" strokeWidth="1.2" fill="none"/>
    <circle cx="7" cy="4.2" r="0.9" fill="currentColor"/>
    <path d="M7 6.2v4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
);

/** Character-square frame with the literal kanji 字 inside. The glyph is
 *  large enough relative to the viewBox to stay legible at 20px tab size,
 *  and the serif weight matches the surrounding type. Distinct from the
 *  Favorites hanko (which has no text) at small sizes. */
export const Kanji = (p: IconProps) => (
  <svg {...withDefaults(p)}>
    <rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.4"
      fill="none"
    />
    <text
      x="12"
      y="18"
      textAnchor="middle"
      fontFamily='"Noto Serif JP", serif'
      fontSize="14"
      fontWeight="700"
      fill="currentColor"
    >
      字
    </text>
  </svg>
);

export const Icon = {
  Read, History, Favorites, Settings, Search, Close,
  Trash, Share, Copy, Collapse, Play, Check, ShareArrow, Seal,
  Brush, Undo, Info, Kanji,
};
