import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "../../app/components/Sheet";
import {
  SettingGroup,
  SettingRow,
} from "../../app/components/SettingGroup";
import {
  DataAction,
  DataActionGrid,
} from "../../app/components/DataAction";

describe("Sheet", () => {
  it("renders a modal dialog with the .sheet-handle affordance", () => {
    render(
      <Sheet>
        <div>contents</div>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveClass("sheet");
    expect(dialog.querySelector(".sheet-handle")).not.toBeNull();
    expect(within(dialog).getByText("contents")).toBeInTheDocument();
  });

  it("custom className is appended without losing .sheet", () => {
    render(<Sheet className="custom"><span /></Sheet>);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("sheet", "custom");
  });
});

describe("SettingGroup + SettingRow", () => {
  it("renders the kanji glyph, title, description and child rows", () => {
    render(
      <SettingGroup kanji="外" title="Appearance" description="Tokens cascade.">
        <SettingRow label="Theme" hint="Affects every component.">
          <button>light</button>
        </SettingRow>
        <SettingRow label="Furigana">
          <button>off</button>
        </SettingRow>
      </SettingGroup>,
    );
    const group = document.querySelector(".set-group") as HTMLElement;
    expect(group).not.toBeNull();
    expect(within(group).getByText("外")).toBeInTheDocument();
    expect(within(group).getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(within(group).getByText("Tokens cascade.")).toBeInTheDocument();
    expect(within(group).getAllByText(/Theme|Furigana/)).toHaveLength(2);
    expect(within(group).getAllByRole("button")).toHaveLength(2);
  });

  it("SettingRow hint is omitted when not provided", () => {
    render(
      <SettingGroup title="X">
        <SettingRow label="Plain">
          <span>ctrl</span>
        </SettingRow>
      </SettingGroup>,
    );
    expect(document.querySelectorAll(".set-row-hint")).toHaveLength(0);
  });

  it("SettingGroup forwards an extra className", () => {
    render(
      <SettingGroup title="X" className="flag">
        <span />
      </SettingGroup>,
    );
    expect(document.querySelector(".set-group")).toHaveClass("flag");
  });
});

describe("DataAction + DataActionGrid", () => {
  it("quiet tone (default) does NOT carry the data-warn class", () => {
    render(<DataAction label="Export" description="Bundle as Markdown" />);
    const btn = screen.getByRole("button", { name: /export/i });
    expect(btn).toHaveClass("data-action");
    expect(btn).not.toHaveClass("data-warn");
  });

  it("warn tone carries the data-warn class and seal-coloured label", () => {
    render(<DataAction label="Clear" description="Erases entries" tone="warn" />);
    const btn = screen.getByRole("button", { name: /clear/i });
    expect(btn).toHaveClass("data-action", "data-warn");
  });

  it("renders the description when supplied and skips it otherwise", () => {
    const { rerender } = render(<DataAction label="With" description="d" />);
    expect(document.querySelector(".da-desc")?.textContent).toBe("d");
    rerender(<DataAction label="Without" />);
    expect(document.querySelector(".da-desc")).toBeNull();
  });

  it("forwards onClick", async () => {
    const user = userEvent.setup();
    let n = 0;
    render(<DataAction label="Hit" onClick={() => n++} />);
    await user.click(screen.getByRole("button", { name: /hit/i }));
    expect(n).toBe(1);
  });

  it("respects the disabled HTML attribute", async () => {
    const user = userEvent.setup();
    let n = 0;
    render(<DataAction label="Hit" onClick={() => n++} disabled />);
    const btn = screen.getByRole("button", { name: /hit/i });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(n).toBe(0);
  });

  it("DataActionGrid lays out its children inside the set-data-grid container", () => {
    render(
      <DataActionGrid>
        <DataAction label="A" />
        <DataAction label="B" />
        <DataAction label="C" />
      </DataActionGrid>,
    );
    const grid = document.querySelector(".set-data-grid") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(within(grid).getAllByRole("button")).toHaveLength(3);
  });
});
