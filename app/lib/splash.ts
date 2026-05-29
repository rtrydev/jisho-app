"use client";

// Removal side of the pre-app splash. The *render* side lives in
// app/layout.tsx, which writes the splash node + inline styles directly into
// the served HTML so it paints in the browser's first style-and-layout pass —
// before this module (or any other JS chunk / the CSS bundle) is fetched.
// This hook only ever *removes* that node; it never creates one.
//
// Keep SPLASH_ELEMENT_ID in lockstep with the `id` on the splash <div> in
// app/layout.tsx.

import { useEffect } from "react";

/** Matches the `id` of the splash overlay rendered statically in app/layout.tsx. */
export const SPLASH_ELEMENT_ID = "jisho-splash";

/**
 * Floor on total on-screen time. A returning visitor on a warm cache can
 * resolve the engine in well under 50 ms; without a floor the spinner would
 * pop in and out faster than the eye can parse and read as a glitch rather
 * than a deliberate splash. Measured against `data-shown-at`, so a slow cold
 * load that already spent longer than this on screen fades immediately.
 */
export const SPLASH_MIN_VISIBLE_MS = 150;

/**
 * Hard upper bound on the fade-out. `transitionend` is the primary removal
 * signal; this fires as a fallback when that event is suppressed — a
 * background tab, `prefers-reduced-motion` collapsing the transition, or the
 * transition being cancelled by something setting `display:none` higher up.
 */
export const SPLASH_FADE_SAFETY_MS = 600;

/**
 * Fade out and remove the splash overlay once the app is no longer loading.
 *
 * `loadingComplete` is the single gate: pass `false` while the heavy client
 * engine is still initializing and `true` the moment it has resolved — on
 * success *or* failure. The splash is a loading veil, not an error screen, so
 * a load failure tears it down too and lets the app's own error UI show
 * through. Safe to call on every render: it no-ops while loading and no-ops
 * once the node is already gone.
 */
export function useSplashRemoval(loadingComplete: boolean): void {
  useEffect(() => {
    if (!loadingComplete) return;
    if (typeof document === "undefined") return;
    const node = document.getElementById(SPLASH_ELEMENT_ID);
    if (!node) return;

    let removed = false;
    let fadeTimer = 0;
    let safetyTimer = 0;

    const remove = () => {
      if (removed) return;
      removed = true;
      window.clearTimeout(safetyTimer);
      node.removeEventListener("transitionend", remove);
      node.remove();
    };

    const beginFade = () => {
      // CSS transitions opacity → 0 off this attribute (see SPLASH_STYLES).
      node.dataset.leaving = "true";
      node.addEventListener("transitionend", remove, { once: true });
      safetyTimer = window.setTimeout(remove, SPLASH_FADE_SAFETY_MS);
    };

    // `data-shown-at` is stamped with performance.now() by SPLASH_INIT_SCRIPT;
    // both readings share the same time origin, so the delta is valid. Falls
    // back to 0 (→ fade immediately) if the stamp never ran.
    const shownAt = Number(node.dataset.shownAt) || 0;
    const elapsed = performance.now() - shownAt;
    const wait = Math.max(0, SPLASH_MIN_VISIBLE_MS - elapsed);
    if (wait <= 0) beginFade();
    else fadeTimer = window.setTimeout(beginFade, wait);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(safetyTimer);
      node.removeEventListener("transitionend", remove);
    };
  }, [loadingComplete]);
}
