"use client";

// RadicalPicker — radical-by-radical kanji lookup.
//
// UI pattern: stroke-count-grouped radical grid. Selecting a radical
// recomputes the kanji intersection (bitset AND) and dims any unselected
// radical whose addition would empty the result — the "dim impossible"
// affordance is the single biggest accuracy boost for users who don't
// already know which radicals their target kanji decomposes into.
//
// The picker only owns its own selection state; result computation is also
// internal but exposed via `onResultsChange` so the host renders the kanji
// candidate row (re-using the same `KanjiTile` the handwriting tab uses).

import { useCallback, useEffect, useMemo } from "react";
import { anyOverlap, andInto, enumerate, isEmpty } from "../lib/kanji/intersect";
import type { KanjiResources } from "../lib/kanji/loader";

const RESULT_LIMIT = 200;

export function RadicalPicker({
  resources,
  selected,
  onSelectedChange,
  onResultsChange,
}: {
  resources: KanjiResources;
  /** Controlled selection — parent owns the set so callers can seed it
   *  externally (e.g. the kanji-card "tap a radical to search" flow). */
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** Fires every time the selection produces a new result list. */
  onResultsChange: (kanji: string[]) => void;
}) {

  // Stable per-stroke-count grouping — `resources.radicals` is sorted by
  // stroke count already, but we want the actual {strokes, [radical, …]}
  // grouping for rendering as titled sections.
  const groups = useMemo(() => {
    const out: Array<{ strokes: number; radicals: string[] }> = [];
    let current: { strokes: number; radicals: string[] } | null = null;
    for (const r of resources.radicals) {
      if (!current || current.strokes !== r.s) {
        current = { strokes: r.s, radicals: [] };
        out.push(current);
      }
      current.radicals.push(r.c);
    }
    return out;
  }, [resources.radicals]);

  // Current intersection bitset = AND of every selected radical's bitset.
  const currentBits = useMemo<Uint32Array | null>(() => {
    if (selected.size === 0) return null;
    const first = [...selected][0];
    const firstBits = resources.bitsets.get(first);
    if (!firstBits) return null;
    const acc = new Uint32Array(firstBits);
    let i = 0;
    for (const rad of selected) {
      if (i++ === 0) continue;
      const b = resources.bitsets.get(rad);
      if (!b) continue;
      andInto(acc, b);
    }
    return acc;
  }, [selected, resources.bitsets]);

  // Compute dimmed set: a radical is dimmed iff adding it to the current
  // selection would produce an empty intersection. Cheap (`anyOverlap`
  // short-circuits) so we recompute every render.
  const dimmed = useMemo<Set<string>>(() => {
    const out = new Set<string>();
    if (!currentBits) return out;
    for (const r of resources.radicals) {
      if (selected.has(r.c)) continue;
      const b = resources.bitsets.get(r.c);
      if (!b) {
        out.add(r.c);
        continue;
      }
      if (!anyOverlap(currentBits, b)) out.add(r.c);
    }
    return out;
  }, [currentBits, resources.radicals, resources.bitsets, selected]);

  // Push results upstream whenever the intersection changes.
  useEffect(() => {
    if (!currentBits || isEmpty(currentBits)) {
      onResultsChange([]);
      return;
    }
    const indices = enumerate(currentBits, RESULT_LIMIT);
    const kanji = indices.map((i) => resources.classes[i]);
    onResultsChange(kanji);
  }, [currentBits, resources.classes, onResultsChange]);

  const toggle = useCallback(
    (rad: string) => {
      const next = new Set(selected);
      if (next.has(rad)) next.delete(rad);
      else next.add(rad);
      onSelectedChange(next);
    },
    [selected, onSelectedChange],
  );

  const onClearSelection = useCallback(() => {
    onSelectedChange(new Set());
  }, [onSelectedChange]);

  return (
    <div className="rad-picker">
      {selected.size > 0 && (
        <div className="rad-summary">
          <span className="ink-faint mono">
            {selected.size} selected
          </span>
          <button
            type="button"
            className="rad-clear-link"
            onClick={onClearSelection}
          >
            clear
          </button>
        </div>
      )}
      <div className="rad-groups thin-scroll">
        {groups.map((g) => (
          <section key={g.strokes} className="rad-group">
            <div className="rad-group-head mono">{g.strokes}</div>
            <div className="rad-grid">
              {g.radicals.map((rad) => {
                const isSelected = selected.has(rad);
                const isDimmed = dimmed.has(rad);
                return (
                  <button
                    key={rad}
                    type="button"
                    className={
                      "rad-cell jp" +
                      (isSelected ? " rad-cell-on" : "") +
                      (isDimmed ? " rad-cell-dim" : "")
                    }
                    onClick={() => toggle(rad)}
                    aria-pressed={isSelected}
                    aria-label={`Radical ${rad}, ${g.strokes} strokes`}
                  >
                    {rad}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
