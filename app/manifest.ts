import type { MetadataRoute } from "next";

// Required for the metadata file route to be emitted as a static asset
// rather than a server route under `output: "export"`.
export const dynamic = "force-static";

// Web App Manifest. Next.js emits this at /manifest.webmanifest and adds
// the matching <link rel="manifest"> tag to every page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jisho · 辞書",
    short_name: "Jisho",
    description:
      "A quiet workspace for reading Japanese. Editorial Ink. Offline-first, client-side reading assistant.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "ja",
    // Paper (--paper, light theme). Matches the splash screen the browser
    // paints before the app boots; the in-app pre-hydration script then
    // swaps `data-theme` if the user has chosen dark.
    background_color: "#f3ede0",
    theme_color: "#f3ede0",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
