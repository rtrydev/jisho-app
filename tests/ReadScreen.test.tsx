import { describe, it, expect } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import { DEMO_SENTENCE, findCard, navigateTo, queryCard, renderApp } from "./helpers";
import { getClipboardWriteText } from "./setup";

describe("Read screen", () => {
  it("renders the seeded demo analysis with breakdown chips and term cards", async () => {
    renderApp();

    // The textarea is pre-filled with the default sentence on first mount.
    const textarea = await screen.findByPlaceholderText(/日本語 or English/);
    expect(textarea).toHaveValue(DEMO_SENTENCE);

    // Breakdown shows token count.
    await waitFor(() => {
      expect(screen.getByText(/Breakdown/)).toBeInTheDocument();
    });

    // The vocabulary card for 先生 appears, resolved against the live dict.
    await findCard("v-先生");
    // And the grammar pattern card 〜ていた appears from the grammar bank.
    await findCard("g-ていた");
  });

  it("typing a non-demo sentence wipes the breakdown and shows the empty hint", async () => {
    const { user } = renderApp();
    const textarea = await screen.findByPlaceholderText(/日本語 or English/);
    await user.clear(textarea);
    await user.type(textarea, "知らない文章");
    await waitFor(() => {
      expect(
        screen.getByText(/No analysis available for this input/i),
      ).toBeInTheDocument();
    });
    expect(queryCard("v-先生")).toBeNull();
    expect(queryCard("g-ていた")).toBeNull();
  });

  it("clicking the All/Vocab/Grammar filter narrows the visible cards", async () => {
    const { user } = renderApp();
    await findCard("v-先生");
    await findCard("g-ていた");

    // Grammar tab — only grammar cards remain.
    await user.click(screen.getByRole("radio", { name: "grammar" }));
    expect(queryCard("v-先生")).toBeNull();
    expect(queryCard("g-ていた")).not.toBeNull();

    // Vocab tab — only vocab cards remain.
    await user.click(screen.getByRole("radio", { name: "vocab" }));
    expect(queryCard("g-ていた")).toBeNull();
    expect(queryCard("v-先生")).not.toBeNull();
  });

  it("favoriting a card from the Read screen surfaces it under Favorites", async () => {
    const { user } = renderApp();

    const card = await findCard("v-先生");
    const favBtn = within(card).getByRole("button", { name: /add favorite/i });
    await user.click(favBtn);

    // Switching to Favorites should now show the re-resolved card.
    await navigateTo(user, "Favorites");
    await screen.findByText("Favorites", { selector: ".sc-title" });

    // The 先生 card is rendered live from the dictionary on Favorites.
    await findCard("v-先生");
  });

  it("Copy all writes the formatted study note to the clipboard", async () => {
    const { user } = renderApp();
    await findCard("v-先生");

    const copyAll = screen.getByRole("button", { name: /copy all results/i });
    await user.click(copyAll);

    const clip = getClipboardWriteText();
    expect(clip).toHaveBeenCalledTimes(1);
    const written = clip.mock.calls[0][0];
    expect(written).toContain(DEMO_SENTENCE);
    // Markdown is the default copy format.
    expect(written).toMatch(/^# /m);
    expect(written).toMatch(/先生/);
  });

  it("Share copies a ?q= URL of the current text", async () => {
    const { user } = renderApp();
    await findCard("v-先生");

    await user.click(screen.getByRole("button", { name: /share query/i }));

    const clip = getClipboardWriteText();
    expect(clip).toHaveBeenCalled();
    const url = clip.mock.calls.at(-1)?.[0] ?? "";
    expect(url).toMatch(/\?q=/);
    expect(url).toContain(encodeURIComponent(DEMO_SENTENCE));
    // Inline confirmation appears on the share control.
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
  });

  it("Collapsing the sticky input hides the textarea while keeping the breakdown visible", async () => {
    const { user } = renderApp();
    const textarea = await screen.findByPlaceholderText(/日本語 or English/);
    expect(textarea).toBeVisible();

    await user.click(screen.getByRole("button", { name: /collapse input/i }));
    expect(screen.queryByPlaceholderText(/日本語 or English/)).not.toBeInTheDocument();
    expect(screen.getByText(/Breakdown/)).toBeInTheDocument();
  });
});
