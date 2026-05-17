import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Hanko } from "../../app/components/Hanko";
import { Button } from "../../app/components/Button";
import { Tag, PosPill } from "../../app/components/Tag";
import { Eyebrow, RuleGold, Ornament } from "../../app/components/Eyebrow";
import { Note } from "../../app/components/Note";
import { StorageBar } from "../../app/components/StorageBar";

describe("Hanko", () => {
  it("renders the default 辞書 glyph when no children are provided", () => {
    render(<Hanko />);
    const stamp = document.querySelector(".hanko") as HTMLElement;
    expect(stamp).not.toBeNull();
    expect(stamp).toHaveTextContent("辞書");
  });

  it("size variants apply the corresponding class modifier", () => {
    render(
      <div>
        <Hanko size="mini" aria-label="mini" />
        <Hanko size="sm" aria-label="sm" />
        <Hanko size="md" aria-label="md" />
        <Hanko size="lg" aria-label="lg" />
      </div>,
    );
    expect(document.querySelector(".hanko-mini")).not.toBeNull();
    expect(document.querySelector(".hanko.hanko-sm")).not.toBeNull();
    // 'md' is the unmodified base class.
    expect(document.querySelectorAll(".hanko").length).toBeGreaterThanOrEqual(3);
    expect(document.querySelector(".hanko.hanko-lg")).not.toBeNull();
  });

  it("custom kanji override the default glyph", () => {
    render(<Hanko>印</Hanko>);
    const stamp = document.querySelector(".hanko") as HTMLElement;
    expect(stamp.textContent).toBe("印");
  });
});

describe("Button", () => {
  it("each variant maps to its design-system class", () => {
    render(
      <>
        <Button variant="primary">P</Button>
        <Button variant="quiet">Q</Button>
        <Button variant="ghost">G</Button>
        <Button variant="warn">W</Button>
        <Button variant="icon" aria-label="I">
          icon
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "P" })).toHaveClass("btn-primary");
    expect(screen.getByRole("button", { name: "Q" })).toHaveClass("btn-quiet");
    expect(screen.getByRole("button", { name: "G" })).toHaveClass("btn-ghost");
    expect(screen.getByRole("button", { name: "W" })).toHaveClass(
      "btn-quiet",
      "btn-warn",
    );
    expect(screen.getByRole("button", { name: "I" })).toHaveClass("ic-btn");
  });

  it("invokes onClick when clicked", async () => {
    const user = userEvent.setup();
    let clicked = 0;
    render(
      <Button variant="primary" onClick={() => clicked++}>
        Hit
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Hit" }));
    expect(clicked).toBe(1);
  });

  it("renders left- and right-icons around the label", () => {
    render(
      <Button
        leftIcon={<span data-testid="L">L</span>}
        rightIcon={<span data-testid="R">R</span>}
      >
        mid
      </Button>,
    );
    const btn = screen.getByRole("button");
    const order = Array.from(btn.childNodes).map((n) =>
      n.nodeType === Node.TEXT_NODE ? n.textContent : (n as HTMLElement).getAttribute("data-testid"),
    );
    expect(order).toEqual(["L", "mid", "R"]);
  });

  it("honours type=button by default (does not submit a form)", async () => {
    const user = userEvent.setup();
    let submitted = false;
    render(
      <form onSubmit={() => (submitted = true)}>
        <Button>Inside form</Button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: /inside form/i }));
    expect(submitted).toBe(false);
  });
});

describe("Tag + PosPill", () => {
  it("Tag tones map to dedicated classes", () => {
    render(
      <>
        <Tag>plain</Tag>
        <Tag tone="jlpt">JLPT N5</Tag>
        <Tag tone="vocab">vocab</Tag>
        <Tag tone="grammar">grammar</Tag>
      </>,
    );
    expect(screen.getByText("plain")).toHaveClass("tag");
    expect(screen.getByText("JLPT N5")).toHaveClass("tag", "tag-jlpt");
    expect(screen.getByText("vocab")).toHaveClass("tag", "tag-vocab");
    expect(screen.getByText("grammar")).toHaveClass("tag", "tag-grammar");
  });

  it("PosPill carries the pos-pill class", () => {
    render(<PosPill>noun</PosPill>);
    expect(screen.getByText("noun")).toHaveClass("pos-pill");
  });
});

describe("Eyebrow / RuleGold / Ornament", () => {
  it("Eyebrow renders the label inside the .eyebrow container", () => {
    render(<Eyebrow>Section</Eyebrow>);
    const el = document.querySelector(".eyebrow") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("Section");
  });

  it("RuleGold renders a non-interactive divider", () => {
    render(<RuleGold />);
    expect(document.querySelector(".rule-gold")).not.toBeNull();
  });

  it("Ornament centers its kanji middots", () => {
    render(<Ornament>辞 ・ 書</Ornament>);
    const el = document.querySelector(".ornament") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el).toHaveTextContent("辞 ・ 書");
  });
});

describe("Note", () => {
  it("wraps text in the gold-rail callout class", () => {
    render(<Note>important callout</Note>);
    const el = document.querySelector(".note") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el).toHaveTextContent("important callout");
  });
});

describe("StorageBar", () => {
  it("clamps fraction into [0, 1] and renders the percent width", () => {
    render(<StorageBar fraction={0.4} label="2 KB" />);
    const fill = document.querySelector(".sb-fill") as HTMLElement;
    expect(fill.style.width).toBe("40%");
    expect(screen.getByText("2 KB")).toBeInTheDocument();
  });

  it("over-1 fractions cap at 100%, negative at 0%", () => {
    const { rerender } = render(<StorageBar fraction={2} />);
    expect((document.querySelector(".sb-fill") as HTMLElement).style.width).toBe("100%");
    rerender(<StorageBar fraction={-1} />);
    expect((document.querySelector(".sb-fill") as HTMLElement).style.width).toBe("0%");
  });

  it("exposes the progressbar role with accessible value", () => {
    render(<StorageBar fraction={0.5} label="halfway" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });
});
