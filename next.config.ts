import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a fully static export to `out/`. The app is client-rendered after
  // hydration (kuromoji + JMdict load in the browser), so there is nothing
  // for a Node runtime to do — S3 + CloudFront serve the bundle directly.
  output: "export",
  // Trailing slashes pair with the CloudFront URI-rewrite function:
  // `/foo/` → `/foo/index.html`, which is the layout `next build` emits.
  trailingSlash: true,
  images: {
    // The default loader needs a Node runtime; disable it for the static export.
    unoptimized: true,
  },
};

export default nextConfig;
