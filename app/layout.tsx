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
  maximumScale: 1,
  userScalable: false,
  // viewport-fit=cover lets the app paint under the iOS notch and home
  // indicator when installed as a PWA.
  viewportFit: "cover",
  // `colorScheme` opts the page in to UA defaults for the user's
  // light/dark preference — keeps form controls, scrollbars, and the
  // pre-CSS document background reasonable when the inline critical
  // CSS below is the only thing painting.
  colorScheme: "light dark",
  // OS-keyed fallback for no-JS / SSR only. The pre-hydration script below
  // (and applyStatusBarTheme on every settings change) collapses these into a
  // single OS-agnostic `theme-color` that tracks the *app* theme — the saved
  // `data-theme` can diverge from `prefers-color-scheme` (e.g. app dark on a
  // light-mode phone), and these media-keyed tags would otherwise paint the
  // status bar the wrong palette behind the loading splash.
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
// It also pins the mobile status bar to the resolved theme: it collapses the
// OS-keyed `theme-color` metas into one OS-agnostic tag and sets
// `color-scheme`, so the status bar can't flash light behind the dark splash
// when the app theme differs from the phone's `prefers-color-scheme`. This is
// the pre-paint twin of applyStatusBarTheme() in app/lib/settings.ts.
//
// The schema (storage key, payload envelope, value whitelists) is
// duplicated from app/lib/settings.ts + app/lib/storage.ts because this
// string is evaluated outside the React module graph. Keep them in
// lockstep if either side ever changes.
const SETTINGS_INIT_SCRIPT = `(function(){try{var raw=window.localStorage.getItem("jp:v2:settings");var theme="system",accent="seal",furigana="always",scale="M";if(raw){var p=JSON.parse(raw);if(p&&p.data&&typeof p.data==="object"){var d=p.data;if(d.theme==="light"||d.theme==="dark"||d.theme==="sepia"||d.theme==="system")theme=d.theme;if(d.accent==="seal"||d.accent==="indigo"||d.accent==="sumi")accent=d.accent;if(d.furiganaMode==="always"||d.furiganaMode==="hover"||d.furiganaMode==="off")furigana=d.furiganaMode;if(d.japaneseFontScale==="S"||d.japaneseFontScale==="M"||d.japaneseFontScale==="L")scale=d.japaneseFontScale;}}var resolved=theme;if(theme==="system"){resolved=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}var r=document.documentElement;r.dataset.theme=resolved;r.dataset.accent=accent;r.dataset.furigana=furigana;r.dataset.jpScale=scale;var tc=resolved==="dark"?"#161513":"#f3ede0";var ms=document.querySelectorAll('meta[name="theme-color"]');for(var i=ms.length-1;i>=0;i--){if(i===0){ms[i].removeAttribute("media");}else{ms[i].parentNode.removeChild(ms[i]);}}var m=document.querySelector('meta[name="theme-color"]');if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");document.head.appendChild(m);}m.setAttribute("content",tc);r.style.colorScheme=resolved==="dark"?"dark":"light";var isMobile=window.matchMedia&&window.matchMedia("(max-width: 820px)").matches;r.dataset.platform=isMobile?"mobile":"desktop";}catch(e){}})();`;

