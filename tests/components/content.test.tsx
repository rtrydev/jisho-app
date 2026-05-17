import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Example,
  ExampleList,
  type ExampleSentence,
} from "../../app/components/Example";
import { ConjugationGrid } from "../../app/components/ConjugationGrid";

describe("Example", () => {
  it("renders the jp + en lines", () => {
    render(<Example jp="先生" rt="せんせい" en="Teacher." />);
    expect(screen.getByText("Teacher.")).toHaveClass("ex-en");
    expect(document.querySelector(".ex-jp ruby")).not.toBeNull();
  });

  it("omits the english line when not supplied", () => {
    render(<Example jp="あ" />);
    expect(document.querySelector(".ex-en")).toBeNull();
  });
});

describe("ExampleList", () => {
  it("renders nothing when the examples array is empty", () => {
    const { container } = render(<ExampleList examples={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one Example per entry under the label", () => {
    const examples: ExampleSentence[] = [
      { jp: "一", en: "one" },
      { jp: "二", en: "two" },
      { jp: "三", en: "three" },
    ];
    render(<ExampleList examples={examples} />);
    expect(screen.getByText("Examples")).toHaveClass("ex-label");
    expect(document.querySelectorAll(".example").length).toBe(3);
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("three")).toBeInTheDocument();
  });

  it("custom label overrides the default", () => {
    render(<ExampleList examples={[{ jp: "あ" }]} label="Usage" />);
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.queryByText("Examples")).toBeNull();
  });
});

describe("ConjugationGrid", () => {
  it("renders nothing when given an empty conjugation map", () => {
    const { container } = render(<ConjugationGrid conjugation={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one cell per entry preserving insertion order", () => {
    render(
      <ConjugationGrid
        conjugation={{
          dict: "呼ぶ",
          masu: "呼びます",
          te: "呼んで",
          past: "呼んだ",
          neg: "呼ばない",
        }}
      />,
    );
    const cells = document.querySelectorAll(".conj-cell");
    expect(cells).toHaveLength(5);
    const forms = Array.from(cells).map((c) => c.querySelector(".conj-form")?.textContent);
    expect(forms).toEqual(["dict", "masu", "te", "past", "neg"]);
    const vals = Array.from(cells).map((c) => c.querySelector(".conj-val")?.textContent);
    expect(vals).toEqual(["呼ぶ", "呼びます", "呼んで", "呼んだ", "呼ばない"]);
  });

  it("conjugation values get the jp font class for Mincho rendering", () => {
    render(<ConjugationGrid conjugation={{ dict: "呼ぶ" }} />);
    expect(document.querySelector(".conj-val")).toHaveClass("jp");
  });
});
