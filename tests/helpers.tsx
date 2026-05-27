import { render, waitFor, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { JishoApp } from "../app/JishoApp";
import {
  DEMO_SENTENCE as ENGINE_DEMO_SENTENCE,
  demoResources,
} from "../app/lib/engine/demoResources";

export const DEMO_SENTENCE = ENGINE_DEMO_SENTENCE;

export function renderApp(): { user: UserEvent; result: RenderResult } {
  const user = userEvent.setup();
  const result = render(<JishoApp engineResources={demoResources} />);
  return { user, result };
}

/** True iff `el` and every ancestor are not hidden via `display: none`. The
 *  app keeps every screen mounted and toggles the active one via an inline
 *  `display: none` wrapper, so multiple `[data-card-id="…"]` matches can
 *  coexist — tests should only see cards on the currently-visible screen. */
function isUserVisible(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.style.display === "none") return false;
    cur = cur.parentElement;
  }
  return true;
}

/** Returns the `<article class="card">` for a given card id, or throws after
 *  the default RTL timeout. Cards are identified by `data-card-id`, which is
 *  the stable contract used by the analyzer + favorites + scroll-into-view.
 *  Only returns cards that are actually visible — hidden background screens
 *  may carry their own copies. */
export async function findCard(id: string): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    const matches = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-card-id="${id}"]`),
    );
    el = matches.find(isUserVisible) ?? null;
    if (!el) throw new Error(`No visible card with data-card-id="${id}"`);
  });
  return el!;
}

export function queryCard(id: string): HTMLElement | null {
  const matches = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-card-id="${id}"]`),
  );
  return matches.find(isUserVisible) ?? null;
}

/** Returns the primary nav element (rail on desktop, bottom tabs on mobile). */
export function getPrimaryNav(): HTMLElement {
  return document.querySelector<HTMLElement>('nav[aria-label="Primary"]')!;
}

/** Click a top-level destination by label, regardless of nav form-factor. */
export async function navigateTo(
  user: UserEvent,
  label: "Read" | "History" | "Favorites" | "Settings",
): Promise<void> {
  const nav = getPrimaryNav();
  const { within } = await import("@testing-library/react");
  const button = within(nav).getByRole("button", { name: new RegExp(label) });
  await user.click(button);
}

/** Block until the analysed `text` has been recorded into the history store.
 *  ReadScreen debounces `recordHistory` by 1.5s and the timer is cleared on
 *  unmount, so tests that navigate away from Read must wait for the write
 *  to settle first or history stays empty. Reads `jp:v2:history` directly
 *  to avoid coupling the wait to any rendered surface. */
export async function waitForHistoryRecorded(text: string): Promise<void> {
  await waitFor(
    () => {
      const raw = window.localStorage.getItem("jp:v2:history");
      if (!raw) throw new Error(`history store empty, expected "${text}"`);
      // storage.ts wraps every payload as { schemaVersion, data }.
      const payload = JSON.parse(raw) as {
        data?: { entries?: Array<{ text?: string }> };
      };
      const hit = (payload.data?.entries ?? []).some((e) => e.text === text);
      if (!hit) throw new Error(`history missing entry for "${text}"`);
    },
    { timeout: 3000, interval: 100 },
  );
}
