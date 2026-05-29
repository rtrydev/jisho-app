"use client";

// Kanji screen — three input modes (Type / Draw / Radicals) feeding a
// shared candidate row + an inline detail panel. Replaces the bottom-
// sheet picker that used to live behind a button on Read.
//
// Layout intent (no modals):
//
//   • A sticky-ish input area at the top whose body changes per mode.
//     The mode selector is a Segmented; the per-mode panels are tall
//     enough to be usable inline (canvas at full reasonable size, the
//     radical grid scrolling internally).
//   • A horizontal candidate row right under the input — the bridge
//     between the input mode and the detail.
//   • The detail (a KanjiCard) lives below and scrolls as needed. The
//     radical chips in the card jump back to Radicals mode pre-seeded,
//     so the lookup loop closes inside this one screen.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Eyebrow, Ornament } from "../components/Eyebrow";
import * as Icon from "../components/Icon";
import { HandwritingCanvas } from "../components/HandwritingCanvas";
import { KanjiCard, type KanjiCardData } from "../components/KanjiCard";
import { KanjiTile } from "../components/KanjiTile";
import { RadicalPicker } from "../components/RadicalPicker";
import { Segmented } from "../components/Segmented";
import { TextField } from "../components/TextField";
import { useKanjiData } from "../lib/kanji/useKanjiData";
import { useKanjiRecognizer } from "../lib/handwriting/useKanjiRecognizer";
import { useAnalyzer } from "../providers/EngineProvider";
import { useNav } from "../JishoApp";
import { writeKanjiParam } from "../lib/share";
import type { Candidate, Stroke } from "../lib/handwriting/types";

type Mode = "type" | "draw" | "radicals";

const TOP_K = 12;

// Inference runs single-threaded ONNX on the main thread (see
// lib/handwriting/loader.ts). Firing it the instant a stroke lands blocks the
// main thread right when the user is bringing their finger back down for the
// next stroke, so the canvas drops the `pointerdown` and the stroke "doesn't
// start on touch". Debouncing means a flurry of strokes only triggers one
// recognize pass — once the user pauses — keeping the main thread free while
// they're actively writing. ~200ms is below the stroke-to-stroke gap of normal
// handwriting yet still feels immediate once the hand stops.
const RECOGNIZE_DEBOUNCE_MS = 200;

/** True for any CJK ideograph (Unified Ideographs + Extension A). */
function isCjk(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf);
}

/** Extract distinct CJK ideographs from input, preserving first-seen order. */
function extractKanji(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of text) {
    if (isCjk(ch) && !seen.has(ch)) {
      seen.add(ch);
      out.push(ch);
    }
  }
  return out;
}

