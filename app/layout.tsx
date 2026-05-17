import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jisho · v2",
  description:
    "A quiet workspace for reading Japanese — Editorial Ink. Client-side reading assistant.",
};

// Initial data-attrs match the default settings; the SettingsProvider hydrates
// from localStorage on mount and rewrites these synchronously after.
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
      <body>{children}</body>
    </html>
  );
}
