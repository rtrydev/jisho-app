import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Ruby, FuriganaSentence, romanize } from "../../app/components/Ruby";

describe("Ruby", () => {
  it("wraps base + rt in <ruby><rt>", () => {
    render(<Ruby base="先生" rt="せんせい" />);
    const ruby = document.querySelector("ruby");
    expect(ruby).not.toBeNull();
    expect(ruby!.textContent).toContain("先生");
    const rt = document.querySelector("ruby rt");
    expect(rt).not.toBeNull();
    expect(rt!.textContent).toBe("せんせい");
  });

  it("omits the <ruby> element when no reading is supplied", () => {
    render(<Ruby base="先生" />);
    expect(document.querySelector("ruby")).toBeNull();
    expect(document.body.textContent).toContain("先生");
  });
});

describe("FuriganaSentence", () => {
  it("renders a plain span when rt is missing or equal to jp (no kanji)", () => {
    const { rerender } = render(<FuriganaSentence jp="こんにちは" />);
    expect(document.querySelector("ruby")).toBeNull();
    expect(document.body.textContent).toContain("こんにちは");
    rerender(<FuriganaSentence jp="ABC" rt="ABC" />);
    expect(document.querySelector("ruby")).toBeNull();
  });

  it("distributes the reading across kanji runs and keeps kana adjacent", () => {
    render(<FuriganaSentence jp="先生に呼ばれた" rt="せんせいによばれた" />);
    const rubies = document.querySelectorAll("ruby");
    // Two kanji runs (先生, 呼) → two <ruby> elements.
    expect(rubies.length).toBe(2);

    // The naive distribution proportionally allocates the residual reading
    // across kanji runs; we don't lock in the exact split (demo-grade), but
    // every reading character from `rt` is accounted for somewhere on screen.
    const readings = Array.from(document.querySelectorAll("ruby rt"))
      .map((r) => r.textContent ?? "")
      .join("");
    const kanaInText = "にばれた";
    expect(readings + kanaInText).toHaveLength("せんせいによばれた".length);

    // Both kanji runs and all surrounding kana appear in the rendered output.
    const text = document.body.textContent ?? "";
    expect(text).toContain("先生");
    expect(text).toContain("呼");
    expect(text).toContain("に");
    expect(text).toContain("ばれた");
  });

  it("applies the jp class so the .jp scale + furigana cascade reach it", () => {
    render(<FuriganaSentence jp="先生" rt="せんせい" />);
    const wrapper = document.body.querySelector(".jp") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelector("ruby")).not.toBeNull();
  });
});

describe("romanize (demo-grade hiragana → romaji)", () => {
  it("transliterates basic hiragana", () => {
    expect(romanize("せんせい")).toBe("sensei");
  });

  it("emits a y-glide when a yōon (small ya/yu/yo) follows a consonant-vowel kana", () => {
    // The demo romanizer is deliberately naive (it isn't part of the engine
    // contract); we just lock in its current shape so behavioural changes are
    // visible. Real text rendering uses Ruby/<rt>, not romaji.
    const out = romanize("きょう");
    expect(out.startsWith("k")).toBe(true);
    expect(out).toContain("y");
    expect(out.endsWith("u")).toBe(true);
  });

  it("passes through non-kana glyphs unchanged", () => {
    expect(romanize("あ123")).toBe("a123");
  });
});