export function KanjiScreen({
  initialChar,
  onClearInitial,
}: {
  /** Deep-link from URL or from another screen (TermCard breakdown). */
  initialChar?: string | null;
  /** Called after the screen has consumed `initialChar` so the parent can
   *  clear its state — otherwise re-mounting would re-seed indefinitely. */
  onClearInitial?: () => void;
}) {
  const kanji = useKanjiData();
  const recognizer = useKanjiRecognizer();
  const { findKanjiExamples, suggestWordCombinations } = useAnalyzer();
  const { openInRead } = useNav();

  const [mode, setMode] = useState<Mode>(initialChar ? "type" : "type");
  const [typedText, setTypedText] = useState<string>(initialChar ?? "");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  // One inner Candidate[] per detected character group, left-to-right.
  // Single-char drawings produce a one-element outer array; multi-char
  // drawings produce one entry per recognised character.
  const [drawCandidates, setDrawCandidates] = useState<Candidate[][]>([]);
  const [radicalSelection, setRadicalSelection] = useState<Set<string>>(
    () => new Set(),
  );
  const [radicalResults, setRadicalResults] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(initialChar ?? null);

  // When the parent deep-links a new char, jump back to Type mode and seed.
  // The keying in JishoApp's `<KanjiScreen key={initialChar ?? null}>` makes
  // re-seeds free; we still onClearInitial so the parent forgets the seed.
  // The setStates here legitimately sync state from props — the screen's
  // initial state can't be expressed in useState because the prop changes
  // after mount via the openKanji nav action.
  useEffect(() => {
    if (initialChar && initialChar !== selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode("type");
      setTypedText(initialChar);
      setSelected(initialChar);
    }
    onClearInitial?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChar]);

  // Mirror the selected kanji to ?kanji= so refresh/share lands you where you
  // were. Treats the Kanji screen the same way ReadScreen mirrors ?q=.
  useEffect(() => {
    writeKanjiParam(selected);
  }, [selected]);

  // ----- Candidates per mode (memoized; cheap) ---------------------- //

  const typeCandidates = useMemo<string[]>(
    () => extractKanji(typedText),
    [typedText],
  );
  // When strokes are wiped, hide stale recognizer output without touching
  // `drawCandidates` state — clearing in an effect would itself trip the
  // set-state-in-effect rule.
  const drawCandidateGroups = useMemo<Candidate[][]>(
    () => (strokes.length === 0 ? [] : drawCandidates),
    [drawCandidates, strokes.length],
  );
  // Grouped view for rendering — type/radicals modes always have a single
  // group; draw mode has one per detected character.
  const candidateGroups: string[][] = useMemo(() => {
    if (mode === "type")
      return typeCandidates.length ? [typeCandidates] : [];
    if (mode === "draw")
      return drawCandidateGroups
        .map((g) => g.map((c) => c.char))
        .filter((g) => g.length > 0);
    return radicalResults.length ? [radicalResults] : [];
  }, [mode, typeCandidates, drawCandidateGroups, radicalResults]);
  const candidates: string[] = useMemo(
    () => candidateGroups.flat(),
    [candidateGroups],
  );

  // Per-group highlight in the candidate row. The detail card is driven by
  // the single `selected` (it can only show one kanji), but each detected
  // character group should still surface *its* top-1 visually — otherwise
  // groups other than the one containing `selected` look unhighlighted even
  // though the recognizer has a clear best guess for them. Rule: the group
  // containing the explicit `selected` shows that char; every other group
  // shows its own top-1.
  const groupHighlights: string[] = useMemo(() => {
    if (mode !== "draw") return [];
    return drawCandidateGroups.map((g) => {
      if (selected && g.some((c) => c.char === selected)) return selected;
      return g[0]?.char ?? "";
    });
  }, [mode, drawCandidateGroups, selected]);

  // Auto-select the top candidate when a new candidate list comes in for a
  // mode. Type/Radicals preserve an explicit user pick ("if you type a kanji
  // directly, you didn't have to also click it"). Draw mode refines with each
  // stroke, so every candidate change is treated as a brand-new input and we
  // re-snap to the top recognizer guess — the selected candidate in a segment
  // must always be its highest-confidence one. The user can still click
  // another tile to inspect it until the next stroke changes the candidates.
  useEffect(() => {
    if (!candidates.length) return;
    if (mode === "draw") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(candidates[0]);
      return;
    }
    if (selected && candidates.includes(selected)) return;
    setSelected(candidates[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.join("|"), mode]);

  // ----- Draw mode: re-recognize on stroke change ------------------- //
  //
  // Deps deliberately use `recognizer.status.kind` (a primitive) and
  // `recognizer.recognize` (stable from useCallback) rather than the
  // recognizer object itself — depending on the object would re-fire
  // every render and produce an infinite recognize → setState → re-render
  // loop.
  const recognizerKind = recognizer.status.kind;
  const recognizeFn = recognizer.recognize;
  useEffect(() => {
    if (mode !== "draw") return;
    if (recognizerKind !== "ready") return;
    if (strokes.length === 0) return;
    let cancelled = false;
    // Debounced so rapid strokes don't each block the main thread mid-draw —
    // see RECOGNIZE_DEBOUNCE_MS. The cleanup clears the pending timer, so a new
    // stroke arriving within the window resets the wait instead of stacking up.
    const timer = setTimeout(() => {
      void recognizeFn(strokes, TOP_K).then((next) => {
        if (cancelled) return;
        setDrawCandidates(next);
      });
    }, RECOGNIZE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [strokes, recognizeFn, recognizerKind, mode]);

  // ----- Draw mode: word combinations from the per-position candidates -- //
  //
  // The combinatorial work is bounded (perPositionLimit^groups ≤ 125 by
  // default) so this is cheap to run on every stroke change. Gated to draw
  // mode + ≥2 detected character groups in the engine helper itself, so we
  // only need to gate the React work by mode here.
  const wordSuggestions = useMemo(() => {
    if (mode !== "draw") return [];
    return suggestWordCombinations(drawCandidates);
  }, [mode, drawCandidates, suggestWordCombinations]);

  // ----- Radical click-through from KanjiCard ----------------------- //

  const onRadicalSearch = useCallback((radical: string) => {
    setRadicalSelection(new Set([radical]));
    setMode("radicals");
    setSelected(null);
  }, []);

  // ----- Detail card data ------------------------------------------- //

  const selectedInfo = selected && kanji.resources?.kanji[selected];
  const examples = useMemo(
    () => (selected ? findKanjiExamples(selected, 10) : []),
    [selected, findKanjiExamples],
  );
  const cardData: KanjiCardData | null =
    selected && selectedInfo
      ? { char: selected, info: selectedInfo, examples }
      : null;

  // ----- Actions ----------------------------------------------------- //

  const onClearStrokes = useCallback(() => {
    setStrokes([]);
    setDrawCandidates([]);
  }, []);
  const onUndoStroke = useCallback(
    () => setStrokes((s) => (s.length === 0 ? s : s.slice(0, -1))),
    [],
  );
  const onCopySelected = useCallback(() => {
    if (selected && typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(selected);
    }
  }, [selected]);

  // ----- Empty / loading copy ---------------------------------------- //

  const kanjiStatus = kanji.status;
  const dataNotReady = kanjiStatus.kind !== "ready";

  const loadingMessage =
    kanjiStatus.kind === "loading"
      ? `${kanjiStatus.step} ${Math.round(kanjiStatus.progress * 100)}%`
      : kanjiStatus.kind === "error"
        ? `Kanji data failed to load: ${kanjiStatus.message}. Run the data pipeline to produce kanji.json.gz + radkfile.json.gz.`
        : "Loading kanji data…";

  const modeHint =
    mode === "type"
      ? "Type or paste a kanji above — every CJK character in the field becomes a candidate."
      : mode === "draw"
        ? "Draw a kanji in the box above — candidates appear as you complete each stroke."
        : "Select radicals from the panel above. Adding a radical narrows the matching kanji; incompatible radicals dim out.";

  return (
    <div className="screen kanji-screen">
      {/* Mode selector */}
      <section className="ks-modes">
        <Segmented<Mode>
          value={mode}
          options={[
            { value: "type", label: "Type" },
            { value: "draw", label: "Draw" },
            { value: "radicals", label: "Radicals" },
          ]}
          onChange={setMode}
          ariaLabel="Kanji input mode"
        />
      </section>

      {/* Per-mode input panel */}
      <section className="ks-input">
        {mode === "type" && (
          <TypePanel value={typedText} onChange={setTypedText} />
        )}
        {mode === "draw" && (
          <DrawPanel
            strokes={strokes}
            onStrokesChange={setStrokes}
            recognizerStatus={recognizer.status}
            onUndo={onUndoStroke}
            onClear={onClearStrokes}
          />
        )}
        {mode === "radicals" && (
          <RadicalsPanel
            kanjiStatus={kanjiStatus}
            resources={kanji.resources}
            selected={radicalSelection}
            onSelectedChange={setRadicalSelection}
            onResultsChange={setRadicalResults}
          />
        )}
      </section>

      {/* Candidate row — same primitive for all three modes. Draw mode can
          show more than one group when multi-character segmentation fires;
          groups are separated by an Ornament middot. */}
      <section className="ks-candidates">
        {candidateGroups.length > 0 ? (
          <div className="ks-candidate-row thin-scroll">
            {candidateGroups.map((group, gi) => (
              <Fragment key={gi}>
                {gi > 0 && (
                  <Ornament className="ks-candidate-divider">・</Ornament>
                )}
                {group.map((ch, i) => {
                  const drawScore =
                    mode === "draw"
                      ? drawCandidates[gi]?.find((c) => c.char === ch)?.score
                      : undefined;
                  const active =
                    mode === "draw"
                      ? ch === groupHighlights[gi]
                      : ch === selected;
                  return (
                    <KanjiTile
                      key={`${gi}-${ch}-${i}`}
                      char={ch}
                      score={drawScore}
                      active={active}
                      onClick={() => setSelected(ch)}
                      ariaLabel={`Show details for ${ch}`}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
        ) : (
          <p className="ks-empty ink-faint">
            {dataNotReady ? loadingMessage : modeHint}
          </p>
        )}
      </section>

      {/* Word suggestions — only meaningful in Draw mode when the segmenter
          found ≥2 characters AND at least one combination matched the
          dictionary. Tapping a suggestion jumps to Read with the headword
          seeded so the user can look it up immediately. */}
      {mode === "draw" && wordSuggestions.length > 0 && (
        <section className="ks-word-suggestions">
          <Eyebrow>Words</Eyebrow>
          <div className="ks-word-row thin-scroll">
            {wordSuggestions.map((sug) => (
              <Button
                key={sug.headword}
                variant="quiet"
                className="ks-word-tile"
                onClick={() => openInRead(sug.headword)}
                aria-label={`Open ${sug.headword} in Read`}
              >
                <span className="ks-word-headword jp">{sug.headword}</span>
                {sug.reading && sug.reading !== sug.headword && (
                  <span className="ks-word-reading jp">{sug.reading}</span>
                )}
                {sug.gloss && <span className="ks-word-gloss">{sug.gloss}</span>}
              </Button>
            ))}
          </div>
        </section>
      )}

      {/* Detail — when no candidates exist, the candidate-row section above
          already carries the loading/error/mode hint, so this section
          renders nothing (avoids showing two competing hints at once). */}
      <section className="ks-detail">
        {candidates.length === 0 ? null : dataNotReady ? (
          <p className="ks-empty ink-faint">{loadingMessage}</p>
        ) : cardData ? (
          <KanjiCard
            card={cardData}
            onCopy={onCopySelected}
            onRadicalClick={onRadicalSearch}
          />
        ) : selected && !selectedInfo ? (
          <p className="ks-empty ink-faint">
            <span className="jp">{selected}</span> is outside the shipped class
            set (kanji.json.gz only covers JMdict ∩ KANJIDIC2 ∩ RADKFILE).
          </p>
        ) : null}
      </section>
    </div>
  );
}


// ============================ Type panel =================================

function TypePanel({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="ks-type">
      <TextField
        jp
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="漢"
        autoFocus
        aria-label="Type or paste kanji"
        className="ks-type-input"
      />
      <p className="ks-type-hint ink-faint">
        Paste a sentence or just one character. Every CJK kanji in the field
        becomes a candidate below.
      </p>
    </div>
  );
}


// ============================ Draw panel =================================

function DrawPanel({
  strokes,
  onStrokesChange,
  recognizerStatus,
  onUndo,
  onClear,
}: {
  strokes: Stroke[];
  onStrokesChange: (next: Stroke[]) => void;
  recognizerStatus: ReturnType<typeof useKanjiRecognizer>["status"];
  onUndo: () => void;
  onClear: () => void;
}) {
  const status = recognizerStatus;
  return (
    <div className="ks-draw">
      <div className="ks-canvas-frame">
        <HandwritingCanvas
          strokes={strokes}
          onStrokesChange={onStrokesChange}
          disabled={status.kind !== "ready"}
          size={300}
        />
      </div>
      <div className="ks-draw-actions">
        <Button
          variant="ghost"
          leftIcon={<Icon.Undo size={14} />}
          onClick={onUndo}
          disabled={strokes.length === 0}
          aria-label="Undo last stroke"
        >
          Undo
        </Button>
        <Button
          variant="ghost"
          leftIcon={<Icon.Trash size={14} />}
          onClick={onClear}
          disabled={strokes.length === 0}
          aria-label="Clear all strokes"
        >
          Clear
        </Button>
        <span className="ink-faint mono ks-stroke-count">
          {strokes.length} stroke{strokes.length === 1 ? "" : "s"}
        </span>
      </div>
      {status.kind === "loading" && (
        <p className="ks-draw-status ink-faint">
          {status.step} {Math.round(status.progress * 100)}%
        </p>
      )}
      {status.kind === "error" && (
        <p className="ks-draw-status ink-faint">
          Recognizer failed to load: {status.message}
        </p>
      )}
    </div>
  );
}


// ============================ Radicals panel =============================

function RadicalsPanel({
  kanjiStatus,
  resources,
  selected,
  onSelectedChange,
  onResultsChange,
}: {
  kanjiStatus: ReturnType<typeof useKanjiData>["status"];
  resources: ReturnType<typeof useKanjiData>["resources"];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onResultsChange: (next: string[]) => void;
}) {
  if (kanjiStatus.kind === "loading") {
    return (
      <p className="ks-empty ink-faint">
        {kanjiStatus.step} {Math.round(kanjiStatus.progress * 100)}%
      </p>
    );
  }
  if (kanjiStatus.kind === "error") {
    return (
      <p className="ks-empty ink-faint">
        Radical data failed to load: {kanjiStatus.message}
      </p>
    );
  }
  if (!resources) return null;
  return (
    <div className="ks-radicals-wrap">
      <RadicalPicker
        resources={resources}
        selected={selected}
        onSelectedChange={onSelectedChange}
        onResultsChange={onResultsChange}
      />
    </div>
  );
}
