import type { Metadata, Viewport } from "next";
import { EB_Garamond, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// `next/font/google` downloads each woff2 at BUILD time and bundles the
// @font-face rules into the same Next.js stylesheet that's served from
// our origin. The browser blocks first paint on that one same-origin
// CSS file (parallel with the HTML download), eliminating the
// render-blocking third-party request to fonts.googleapis.com — that
// request was the visible white frame on mobile cold reload.
//
// Noto Serif JP is intentionally NOT included here: `next/font/google`
// does not support its `japanese` subset, so bundling it would ship
// Latin glyphs we don't need and STILL miss the actual JP coverage.
// Japanese characters fall through to the system Mincho fonts listed
// in `--f-jp` in `globals.css` (Hiragino Mincho ProN on iOS/macOS,
// Yu Mincho on Windows, Noto Serif CJK on Android), which all match
// the design's serif tone.
const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});
const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Jisho",
  description:
    "A quiet workspace for reading Japanese — Editorial Ink. Client-side reading assistant.",
  applicationName: "Jisho",
  appleWebApp: {
    capable: true,
    title: "Jisho",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover lets the app paint under the iOS notch and home
  // indicator when installed as a PWA.
  viewportFit: "cover",
  // `colorScheme` opts the page in to UA defaults for the user's
  // light/dark preference — keeps form controls, scrollbars, and the
  // pre-CSS document background reasonable when the inline critical
  // CSS below is the only thing painting.
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3ede0" },
    { media: "(prefers-color-scheme: dark)", color: "#161513" },
  ],
};

// Critical CSS inlined into <head>. The browser blocks first paint on
// the external stylesheet (it's `<link rel=stylesheet>`, render-blocking
// by default), but the moment that link resolves the document has to
// paint *something* — and on a cold reload on mobile Safari we were
// getting a white frame between the browser unloading the old page and
// the new CSS being applied. Setting the html/body background here makes
// the first painted pixel already match the theme.
//
// The pre-hydration script below sets `data-theme` on `<html>` BEFORE
// either this style block or the external stylesheet applies, so the
// `[data-theme="dark"]` selector picks up the dark palette on the very
// first paint when the user has chosen dark mode.
const CRITICAL_CSS = `
html { background: #f3ede0; color: #1c1a14; }
html[data-theme="dark"] { background: #161513; color: #ebe4d2; }
body { background: inherit; color: inherit; margin: 0; }
`;

// Pre-hydration init script. Inlined into <head> so it runs synchronously
// while the HTML is parsed — *before* any paint — and applies the user's
// persisted theme/accent/furigana/scale directly to <html>. Without this,
// the page would flash the SSR defaults (light + seal + always + M) on
// every reload until SettingsProvider re-applied the saved settings.
//
// The schema (storage key, payload envelope, value whitelists) is
// duplicated from app/lib/settings.ts + app/lib/storage.ts because this
// string is evaluated outside the React module graph. Keep them in
// lockstep if either side ever changes.
const SETTINGS_INIT_SCRIPT = `(function(){try{var raw=window.localStorage.getItem("jp:v2:settings");var theme="system",accent="seal",furigana="always",scale="M";if(raw){var p=JSON.parse(raw);if(p&&p.data&&typeof p.data==="object"){var d=p.data;if(d.theme==="light"||d.theme==="dark"||d.theme==="sepia"||d.theme==="system")theme=d.theme;if(d.accent==="seal"||d.accent==="indigo"||d.accent==="sumi")accent=d.accent;if(d.furiganaMode==="always"||d.furiganaMode==="hover"||d.furiganaMode==="off")furigana=d.furiganaMode;if(d.japaneseFontScale==="S"||d.japaneseFontScale==="M"||d.japaneseFontScale==="L")scale=d.japaneseFontScale;}}var resolved=theme;if(theme==="system"){resolved=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}var r=document.documentElement;r.dataset.theme=resolved;r.dataset.accent=accent;r.dataset.furigana=furigana;r.dataset.jpScale=scale;var isMobile=window.matchMedia&&window.matchMedia("(max-width: 820px)").matches;r.dataset.platform=isMobile?"mobile":"desktop";}catch(e){}})();`;

// Initial data-attrs match the default settings; the inline script above
// overrides them synchronously before paint when a saved profile exists,
// and SettingsProvider re-hydrates after mount.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-accent="seal"
      data-furigana="always"
      data-jp-scale="M"
      className={`${ebGaramond.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Pre-hydration script runs FIRST — it sets `data-theme` on
            <html> before either the inline critical CSS or any other
            stylesheet applies, so dark-mode users never see a light flash. */}
        <script
          id="jisho-settings-init"
          dangerouslySetInnerHTML={{ __html: SETTINGS_INIT_SCRIPT }}
        />
        {/* Inline critical CSS — paints the document background in the
            paper / ink palette on first frame, before the Next.js
            same-origin stylesheet finishes parsing. */}
        <style
          id="jisho-critical-css"
          dangerouslySetInnerHTML={{ __html: CRITICAL_CSS }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
