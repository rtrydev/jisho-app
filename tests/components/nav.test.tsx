import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SideRail, type RailItem } from "../../app/components/SideRail";
import { BottomTabs, type TabItem } from "../../app/components/BottomTabs";
import * as Icon from "../../app/components/Icon";

type Id = "read" | "history" | "favorites" | "settings";

const railItems: RailItem<Id>[] = [
  { id: "read", label: "Read", kanji: "読" },
  { id: "history", label: "History", kanji: "歴" },
  { id: "favorites", label: "Favorites", kanji: "印" },
  { id: "settings", label: "Settings", kanji: "設" },
];

const tabItems: TabItem<Id>[] = [
  { id: "read", label: "Read", icon: Icon.Read },
  { id: "history", label: "History", icon: Icon.History },
  { id: "favorites", label: "Favorites", icon: Icon.Favorites },
  { id: "settings", label: "Settings", icon: Icon.Settings },
];

describe("SideRail", () => {
  it("renders one button per item with kanji + label", () => {
    render(<SideRail<Id> items={railItems} active="read" />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getAllByRole("button")).toHaveLength(4);
    expect(within(nav).getByText("読")).toBeInTheDocument();
    expect(within(nav).getByText("History")).toBeInTheDocument();
  });

  it("the active item gets aria-current=page + the rail-active class", () => {
    render(<SideRail<Id> items={railItems} active="favorites" />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const favBtn = within(nav).getByRole("button", { name: /Favorites/ });
    expect(favBtn).toHaveAttribute("aria-current", "page");
    expect(favBtn).toHaveClass("rail-active");
    // No other item carries the active class.
    expect(within(nav).getAllByRole("button").filter((b) => b.classList.contains("rail-active"))).toHaveLength(1);
  });

  it("clicking an item emits onChange with its id", async () => {
    const user = userEvent.setup();
    let id: Id | null = null;
    render(
      <SideRail<Id>
        items={railItems}
        active="read"
        onChange={(next) => (id = next)}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: /Settings/ }));
    expect(id).toBe("settings");
  });

  it("renders the Hanko brand and the tategaki marginalia", () => {
    render(<SideRail<Id> items={railItems} active="read" />);
    expect(document.querySelector(".rail .hanko")).not.toBeNull();
    expect(document.querySelector(".rail .tategaki")?.textContent).toContain("客");
  });

  it("custom brand / subtitle / marginalia slot in", () => {
    render(
      <SideRail<Id>
        items={[railItems[0]]}
        active="read"
        brand="Custom"
        subtitle="v9"
        marginalia="あ・い・う"
      />,
    );
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByText("v9")).toBeInTheDocument();
    expect(screen.getByText("あ・い・う")).toBeInTheDocument();
  });

  it("omitting marginalia hides the rail-foot block entirely", () => {
    render(
      <SideRail<Id> items={railItems} active="read" marginalia={null} />,
    );
    expect(document.querySelector(".rail-foot")).toBeNull();
  });
});

describe("BottomTabs", () => {
  it("renders one button per tab with the label and the icon component", () => {
    render(<BottomTabs<Id> items={tabItems} active="read" />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getAllByRole("button")).toHaveLength(4);
    expect(nav.querySelectorAll("svg")).toHaveLength(4);
  });

  it("the active tab gets aria-current=page and btab-active class", () => {
    render(<BottomTabs<Id> items={tabItems} active="history" />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const hist = within(nav).getByRole("button", { name: /History/ });
    expect(hist).toHaveAttribute("aria-current", "page");
    expect(hist).toHaveClass("btab-active");
  });

  it("clicking a tab emits onChange with its id", async () => {
    const user = userEvent.setup();
    let id: Id | null = null;
    render(
      <BottomTabs<Id>
        items={tabItems}
        active="read"
        onChange={(next) => (id = next)}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Favorites/ }));
    expect(id).toBe("favorites");
  });
});
