import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3ede0" },
    { media: "(prefers-color-scheme: dark)", color: "#161513" },
  ],
};

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
const SETTINGS_INIT_SCRIPT = `(function(){try{var raw=window.localStorage.getItem("jp:v2:settings");var theme="system",accent="seal",furigana="always",scale="M";if(raw){var p=JSON.parse(raw);if(p&&p.data&&typeof p.data==="object"){var d=p.data;if(d.theme==="light"||d.theme==="dark"||d.theme==="sepia"||d.theme==="system")theme=d.theme;if(d.accent==="seal"||d.accent==="indigo"||d.accent==="sumi")accent=d.accent;if(d.furiganaMode==="always"||d.furiganaMode==="hover"||d.furiganaMode==="off")furigana=d.furiganaMode;if(d.japaneseFontScale==="S"||d.japaneseFontScale==="M"||d.japaneseFontScale==="L")scale=d.japaneseFontScale;}}var resolved=theme;if(theme==="system"){resolved=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}var r=document.documentElement;r.dataset.theme=resolved;r.dataset.accent=accent;r.dataset.furigana=furigana;r.dataset.jpScale=scale;}catch(e){}})();`;

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
      suppressHydrationWarning
    >
      <head>
        <script
          id="jisho-settings-init"
          dangerouslySetInnerHTML={{ __html: SETTINGS_INIT_SCRIPT }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
