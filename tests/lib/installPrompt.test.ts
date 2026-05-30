import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  detectPlatform,
  isStandalone,
  useInstallPrompt,
} from "../../app/lib/installPrompt";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Stubbing navigator.userAgent / navigator.standalone via defineProperty
// shadows the prototype getter and PERSISTS across tests, so capture the
// originals once and restore (or delete the shadow) in afterEach — otherwise
// the first mobile-UA test leaks into every later test.
const ORIGINAL_UA = Object.getOwnPropertyDescriptor(
  window.navigator,
  "userAgent",
);

function setUA(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

/** Make matchMedia report the standalone display-mode (installed PWA). */
function stubStandaloneDisplay(on: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: on && /standalone/.test(query),
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  if (ORIGINAL_UA) {
    Object.defineProperty(window.navigator, "userAgent", ORIGINAL_UA);
  } else {
    delete (window.navigator as { userAgent?: string }).userAgent;
  }
  delete (window.navigator as { standalone?: boolean }).standalone;
  // restoreMocks in vitest.config restores the matchMedia spy automatically.
});

describe("detectPlatform", () => {
  it("classifies an iPhone UA as ios", () => {
    expect(detectPlatform(IPHONE_UA)).toBe("ios");
  });
  it("classifies an iPad / iPod UA as ios", () => {
    expect(detectPlatform("... iPad ...")).toBe("ios");
    expect(detectPlatform("... iPod ...")).toBe("ios");
  });
  it("classifies an Android UA as android", () => {
    expect(detectPlatform(ANDROID_UA)).toBe("android");
  });
  it("falls back to other for desktop / unknown UAs", () => {
    expect(detectPlatform(DESKTOP_UA)).toBe("other");
    expect(detectPlatform("")).toBe("other");
  });
  it("is case-insensitive", () => {
    expect(detectPlatform("IPHONE")).toBe("ios");
    expect(detectPlatform("ANDROID")).toBe("android");
  });
});

describe("isStandalone", () => {
  it("is false in a normal tab (no display-mode, no navigator.standalone)", () => {
    expect(isStandalone()).toBe(false);
  });
  it("is true when the standalone display-mode matches", () => {
    stubStandaloneDisplay(true);
    expect(isStandalone()).toBe(true);
  });
  it("is true when the legacy iOS navigator.standalone flag is set", () => {
    Object.defineProperty(window.navigator, "standalone", {
      value: true,
      configurable: true,
    });
    expect(isStandalone()).toBe(true);
  });
});

describe("useInstallPrompt", () => {
  it("is available with platform=ios on an iPhone browser tab", async () => {
    setUA(IPHONE_UA);
    const { result } = renderHook(() => useInstallPrompt());
    await waitFor(() =>
      expect(result.current).toEqual({ available: true, platform: "ios" }),
    );
  });

  it("is available with platform=android on an Android browser tab", async () => {
    setUA(ANDROID_UA);
    const { result } = renderHook(() => useInstallPrompt());
    await waitFor(() =>
      expect(result.current).toEqual({ available: true, platform: "android" }),
    );
  });

  it("is unavailable on desktop", async () => {
    setUA(DESKTOP_UA);
    const { result } = renderHook(() => useInstallPrompt());
    await waitFor(() =>
      expect(result.current).toEqual({ available: false, platform: "other" }),
    );
  });

  it("is unavailable when already installed (standalone), even on mobile", async () => {
    setUA(IPHONE_UA);
    stubStandaloneDisplay(true);
    const { result } = renderHook(() => useInstallPrompt());
    await waitFor(() =>
      expect(result.current).toEqual({ available: false, platform: "ios" }),
    );
  });
});