// Pre-app splash overlay — the parchment veil with a spinning ruled ring, the
// vermilion 辞書 hanko, and "Loading dictionary…" that shows on cold load and
// is removed once the engine is ready (see app/lib/splash.ts).
//
// This is plain inline CSS, NOT a design-system component, on purpose: it must
// paint in the browser's *first* style pass — before the Next.js CSS bundle,
// the woff2 fonts, or any JS chunk has loaded. A React-rendered splash can't,
// since React has to download + hydrate first, which is the exact delay we're
// papering over. So the markup, styles, and shown-at stamp are written
// straight into the served HTML here. This is the one sanctioned exception to
// the "use the design system" rule — the design system literally isn't loaded
// yet, so Hanko / tokens / font-* utilities are unavailable.
//
// The palette below is HAND-MIRRORED from app/globals.css (same class of
// duplication as SETTINGS_INIT_SCRIPT re-encoding the prefs schema): it can't
// reference the design tokens because globals.css ships in the not-yet-loaded
// bundle. Keys, keyed off the same `data-theme` / `data-accent` contract:
//   --splash-bg   ← --paper       --splash-ink  ← --ink-soft
//   --splash-line ← --line        --splash-ring ← --seal (per accent)
// If any of those tokens change in globals.css, update these literals too, or
// the splash will flash stale colors before the bundle takes over. The bg
// values also match `themeColor` in `viewport` and CRITICAL_CSS above.
const SPLASH_STYLES = `
:root,[data-theme="light"]{--splash-bg:#f3ede0;--splash-ink:#4a4334;--splash-line:#d4c8aa;--splash-ring:#b73a2a}
[data-theme="dark"]{--splash-bg:#161513;--splash-ink:#b8b09c;--splash-line:#2d2a23;--splash-ring:#d24a38}
[data-accent="indigo"]{--splash-ring:#34568b}
[data-accent="sumi"]{--splash-ring:#1c1a14}
[data-theme="dark"][data-accent="indigo"]{--splash-ring:#8aa3cf}
[data-theme="dark"][data-accent="sumi"]{--splash-ring:#ebe4d2}
#jisho-splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:var(--splash-bg);padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);opacity:1;transition:opacity .42s ease;-webkit-font-smoothing:antialiased}
#jisho-splash[data-leaving="true"]{opacity:0}
#jisho-splash .jsp-stack{position:relative;width:80px;height:80px;display:flex;align-items:center;justify-content:center}
#jisho-splash .jsp-ring{position:absolute;inset:0;border-radius:50%;border:2px solid var(--splash-line);border-top-color:var(--splash-ring);animation:jsp-spin .9s linear infinite}
#jisho-splash .jsp-mark{width:50px;height:50px;display:flex;align-items:center;justify-content:center;background:var(--splash-ring);color:#fbf6e9;font-family:"Hiragino Mincho ProN","Yu Mincho","Yu Mincho Light","Noto Serif CJK JP","Noto Serif JP",serif;font-weight:700;font-size:19px;letter-spacing:-0.04em;line-height:1;border-radius:5px;transform:rotate(-3.5deg);box-shadow:inset 0 0 0 1.5px rgba(0,0,0,0.22),inset 1px 1px 4px rgba(255,255,255,0.18),inset -1px -2px 5px rgba(0,0,0,0.20);animation:jsp-pulse 1.7s ease-in-out infinite}
#jisho-splash .jsp-caption{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-size:13px;font-weight:500;letter-spacing:0.06em;color:var(--splash-ink)}
@keyframes jsp-spin{to{transform:rotate(360deg)}}
@keyframes jsp-pulse{0%,100%{transform:rotate(-3.5deg) scale(1);opacity:1}50%{transform:rotate(-3.5deg) scale(.94);opacity:.86}}
@keyframes jsp-caption-pulse{0%,100%{opacity:1}50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){
  #jisho-splash .jsp-ring{animation:none}
  #jisho-splash .jsp-mark{animation:none}
  #jisho-splash .jsp-caption{animation:jsp-caption-pulse 1.6s ease-in-out infinite}
}
`;

// Stamps the moment the splash became visible so useSplashRemoval can enforce
// SPLASH_MIN_VISIBLE_MS. Runs synchronously right after the node is parsed —
// performance.now() shares the navigation time origin the hook reads from.
const SPLASH_INIT_SCRIPT = `(function(){var s=document.getElementById("jisho-splash");if(s){s.dataset.shownAt=String(performance.now());}})();`;

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
        {/* Inline splash styles — palette mirrored from globals.css so the
            overlay is theme/accent-correct from the first paint. */}
        <style
          id="jisho-splash-style"
          dangerouslySetInnerHTML={{ __html: SPLASH_STYLES }}
        />
      </head>
      <body>
        {/* Pre-app splash veil. Painted from the served HTML so it's on
            screen the instant the document arrives; useSplashRemoval (driven
            by the engine load status) fades + removes it once ready. The ring
            and seal are decorative; the live region's name is the caption. */}
        <div
          id="jisho-splash"
          role="status"
          aria-live="polite"
          aria-busy="true"
          data-shown-at="0"
        >
          <div className="jsp-stack">
            <div className="jsp-ring" aria-hidden="true" />
            <div className="jsp-mark" aria-hidden="true">
              辞書
            </div>
          </div>
          <div className="jsp-caption">Loading dictionary…</div>
        </div>
        <script
          id="jisho-splash-init"
          dangerouslySetInnerHTML={{ __html: SPLASH_INIT_SCRIPT }}
        />
        {children}
      </body>
    </html>
  );
}
