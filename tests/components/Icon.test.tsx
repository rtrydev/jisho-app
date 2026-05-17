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

  it("Seal renders as an outlined square by default", () => {
    const { container } = render(<Icon.Seal size={14} />);
    const svg = container.querySelector("svg")!;
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("none");
    // No inner 印 text when not filled.
    expect(svg.querySelector("text")).toBeNull();
  });

  it("Seal renders a stamped 印 glyph when filled", () => {
    const { container } = render(<Icon.Seal size={14} filled />);
    const svg = container.querySelector("svg")!;
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("currentColor");
    const text = svg.querySelector("text");
    expect(text?.textContent).toBe("印");
  });

  it("Icon.* namespace re-exports the same components", () => {
    expect(Icon.Icon.Read).toBe(Icon.Read);
    expect(Icon.Icon.Seal).toBe(Icon.Seal);
  });
});
