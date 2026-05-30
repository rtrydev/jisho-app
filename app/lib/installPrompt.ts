"use client";

import { useEffect, useState } from "react";

// ─── Add-to-Home-Screen detection ─────────────────────────────────────
//
// Jisho is a PWA (see app/manifest.ts, `display: standalone`), but mobile
// browsers don't expose a reliable programmatic install prompt for it:
// iOS Safari has none at all, and Chrome's `beforeinstallprompt` is
// inconsistent and can't be triggered on demand. So the "Install" entry
// point is purely *instructional* — a header button that opens a
// platform-accurate walkthrough (see app/components/InstallGuide.tsx).
//
// This module answers the only two questions the header needs: *can* this
// device install (i.e. is it a phone browser tab, not already installed),
// and *which* platform's steps to show. The two checks below are pure so
// they're trivially testable; `useInstallPrompt` wires them to the live
// document.

export type InstallPlatform = "ios" | "android" | "other";

/** True when the app is running as an installed PWA rather than in a
 *  browser tab — in which case there is nothing to install and the
 *  affordance must be hidden. Covers the standards `display-mode` query
 *  (Android/desktop) and the legacy `navigator.standalone` flag (iOS
 *  Safari, which never implemented the media query). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const standaloneDisplay = window.matchMedia?.(
    "(display-mode: standalone)",
  ).matches;
  const iosStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  return Boolean(standaloneDisplay) || iosStandalone === true;
}

/** Classify a user-agent string into the platform whose Add-to-Home-Screen
 *  flow we know how to describe. Pure (takes the UA explicitly) so it can be
 *  unit-tested without stubbing globals. Note modern iPadOS Safari reports a
 *  Mac UA and therefore falls through to "other" — that's acceptable here,
 *  the affordance simply doesn't appear on those tablets. */
export function detectPlatform(ua: string): InstallPlatform {
  const s = ua.toLowerCase();
  if (/android/.test(s)) return "android";
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  return "other";
}

export type InstallState = {
  /** Whether to show the Install affordance at all. */
  available: boolean;
  /** Which walkthrough to seed. Meaningful even when `available` is false. */
  platform: InstallPlatform;
};

const INITIAL: InstallState = { available: false, platform: "other" };

/** Reactive install-availability state. Returns `{available:false}` on the
 *  server and the very first client render (so SSR markup matches and there's
 *  no hydration mismatch), then resolves the real platform after mount. It's
 *  `available` only on a mobile browser tab that isn't already installed —
 *  desktop and the installed PWA both yield `false`, so the header never shows
 *  a dead affordance. Re-checks if the display mode flips (e.g. the user
 *  installs mid-session). */
export function useInstallPrompt(): InstallState {
  const [state, setState] = useState<InstallState>(INITIAL);

  useEffect(() => {
    const compute = () => {
      const platform = detectPlatform(window.navigator.userAgent);
      const available =
        (platform === "ios" || platform === "android") && !isStandalone();
      setState({ available, platform });
    };
    compute();

    const mq = window.matchMedia?.("(display-mode: standalone)");
    mq?.addEventListener?.("change", compute);
    return () => mq?.removeEventListener?.("change", compute);
  }, []);

  return state;
}
