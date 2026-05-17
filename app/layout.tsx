import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jisho · Editorial Ink",
  description:
    "Jisho v2 design system — Editorial Ink. A client-side Japanese reading assistant.",
};

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
    >
      <body>{children}</body>
    </html>
  );
}
