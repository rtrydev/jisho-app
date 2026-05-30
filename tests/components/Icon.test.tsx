import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import * as Icon from "../../app/components/Icon";

const ALL: Array<[string, React.ComponentType<{ size?: number }>]> = [
  ["Read", Icon.Read],
  ["History", Icon.History],
  ["Favorites", Icon.Favorites],
  ["Settings", Icon.Settings],
  ["Search", Icon.Search],
  ["Close", Icon.Close],
  ["Trash", Icon.Trash],
  ["Share", Icon.Share],
  ["Copy", Icon.Copy],
  ["Collapse", Icon.Collapse],
  ["Play", Icon.Play],
  ["Check", Icon.Check],
  ["ShareArrow", Icon.ShareArrow],
  ["Heart", Icon.Heart],
  ["Brush", Icon.Brush],
  ["Undo", Icon.Undo],
  ["Info", Icon.Info],
  ["Kanji", Icon.Kanji],
  ["Install", Icon.Install],
  ["PlusSquare", Icon.PlusSquare],
  ["Overflow", Icon.Overflow],
];

describe("Icon set", () => {
  it.each(ALL)(
    "%s renders an SVG with the requested size and a stroke or fill path",
    (_name, Cmp) => {
      const { container } = render(<Cmp size={20} />);
      const svg = container.querySelector("svg") as SVGSVGElement | null;
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute("width")).toBe("20");
      expect(svg!.getAttribute("height")).toBe("20");
      // Each icon contains at least one drawing element (path / circle / rect / text).
      expect(
        svg!.querySelector("path,circle,rect,text"),
      ).not.toBeNull();
    },
  );

  it("Favorites renders the outlined seal frame with the 印 glyph", () => {
    const { container } = render(<Icon.Favorites size={14} />);
    const svg = container.querySelector("svg")!;
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("none");
    expect(svg.querySelector("text")?.textContent).toBe("印");
  });

  it("Heart fills only when the `filled` prop is set", () => {
    const outlined = render(<Icon.Heart size={14} />).container.querySelector(
      "svg path",
    )!;
    expect(outlined.getAttribute("fill")).toBe("none");

    const filled = render(<Icon.Heart size={14} filled />).container.querySelector(
      "svg path",
    )!;
    expect(filled.getAttribute("fill")).toBe("currentColor");
  });

  it("Icon.* namespace re-exports the same components", () => {
    expect(Icon.Icon.Read).toBe(Icon.Read);
    expect(Icon.Icon.Favorites).toBe(Icon.Favorites);
    expect(Icon.Icon.Heart).toBe(Icon.Heart);
  });
});
