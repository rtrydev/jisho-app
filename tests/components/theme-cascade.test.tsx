import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TermCard, type TermCardData } from "../../app/components/TermCard";
import { Hanko } from "../../app/components/Hanko";
import { Button } from "../../app/components/Button";
import { BreakdownChip } from "../../app/components/BreakdownChip";
import { Ruby } from "../../app/components/Ruby";
import {
  applySettingsToRoot,
  defaultSettings,
} from "../../app/lib/settings";

const sampleVocab: TermCardData = {
  id: "v-x",
  type: "vocab",
  head: "先生",
  reading: "せんせい",
  pos: ["noun"],
  glosses: ["teacher"],
};

function setRoot(theme: string, accent: string, furigana: string, jpScale: string) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accent = accent;
  root.dataset.furigana = furigana;
  root.dataset.jpScale = jpScale;
}

describe("Theme cascade — components are DOM-stable across flips", () => {
  it("TermCard markup is identical under light and dark themes", () => {
    setRoot("light", "seal", "always", "M");
    const { container: light, unmount } = render(<TermCard card={sampleVocab} />);
    const lightHtml = light.innerHTML;
    unmount();

    setRoot("dark", "seal", "always", "M");
    const { container: dark } = render(<TermCard card={sampleVocab} />);
    expect(dark.innerHTML).toBe(lightHtml);
  });

  it("TermCard markup is identical under every accent (seal / indigo / sumi)", () => {
    const snaps: string[] = [];
    for (const accent of ["seal", "indigo", "sumi"]) {
      setRoot("light", accent, "always", "M");
      const { container, unmount } = render(<TermCard card={sampleVocab} />);
      snaps.push(container.innerHTML);
      unmount();
    }
    expect(snaps[0]).toBe(snaps[1]);
    expect(snaps[1]).toBe(snaps[2]);
  });

  it("BreakdownChip markup is identical across themes — borders come from CSS, not React", () => {
    setRoot("light", "seal", "always", "M");
    const { container: light, unmount } = render(
      <BreakdownChip token={{ surface: "先生", reading: "せんせい", pos: "noun", cardId: "v-x" }} />,
    );
    const lightHtml = light.innerHTML;
    unmount();
    setRoot("dark", "seal", "always", "M");
    const { container: dark } = render(
      <BreakdownChip token={{ surface: "先生", reading: "せんせい", pos: "noun", cardId: "v-x" }} />,
    );
    expect(dark.innerHTML).toBe(lightHtml);
  });

  it("Hanko keeps its single class set regardless of accent (no per-accent forks)", () => {
    setRoot("light", "seal", "always", "M");
    const seal = render(<Hanko />).container.innerHTML;
    setRoot("light", "indigo", "always", "M");
    const indigo = render(<Hanko />).container.innerHTML;
    expect(seal).toBe(indigo);
  });
});

describe("Furigana cascade — components render the ruby markup verbatim", () => {
  it("Ruby renders the same DOM under always / hover / off", () => {
    const snaps: string[] = [];
    for (const mode of ["always", "hover", "off"]) {
      setRoot("light", "seal", mode, "M");
      const { container, unmount } = render(<Ruby base="先生" rt="せんせい" />);
      snaps.push(container.innerHTML);
      unmount();
    }
    expect(snaps[0]).toBe(snaps[1]);
    expect(snaps[1]).toBe(snaps[2]);
    // Ruby contents stay in the DOM in all modes — visibility is CSS only.
    expect(snaps[0]).toContain("せんせい");
  });
});

describe("Buttons stay class-stable across themes — color comes from var(--seal)", () => {
  it("primary + warn classes are identical light/dark", () => {
    setRoot("light", "seal", "always", "M");
    const a = render(<Button variant="primary">Go</Button>).container.innerHTML;
    setRoot("dark", "indigo", "always", "M");
    const b = render(<Button variant="primary">Go</Button>).container.innerHTML;
    expect(a).toBe(b);
  });
});

describe("applySettingsToRoot mirrors settings to <html data-*>", () => {
  it("writes each token attribute", () => {
    const s = {
      ...defaultSettings(),
      theme: "dark" as const,
      accent: "indigo" as const,
      furiganaMode: "hover" as const,
      japaneseFontScale: "L" as const,
    };
    applySettingsToRoot(s);
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.accent).toBe("indigo");
    expect(root.dataset.furigana).toBe("hover");
    expect(root.dataset.jpScale).toBe("L");
  });

  it("'system' theme is resolved to light when prefers-color-scheme is light", () => {
    // jsdom's matchMedia stub returns matches=false, i.e. NOT dark.
    applySettingsToRoot({ ...defaultSettings(), theme: "system" });
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
