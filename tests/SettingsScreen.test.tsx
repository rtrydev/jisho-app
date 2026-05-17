import { describe, it, expect } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import { findCard, navigateTo, renderApp } from "./helpers";
import { getClipboardWriteText } from "./setup";

async function openSettings(user: ReturnType<typeof renderApp>["user"]) {
  await findCard("v-先生"); // wait for the engine warmup
  await navigateTo(user, "Settings");
  await screen.findByText("Settings", { selector: ".sc-title" });
}

describe("Settings screen", () => {
  it("appearance toggles update the <html> data-attrs immediately", async () => {
    const { user } = renderApp();
    await openSettings(user);
    const root = document.documentElement;

    // Theme — flip to dark.
    const appearance = screen
      .getByText(/Appearance/, { selector: "h2" })
      .closest("section")!;
    const themeSegRow = within(appearance)
      .getByText("Theme")
      .closest(".set-row")!;
    await user.click(within(themeSegRow).getByRole("radio", { name: "dark" }));
    expect(root.dataset.theme).toBe("dark");

    // Accent — flip to indigo (swatches are radios, like Segmented options).
    const accentRow = within(appearance).getByText("Accent").closest(".set-row")!;
    await user.click(within(accentRow).getByRole("radio", { name: /indigo/i }));
    expect(root.dataset.accent).toBe("indigo");

    // Furigana — flip to off.
    const furiganaRow = within(appearance)
      .getByText("Furigana")
      .closest(".set-row")!;
    await user.click(within(furiganaRow).getByRole("radio", { name: "off" }));
    expect(root.dataset.furigana).toBe("off");

    // JP scale — flip to L.
    const scaleRow = within(appearance)
      .getByText(/Japanese font scale/)
      .closest(".set-row")!;
    await user.click(within(scaleRow).getByRole("radio", { name: "L" }));
    expect(root.dataset.jpScale).toBe("L");
  });

  it("settings persist across a re-render via localStorage", async () => {
    const { user, result } = renderApp();
    await openSettings(user);
    const appearance = screen
      .getByText(/Appearance/, { selector: "h2" })
      .closest("section")!;
    const themeRow = within(appearance).getByText("Theme").closest(".set-row")!;
    await user.click(within(themeRow).getByRole("radio", { name: "dark" }));

    // Tear down and remount — the dark theme should rehydrate from storage.
    result.unmount();
    document.documentElement.dataset.theme = "light"; // simulate fresh boot

    renderApp();
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe("dark"),
    );

    // And localStorage holds the v2 payload at the namespaced key.
    const raw = window.localStorage.getItem("jp:v2:settings");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.data.theme).toBe("dark");
  });

  it("changing the copy format reformats the next Copy all output", async () => {
    const { user } = renderApp();
    await openSettings(user);
    const analysis = screen
      .getByText(/Analysis/, { selector: "h2" })
      .closest("section")!;
    const formatRow = within(analysis)
      .getByText(/Copy format/)
      .closest(".set-row")!;
    await user.click(within(formatRow).getByRole("radio", { name: "plain" }));

    // Back to Read and copy all.
    await navigateTo(user, "Read");
    await findCard("v-先生");
    await user.click(screen.getByRole("button", { name: /copy all results/i }));

    const clip = getClipboardWriteText();
    expect(clip).toHaveBeenCalledTimes(1);
    const written = clip.mock.calls[0][0];
    // Plain output has no leading markdown heading.
    expect(written).not.toMatch(/^# /m);
  });

  it("updating the default sentence reseeds the Read input on next mount", async () => {
    const { user, result } = renderApp();
    await openSettings(user);

    const analysis = screen
      .getByText(/Analysis/, { selector: "h2" })
      .closest("section")!;
    const sentenceRow = within(analysis)
      .getByText(/Default sentence/)
      .closest(".set-row")!;
    const input = within(sentenceRow).getByRole("textbox") as HTMLInputElement;

    await user.clear(input);
    await user.type(input, "別の例文");
    // Commit by clicking Save (button only appears when dirty).
    await user.click(within(sentenceRow).getByRole("button", { name: /save/i }));

    // Fresh mount — the Read textarea should start with the new default.
    result.unmount();
    renderApp();
    const textarea = await screen.findByPlaceholderText(/日本語をペースト/);
    expect(textarea).toHaveValue("別の例文");
  });

  it("Clear all data prompts for confirmation and wipes history + favorites", async () => {
    const { user } = renderApp();
    // Seed some user data first.
    const card = await findCard("v-先生");
    await user.click(within(card).getByRole("button", { name: /add favorite/i }));

    await navigateTo(user, "Settings");
    await user.click(screen.getByRole("button", { name: /clear all data/i }));

    // Confirmation row appears; cancel keeps state.
    expect(screen.getByText(/erase all local data/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(window.localStorage.getItem("jp:v2:favorites")).not.toBeNull();

    // Open again + confirm wipes both stores.
    await user.click(screen.getByRole("button", { name: /clear all data/i }));
    await user.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      const fav = window.localStorage.getItem("jp:v2:favorites");
      // After wipe, defaults are written back by `reset()`; favorites become empty.
      const parsed = fav ? JSON.parse(fav).data : { entries: [] };
      expect(parsed.entries).toEqual([]);
    });
  });
});
