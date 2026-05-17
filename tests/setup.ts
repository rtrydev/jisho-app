import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi, type MockInstance } from "vitest";
import { __resetAllReactiveStoresForTests } from "../app/lib/reactiveStore";

// ───────────────────────────────────────────────────────────────────
// Polyfills jsdom is missing
// ───────────────────────────────────────────────────────────────────

if (typeof window.matchMedia === "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

if (typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = () => {};
}

if (typeof window.URL.createObjectURL === "undefined") {
  window.URL.createObjectURL = vi.fn(() => "blob:test");
  window.URL.revokeObjectURL = vi.fn();
}

// ───────────────────────────────────────────────────────────────────
// Clipboard: jsdom returns a fresh Clipboard accessor on each call,
// so we re-bind a spy on the live writeText before every test.
// ───────────────────────────────────────────────────────────────────

let clipboardWriteSpy: MockInstance<(text: string) => Promise<void>> | null = null;

export function getClipboardWriteText(): MockInstance<(text: string) => Promise<void>> {
  if (!clipboardWriteSpy) {
    throw new Error("Clipboard spy not initialised — was setup.ts loaded?");
  }
  return clipboardWriteSpy;
}

function installClipboardSpy() {
  if (!navigator.clipboard) {
    // jsdom < 16 fallback: install a stub object directly
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {},
        readText: async () => "",
      },
    });
  }
  clipboardWriteSpy = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockImplementation(async () => {});
}

// ───────────────────────────────────────────────────────────────────
// Lifecycle: every test starts from a clean slate
// ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  __resetAllReactiveStoresForTests();
  installClipboardSpy();

  // Reset per-test data-attrs on <html>.
  const root = document.documentElement;
  root.dataset.theme = "light";
  root.dataset.accent = "seal";
  root.dataset.furigana = "always";
  root.dataset.jpScale = "M";

  // Reset URL hash so share-fragment consumption doesn't leak between tests.
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname);
  }
});

afterEach(() => {
  cleanup();
  clipboardWriteSpy?.mockRestore();
  clipboardWriteSpy = null;
});
