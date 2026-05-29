import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  SPLASH_ELEMENT_ID,
  SPLASH_FADE_SAFETY_MS,
  SPLASH_MIN_VISIBLE_MS,
  useSplashRemoval,
} from "../../app/lib/splash";

// Mirrors the render side in app/layout.tsx: a #jisho-splash node carrying a
// `data-shown-at` performance.now() stamp. `agoMs` lets a test pretend the
// splash has already been on screen for that long.
function mountSplash(agoMs = 0): HTMLDivElement {
  const el = document.createElement("div");
  el.id = SPLASH_ELEMENT_ID;
  el.dataset.shownAt = String(performance.now() - agoMs);
  document.body.appendChild(el);
  return el;
}

function splashNode(): HTMLElement | null {
  return document.getElementById(SPLASH_ELEMENT_ID);
}

describe("useSplashRemoval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    splashNode()?.remove();
  });

  it("no-ops while loading — splash stays, no data-leaving", () => {
    const node = mountSplash();
    renderHook(() => useSplashRemoval(false));

    act(() => {
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS + SPLASH_FADE_SAFETY_MS);
    });

    expect(splashNode()).toBe(node);
    expect(node.dataset.leaving).toBeUndefined();
  });

  it("sets data-leaving after the min-visible window when complete", () => {
    const node = mountSplash();
    renderHook(() => useSplashRemoval(true));

    // Before the floor elapses, nothing has happened yet.
    expect(node.dataset.leaving).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS + 50);
    });

    expect(node.dataset.leaving).toBe("true");
    // Still in the DOM — removal waits for transitionend / the safety timer.
    expect(splashNode()).toBe(node);
  });

  it("removes the node on transitionend after fading", () => {
    const node = mountSplash();
    renderHook(() => useSplashRemoval(true));

    act(() => {
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS + 50);
    });
    expect(node.dataset.leaving).toBe("true");

    act(() => {
      node.dispatchEvent(new Event("transitionend"));
    });

    expect(splashNode()).toBeNull();
  });

  it("removes the node via the safety timer when transitionend never fires", () => {
    mountSplash();
    renderHook(() => useSplashRemoval(true));

    act(() => {
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS + 50);
    });
    expect(splashNode()?.dataset.leaving).toBe("true");
    // No transitionend dispatched — only the safety fallback can remove it.
    act(() => {
      vi.advanceTimersByTime(SPLASH_FADE_SAFETY_MS);
    });

    expect(splashNode()).toBeNull();
  });

  it("skips the min-visible delay when shown-at is far in the past", () => {
    const node = mountSplash(SPLASH_MIN_VISIBLE_MS * 10);
    renderHook(() => useSplashRemoval(true));

    // A slow cold load already exceeded the floor, so it fades immediately —
    // no timer advance needed for data-leaving to be set.
    expect(node.dataset.leaving).toBe("true");
  });

  it("does not throw when the splash node is absent", () => {
    expect(() => {
      renderHook(() => useSplashRemoval(true));
      act(() => {
        vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS + SPLASH_FADE_SAFETY_MS);
      });
    }).not.toThrow();
  });

  it("removes the splash once loading flips from incomplete to complete", () => {
    const node = mountSplash();
    const { rerender } = renderHook(
      ({ done }) => useSplashRemoval(done),
      { initialProps: { done: false } },
    );

    act(() => {
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS + 50);
    });
    expect(node.dataset.leaving).toBeUndefined();

    rerender({ done: true });
    act(() => {
      vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS + 50);
      node.dispatchEvent(new Event("transitionend"));
    });

    expect(splashNode()).toBeNull();
  });
});
