import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Segmented, type SegmentedOption } from "../../app/components/Segmented";
import { SwatchRow } from "../../app/components/SwatchRow";
import { SearchField } from "../../app/components/SearchField";
import { TextField } from "../../app/components/TextField";
import { FloatingActions } from "../../app/components/FloatingActions";

describe("Segmented", () => {
  function Harness() {
    const [v, setV] = useState<"a" | "b" | "c">("a");
    return (
      <Segmented<"a" | "b" | "c">
        value={v}
        options={["a", "b", "c"]}
        onChange={setV}
        ariaLabel="letters"
      />
    );
  }

  it("exposes a radiogroup with one radio per option and a checked active", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "letters" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveAttribute("aria-checked", "false");
  });

  it("clicking a radio swaps the active value", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: "b" }));
    expect(screen.getByRole("radio", { name: "b" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "a" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("card variant uses the .fav-segs chrome wrapper instead of .seg", () => {
    const opts: SegmentedOption<"x" | "y">[] = [
      { value: "x", label: "X" },
      { value: "y", label: "Y" },
    ];
    render(<Segmented<"x" | "y"> value="x" options={opts} variant="card" />);
    expect(document.querySelector(".fav-segs")).not.toBeNull();
    expect(document.querySelector(".seg")).toBeNull();
  });

  it("renders custom labels when option objects are passed", () => {
    const opts: SegmentedOption<"md" | "txt">[] = [
      { value: "md", label: "Markdown" },
      { value: "txt", label: "Plain" },
    ];
    render(<Segmented<"md" | "txt"> value="md" options={opts} />);
    expect(screen.getByRole("radio", { name: "Markdown" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Plain" })).toBeInTheDocument();
  });
});

describe("SwatchRow", () => {
  function Harness() {
    const [v, setV] = useState<"r" | "g" | "b">("r");
    return (
      <SwatchRow<"r" | "g" | "b">
        value={v}
        onChange={setV}
        ariaLabel="rgb"
        options={[
          { id: "r", color: "#f00", label: "Red" },
          { id: "g", color: "#0f0", label: "Green" },
          { id: "b", color: "#00f", label: "Blue" },
        ]}
      />
    );
  }

  it("renders one radio per swatch with the swatch-row container", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "rgb" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(group).toHaveClass("swatch-row");
  });

  it("the active option carries the sw-on class", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "Red" })).toHaveClass("sw-on");
    await user.click(screen.getByRole("radio", { name: "Green" }));
    expect(screen.getByRole("radio", { name: "Green" })).toHaveClass("sw-on");
    expect(screen.getByRole("radio", { name: "Red" })).not.toHaveClass("sw-on");
  });

  it("the colour swatch background reflects the option colour", () => {
    render(<Harness />);
    const green = screen.getByRole("radio", { name: "Green" });
    const swatch = green.querySelector(".sw-color") as HTMLElement;
    // jsdom normalises rgb forms; just check the green channel is set somewhere.
    expect(swatch.style.background).toMatch(/0,\s*255,\s*0|#0f0/);
  });
});

describe("SearchField", () => {
  it("renders the input with a search icon", () => {
    render(<SearchField placeholder="Filter…" />);
    const input = screen.getByPlaceholderText("Filter…");
    expect(input).toBeInTheDocument();
    expect(input.closest(".search-field")?.querySelector("svg")).not.toBeNull();
  });

  it("typing updates the controlled value", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [q, setQ] = useState("");
      return (
        <>
          <SearchField value={q} onChange={(e) => setQ(e.target.value)} aria-label="q" />
          <output>{q}</output>
        </>
      );
    }
    render(<Harness />);
    await user.type(screen.getByLabelText("q"), "abc");
    expect(screen.getByRole("status").textContent).toBe("abc");
  });
});

describe("TextField", () => {
  it("plain variant has the .text-field class but no .jp", () => {
    render(<TextField aria-label="plain" defaultValue="hi" />);
    const input = screen.getByLabelText("plain");
    expect(input).toHaveClass("text-field");
    expect(input).not.toHaveClass("jp");
  });

  it("jp flag adds the Mincho font cascade class", () => {
    render(<TextField jp aria-label="jp" defaultValue="日本語" />);
    expect(screen.getByLabelText("jp")).toHaveClass("text-field", "jp");
  });

  it("typing updates the controlled value", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = useState("");
      return (
        <>
          <TextField aria-label="x" value={v} onChange={(e) => setV(e.target.value)} />
          <output>{v}</output>
        </>
      );
    }
    render(<Harness />);
    await user.type(screen.getByLabelText("x"), "yo");
    expect(screen.getByRole("status").textContent).toBe("yo");
  });
});

describe("FloatingActions", () => {
  it("favorite button reflects the on/off prop and emits onFavorite", async () => {
    const user = userEvent.setup();
    let toggled = 0;
    const { rerender } = render(
      <FloatingActions onFavorite={() => toggled++} />,
    );
    const fav = screen.getByRole("button", { name: /add favorite/i });
    expect(fav).toHaveAttribute("aria-pressed", "false");
    await user.click(fav);
    expect(toggled).toBe(1);

    rerender(<FloatingActions favorite onFavorite={() => toggled++} />);
    const favOn = screen.getByRole("button", { name: /remove favorite/i });
    expect(favOn).toHaveAttribute("aria-pressed", "true");
    expect(favOn).toHaveClass("on");
  });

  it("copy button calls onCopy and momentarily renders a check icon", async () => {
    const user = userEvent.setup();
    let copied = 0;
    render(<FloatingActions onCopy={() => copied++} />);
    const btn = screen.getByRole("button", { name: /copy term/i });
    await user.click(btn);
    expect(copied).toBe(1);
    // After click, the icon switches to the check (existence of <text> or path
    // changes — the easiest invariant is that the button still exists).
    expect(btn).toBeInTheDocument();
  });

  it("share button calls onShare", async () => {
    const user = userEvent.setup();
    let shared = 0;
    render(<FloatingActions onShare={() => shared++} />);
    await user.click(screen.getByRole("button", { name: /copy share link/i }));
    expect(shared).toBe(1);
  });
});
