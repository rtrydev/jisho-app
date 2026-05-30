import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "../../app/components/AppShell";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Restore navigator.userAgent after each test — defineProperty shadows the
// prototype getter and persists otherwise (see installPrompt.test.ts).
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

function stubStandalone(on: boolean) {
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

function renderShell() {
  return render(
    <AppShell active="read" onChange={() => {}}>
      <div>screen body</div>
    </AppShell>,
  );
}

afterEach(() => {
  if (ORIGINAL_UA) {
    Object.defineProperty(window.navigator, "userAgent", ORIGINAL_UA);
  } else {
    delete (window.navigator as { userAgent?: string }).userAgent;
  }
});

describe("AppShell install entry point", () => {
  it("shows a labeled Install button on a mobile browser tab", async () => {
    setUA(IPHONE_UA);
    renderShell();
    const button = await screen.findByRole("button", { name: "Install Jisho" });
    expect(button).toBeInTheDocument();
    // Carries a visible text label, not just an icon.
    expect(button).toHaveTextContent("Install");
  });

  it("replaces the decorative marginalia with the button when installable", async () => {
    setUA(IPHONE_UA);
    renderShell();
    await screen.findByRole("button", { name: "Install Jisho" });
    // The tategaki ornament is dropped when the actionable button is present.
    expect(document.querySelector(".app-topbar-marginalia")).toBeNull();
  });

  it("keeps the marginalia and shows no button on desktop", async () => {
    setUA(DESKTOP_UA);
    renderShell();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Install Jisho" })).toBeNull();
    });
    expect(document.querySelector(".app-topbar-marginalia")).not.toBeNull();
  });

  it("does not auto-open the guide on mount", async () => {
    setUA(IPHONE_UA);
    renderShell();
    await screen.findByRole("button", { name: "Install Jisho" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tapping the button opens the walkthrough, and it can be reopened after closing", async () => {
    setUA(IPHONE_UA);
    const user = userEvent.setup();
    renderShell();

    const button = await screen.findByRole("button", { name: "Install Jisho" });
    await user.click(button);
    const dialog = screen.getByRole("dialog", { name: "Install Jisho" });
    expect(dialog).toBeInTheDocument();

    // Outside tap on the scrim dismisses; the trigger stays for re-opening.
    await user.click(document.querySelector(".sheet-backdrop")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const stillThere = screen.getByRole("button", { name: "Install Jisho" });
    await user.click(stillThere);
    expect(screen.getByRole("dialog", { name: "Install Jisho" })).toBeInTheDocument();
  });

  it("hides the button inside the installed PWA", async () => {
    setUA(IPHONE_UA);
    stubStandalone(true);
    renderShell();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Install Jisho" })).toBeNull();
    });
  });
});
