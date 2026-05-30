import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallGuide } from "../../app/components/InstallGuide";

describe("InstallGuide", () => {
  it("renders nothing when closed", () => {
    render(<InstallGuide open={false} platform="ios" onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".sheet")).toBeNull();
  });

  it("opens a labeled dialog seeded to the iOS tab with four steps", () => {
    render(<InstallGuide open platform="ios" onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Install Jisho" });

    // The DS Segmented control models the device tabs as a radiogroup.
    const ios = within(dialog).getByRole("radio", { name: "iPhone" });
    const android = within(dialog).getByRole("radio", { name: "Android" });
    expect(ios).toHaveAttribute("aria-checked", "true");
    expect(android).toHaveAttribute("aria-checked", "false");

    // iOS step list is present with exactly four steps. Scope text checks to
    // the list — the section eyebrow caption is also "Add to Home Screen".
    const steps = within(dialog).getByRole("list");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(4);
    expect(within(steps).getByText("Add to Home Screen")).toBeInTheDocument();
  });

  it("seeds the Android tab + steps when platform is android", () => {
    render(<InstallGuide open platform="android" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Install Jisho" });

    expect(within(dialog).getByRole("radio", { name: "Android" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Android-only wording (note the lowercase "screen" vs the iOS "Screen").
    const steps = within(dialog).getByRole("list");
    expect(within(steps).getByText("Install app")).toBeInTheDocument();
    expect(within(steps).queryByText("Add to Home Screen")).toBeNull();
  });

  it("falls back to the iOS tab for an unknown platform", () => {
    render(<InstallGuide open platform="other" onClose={() => {}} />);
    expect(screen.getByRole("radio", { name: "iPhone" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("switching the tab swaps the visible step list", async () => {
    const user = userEvent.setup();
    render(<InstallGuide open platform="ios" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Install Jisho" });

    expect(
      within(within(dialog).getByRole("list")).getByText("Add to Home Screen"),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: "Android" }));

    // iOS list content unmounts, Android content takes its place.
    const steps = within(dialog).getByRole("list");
    expect(within(steps).queryByText("Add to Home Screen")).toBeNull();
    expect(within(steps).getByText("Add to Home screen")).toBeInTheDocument();
  });

  it("the header Close button fires onClose once", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InstallGuide open platform="ios" onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the footer button fires onClose once", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InstallGuide open platform="ios" onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an outside tap on the scrim dismisses", () => {
    const onClose = vi.fn();
    render(<InstallGuide open platform="ios" onClose={onClose} />);
    fireEvent.click(document.querySelector(".sheet-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape dismisses", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InstallGuide open platform="ios" onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
