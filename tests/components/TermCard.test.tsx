import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TermCard, type TermCardData } from "../../app/components/TermCard";

const vocab: TermCardData = {
  id: "v-sensei",
  type: "vocab",
  head: "先生",
  reading: "せんせい",
  surface: "先生",
  pos: ["noun"],
  tags: ["common", "JLPT N5"],
  glosses: ["teacher; instructor", "(suffix) respectful title"],
  examples: [{ jp: "先生", rt: "せんせい", en: "Teacher" }],
};

const vocabVerb: TermCardData = {
  ...vocab,
  id: "v-yobu",
  head: "呼ぶ",
  reading: "よぶ",
  surface: "呼んで",
  pos: ["verb", "godan-bu"],
  glosses: ["to call"],
  conjugation: { dict: "呼ぶ", masu: "呼びます", te: "呼んで", past: "呼んだ" },
};

const grammar: TermCardData = {
  id: "g-toyobu",
  type: "grammar",
  head: "〜と呼ぶ",
  pos: ["pattern"],
  tags: ["N4"],
  glosses: ["to call X by the name Y"],
  formula: "[N₁] を [N₂] と 呼ぶ",
  explanation: "Quotative と marks the name applied to the object",
  examples: [{ jp: "彼を先生と呼ぶ", en: "Call him sensei" }],
};

describe("TermCard — vocab", () => {
  it("uses the indigo-edge class and exposes the dictKey via data-card-id", () => {
    render(<TermCard card={vocab} />);
    const card = document.querySelector(".card") as HTMLElement;
    expect(card).toHaveClass("card", "card-vocab");
    expect(card).not.toHaveClass("card-grammar");
    expect(card).toHaveAttribute("data-card-id", "v-sensei");
  });

  it("renders the headword with furigana + reading + romaji", () => {
    render(<TermCard card={vocab} />);
    expect(document.querySelector(".card-headword-jp ruby")).not.toBeNull();
    // The .card-reading line has the kana + ` · ` + romaji.
    const reading = document.querySelector(".card-reading") as HTMLElement;
    expect(reading.textContent).toContain("せんせい");
    expect(reading.textContent?.toLowerCase()).toContain("sensei");
  });

  it("renders each gloss with a numbered marker and a copy button", () => {
    render(<TermCard card={vocab} />);
    const items = document.querySelectorAll(".glosses li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("1");
    expect(items[0]).toHaveTextContent("teacher; instructor");
    const copyBtns = screen.getAllByRole("button", { name: /copy gloss/i });
    expect(copyBtns).toHaveLength(2);
  });

  it("does NOT render formula / explanation slots for vocab", () => {
    render(<TermCard card={vocab} />);
    expect(document.querySelector(".card-formula")).toBeNull();
  });

  it("renders the conjugation grid when present", () => {
    render(<TermCard card={vocabVerb} />);
    const cells = document.querySelectorAll(".conj-cell");
    expect(cells).toHaveLength(4);
  });

  it("emits onToggleFavorite when the seal toggle is clicked", async () => {
    const user = userEvent.setup();
    let n = 0;
    render(<TermCard card={vocab} onToggleFavorite={() => n++} />);
    await user.click(screen.getByRole("button", { name: /add favorite/i }));
    expect(n).toBe(1);
  });

  it("favorite=true switches the toggle to 'Remove favorite' + aria-pressed=true", () => {
    render(<TermCard card={vocab} favorite />);
    const btn = screen.getByRole("button", { name: /remove favorite/i });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("onCopyGloss is fired per-gloss with the gloss text and index", async () => {
    const user = userEvent.setup();
    const calls: Array<[string, number]> = [];
    render(<TermCard card={vocab} onCopyGloss={(g, i) => calls.push([g, i])} />);
    const buttons = screen.getAllByRole("button", { name: /copy gloss/i });
    await user.click(buttons[1]);
    expect(calls).toEqual([["(suffix) respectful title", 1]]);
  });

  it("surface override is shown when it differs from the head", () => {
    render(<TermCard card={vocabVerb} />);
    expect(screen.getByText(/surface · 呼んで/)).toBeInTheDocument();
  });
});

describe("TermCard — grammar", () => {
  it("uses the seal-edge class and renders formula + explanation", () => {
    render(<TermCard card={grammar} />);
    const card = document.querySelector(".card") as HTMLElement;
    expect(card).toHaveClass("card", "card-grammar");
    expect(card).toHaveAttribute("data-card-id", "g-toyobu");
    expect(document.querySelector(".card-formula")?.textContent).toBe(
      "[N₁] を [N₂] と 呼ぶ",
    );
    // Explanation lives in the notes slot for grammar cards.
    expect(document.querySelector(".card-notes")?.textContent).toContain(
      "Quotative と",
    );
  });

  it("does NOT render a furigana reading row (head is not a single word)", () => {
    render(<TermCard card={grammar} />);
    expect(document.querySelector(".card-reading")).toBeNull();
  });
});

describe("TermCard — compact", () => {
  it("compact hides examples, notes/explanation, and conjugation", () => {
    render(<TermCard card={vocabVerb} compact />);
    expect(document.querySelector(".card-conj")).toBeNull();
    expect(document.querySelector(".card-examples")).toBeNull();
  });
});

describe("TermCard — highlight + className passthrough", () => {
  it("highlight prop adds .pulsing", () => {
    render(<TermCard card={vocab} highlight />);
    expect(document.querySelector(".card")).toHaveClass("pulsing");
  });

  it("forwards an extra className", () => {
    render(<TermCard card={vocab} className="extra-flag" />);
    expect(document.querySelector(".card")).toHaveClass("extra-flag");
  });
});

describe("TermCard — tags", () => {
  it("renders all tags inside .card-tags", () => {
    render(<TermCard card={vocab} />);
    const tags = within(document.querySelector(".card-tags") as HTMLElement).getAllByText(
      /common|JLPT N5/,
    );
    expect(tags).toHaveLength(2);
  });
});
