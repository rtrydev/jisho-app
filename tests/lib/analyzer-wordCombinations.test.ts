import { describe, it, expect } from "vitest";
import {
  findWordCombinations,
  type EngineResources,
  type WordCombinationSlot,
} from "../../app/lib/analyzer";

// Build the minimum EngineResources surface that `findWordCombinations`
// actually reads — only `dictionary.words` matters. Everything else stays
// undefined; that's fine because the function never touches it.
function makeResources(
  entries: Record<string, { reading: string; gloss: string; freq: number }>,
): EngineResources {
  const words: EngineResources["dictionary"]["words"] = {};
  for (const [head, info] of Object.entries(entries)) {
    words[head] = {
      r: [info.reading],
      s: [{ pos: [], glosses: [info.gloss] }],
      f: info.freq,
    };
  }
  return {
    dictionary: { meta: {}, words, readings: {}, sentences: [] },
  } as unknown as EngineResources;
}

function slot(...pairs: Array<[string, number]>): WordCombinationSlot {
  return pairs.map(([char, score]) => ({ char, score }));
}

describe("findWordCombinations", () => {
  const resources = makeResources({
    漢字: { reading: "かんじ", gloss: "kanji; Chinese character", freq: 1500 },
    感じ: { reading: "かんじ", gloss: "feeling", freq: 1800 },
    返事: { reading: "へんじ", gloss: "reply", freq: 1000 },
  });

  it("returns an empty array when fewer than two slots are supplied", () => {
    expect(findWordCombinations(resources, [])).toEqual([]);
    expect(findWordCombinations(resources, [slot(["漢", 0.9])])).toEqual([]);
  });

  it("finds the headword that matches the top-1 of each slot", () => {
    const out = findWordCombinations(resources, [
      slot(["漢", 0.9], ["感", 0.05]),
      slot(["字", 0.8], ["事", 0.1]),
    ]);
    expect(out.map((s) => s.headword)).toContain("漢字");
    const top = out[0];
    expect(top.headword).toBe("漢字");
    expect(top.reading).toBe("かんじ");
    expect(top.gloss).toMatch(/kanji/i);
    expect(top.jointScore).toBeCloseTo(0.9 * 0.8, 5);
  });

  it("includes a cross-combination when both alternatives exist in the dictionary", () => {
    const out = findWordCombinations(resources, [
      slot(["漢", 0.5], ["感", 0.4]),
      slot(["字", 0.5], ["じ", 0.2]),
    ]);
    const heads = out.map((s) => s.headword);
    // 漢字 hits; 感じ hits; 漢じ and 感字 don't exist in the fixture and
    // must not appear.
    expect(heads).toContain("漢字");
    expect(heads).toContain("感じ");
    expect(heads).not.toContain("漢じ");
    expect(heads).not.toContain("感字");
  });

  it("returns nothing when no combination is a real headword", () => {
    const out = findWordCombinations(resources, [
      slot(["猫", 0.9]),
      slot(["犬", 0.9]),
    ]);
    expect(out).toEqual([]);
  });

  it("returns nothing when any slot's top score is below minTopScore", () => {
    const out = findWordCombinations(
      resources,
      [
        slot(["漢", 0.9]),
        slot(["字", 0.02]), // top score under default 0.05 floor
      ],
    );
    expect(out).toEqual([]);
  });

  it("respects perPositionLimit when building the cartesian product", () => {
    // Only the top-1 from each slot is considered, so 感じ (which would
    // surface if top-2 of slot 0 were used) must NOT appear here.
    const out = findWordCombinations(
      resources,
      [
        slot(["漢", 0.9], ["感", 0.5]),
        slot(["字", 0.9], ["じ", 0.5]),
      ],
      { perPositionLimit: 1 },
    );
    const heads = out.map((s) => s.headword);
    expect(heads).toEqual(["漢字"]);
  });

  it("ranks higher-frequency words above lower-frequency ones when joint scores are comparable", () => {
    // 感じ has a higher freq than 漢字 in the fixture. With equal scores
    // for both characters, the more common word should win the sort.
    const out = findWordCombinations(resources, [
      slot(["漢", 0.5], ["感", 0.5]),
      slot(["字", 0.5], ["じ", 0.5]),
    ]);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].headword).toBe("感じ");
  });
});
