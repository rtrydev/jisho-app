import { render, waitFor, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { JishoApp } from "../app/JishoApp";

export const DEMO_SENTENCE = "私はその人を常に先生と呼んでいた。";

export function renderApp(): { user: UserEvent; result: RenderResult } {
  const user = userEvent.setup();
  const result = render(<JishoApp />);
  return { user, result };
}

/** Returns the `<article class="card">` for a given card id, or throws after
 *  the default RTL timeout. Cards are identified by `data-card-id`, which is
 *  the stable contract used by the analyzer + favorites + scroll-into-view. */
export async function findCard(id: string): Promise<HTMLElement> {
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`);
    if (!el) throw new Error(`No card with data-card-id="${id}"`);
  });
  return el!;
}

export function queryCard(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-card-id="${id}"]`);
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
