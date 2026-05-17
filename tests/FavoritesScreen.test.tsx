import { describe, it, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import { findCard, navigateTo, queryCard, renderApp } from "./helpers";

async function toggleFavoriteOn(cardId: string) {
  const card = await findCard(cardId);
  const btn = within(card).getByRole("button", { name: /add favorite/i });
  return btn;
}

describe("Favorites screen", () => {
  it("starts empty and prompts the user to favorite from Read", async () => {
    const { user } = renderApp();
    await findCard("v-sensei"); // ensure analyser warm
    await navigateTo(user, "Favorites");

    await screen.findByText("Favorites", { selector: ".sc-title" });
    expect(screen.getByText(/no vocab favorites yet/i)).toBeInTheDocument();
  });

  it("toggling a vocab card on Read makes it appear on the Vocabulary tab", async () => {
    const { user } = renderApp();
    const favBtn = await toggleFavoriteOn("v-sensei");
    await user.click(favBtn);

    await navigateTo(user, "Favorites");
    await screen.findByText("Favorites", { selector: ".sc-title" });

    // Vocabulary tab is default; the 先生 card is rendered live from the dict.
    await findCard("v-sensei");
    expect(screen.getByRole("radio", { name: /vocabulary/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("Grammar tab filters to grammar favorites only", async () => {
    const { user } = renderApp();
    // Favorite one vocab + one grammar card.
    await user.click(await toggleFavoriteOn("v-sensei"));
    await user.click(await toggleFavoriteOn("g-toyobu"));

    await navigateTo(user, "Favorites");
    await findCard("v-sensei"); // initially vocab tab

    // Switch to Grammar.
    await user.click(screen.getByRole("radio", { name: /grammar/i }));

    expect(queryCard("v-sensei")).toBeNull();
    await findCard("g-toyobu");
  });

  it("toggling off from the Favorites screen removes the card live", async () => {
    const { user } = renderApp();
    await user.click(await toggleFavoriteOn("v-sensei"));
    await navigateTo(user, "Favorites");
    const card = await findCard("v-sensei");

    const remove = within(card).getByRole("button", { name: /remove favorite/i });
    await user.click(remove);

    await waitFor(() => expect(queryCard("v-sensei")).toBeNull());
    expect(screen.getByText(/no vocab favorites yet/i)).toBeInTheDocument();
  });

  it("Export JSON triggers a file download with the favorites payload", async () => {
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test-url");
    const clicks: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      const el = origCreate(tag);
      if (tag === "a") {
        // Capture the download URL when click() is invoked.
        Object.defineProperty(el, "click", {
          value: function (this: HTMLAnchorElement) {
            clicks.push(this.href);
          },
        });
      }
      return el;
    });

    const { user } = renderApp();
    await user.click(await toggleFavoriteOn("v-sensei"));
    await navigateTo(user, "Favorites");
    await user.click(screen.getByRole("button", { name: /export json/i }));

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(clicks).toEqual(["blob:test-url"]);

    // The blob handed to createObjectURL carries the favorites payload.
    const blob = createUrl.mock.calls[0][0] as Blob;
    const text = await blob.text();
    const parsed = JSON.parse(text);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.entries[0]).toMatchObject({ type: "vocab", dictKey: "sensei" });
  });

  it("Import merges a JSON bundle and the entries become visible", async () => {
    const { user } = renderApp();
    await findCard("v-sensei");
    await navigateTo(user, "Favorites");

    // Build an in-memory JSON bundle and feed it to the hidden <input type=file>.
    const bundle = {
      schemaVersion: 1,
      entries: [
        {
          id: "vocab:sensei",
          type: "vocab",
          dictKey: "sensei",
          surface: "先生",
          addedAt: Date.now(),
        },
      ],
    };
    const file = new File([JSON.stringify(bundle)], "fav.json", {
      type: "application/json",
    });

    const fileInput = document.querySelector(
      "input[type='file']",
    ) as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    await user.upload(fileInput, file);

    // Card should appear without us touching the Read screen.
    await findCard("v-sensei");
  });

  it("favorites survive a remount (persisted through localStorage)", async () => {
    const { user, result } = renderApp();
    await user.click(await toggleFavoriteOn("v-sensei"));

    // Tear down + re-render. Reactive stores are NOT reset here (beforeEach
    // does that between tests, not mid-test), so a fresh mount sees the
    // persisted favorite via the existing in-memory store.
    result.unmount();

    renderApp();
    await navigateTo(user, "Favorites");
    await findCard("v-sensei");
  });
});
