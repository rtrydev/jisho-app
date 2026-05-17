import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BreakdownChip,
  BreakdownLegend,
  type BreakdownToken,
} from "../../app/components/BreakdownChip";

const vocab: BreakdownToken = {
  surface: "先生",
  reading: "せんせい",
  pos: "noun",
  cardId: "v-sensei",
};

const grammar: BreakdownToken = {
  surface: "ていた",
  reading: "ていた",
  pos: "aux·past",
  cardId: "g-teita",
};

const particle: BreakdownToken = { surface: "は", pos: "particle" };

const punct: BreakdownToken = { surface: "。", pos: "punct" };

describe("BreakdownChip", () => {
  it("vocab chip carries the indigo-edge class and exposes pos label", () => {
    render(<BreakdownChip token={vocab} />);
    const chip = screen.getByRole("button");
    expect(chip).toHaveClass("chip", "chip-vocab");
    expect(chip).not.toHaveClass("chip-grammar", "chip-particle");
    expect(chip).toHaveTextContent("noun");
  });

  it("grammar chip carries the seal-edge class", () => {
    render(<BreakdownChip token={grammar} />);
    const chip = screen.getByRole("button");
    expect(chip).toHaveClass("chip", "chip-grammar");
  });

  it("particle chip is dashed and skips cardId-based inference", () => {
    render(<BreakdownChip token={particle} />);
    const chip = screen.getByRole("button");
    expect(chip).toHaveClass("chip", "chip-particle");
  });

  it("punctuation renders a non-interactive .chip-punct span", () => {
    render(<BreakdownChip token={punct} />);
    expect(screen.queryByRole("button")).toBeNull();
    const punctEl = document.querySelector(".chip-punct");
    expect(punctEl?.textContent).toBe("。");
  });

  it("active prop adds chip-active and sets aria-pressed=true", () => {
    render(<BreakdownChip token={vocab} active />);
    const chip = screen.getByRole("button");
    expect(chip).toHaveClass("chip-active");
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("renders <ruby> when the token has a reading", () => {
    render(<BreakdownChip token={vocab} />);
    const ruby = document.querySelector("ruby");
    expect(ruby).not.toBeNull();
    expect(ruby!.querySelector("rt")?.textContent).toBe("せんせい");
  });

  it("invokes onClick when a non-punct chip is activated", async () => {
    const user = userEvent.setup();
    let n = 0;
    render(<BreakdownChip token={vocab} onClick={() => n++} />);
    await user.click(screen.getByRole("button"));
    expect(n).toBe(1);
  });

  it("respects explicit kind override regardless of cardId prefix", () => {
    render(<BreakdownChip token={{ ...vocab, cardId: "g-something", kind: "vocab" }} />);
    expect(screen.getByRole("button")).toHaveClass("chip-vocab");
  });
});

describe("BreakdownLegend", () => {
  it("labels each chip family", () => {
    render(<BreakdownLegend />);
    const legend = document.querySelector(".rb-legend") as HTMLElement;
    expect(legend).not.toBeNull();
    expect(legend).toHaveTextContent(/vocab/);
    expect(legend).toHaveTextContent(/grammar/);
    expect(legend).toHaveTextContent(/particle/);
  });
});
