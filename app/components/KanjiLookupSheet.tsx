"use client";

// KanjiLookupSheet — shared host for both kanji-lookup modes plus the kanji
// detail view.
//
// Top-level state machine:
//
//   * detailChar === null  → picker mode: Segmented tabs + DrawPanel or
//                             RadicalsPanel. State for both tabs lives here
//                             so switching tabs preserves work.
//   * detailChar !== null  → detail mode: back/insert toolbar + KanjiCard.
//                             Tile state still lives here, so returning to
//                             the picker preserves it.
//
// All three panels feed into the same `onPick(char)` for the host. The
// sheet never auto-closes — the user may compose a multi-char query.

import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button";
import * as Icon from "./Icon";
import { HandwritingCanvas } from "./HandwritingCanvas";
import { KanjiCard, type KanjiCardData } from "./KanjiCard";
import { KanjiTile } from "./KanjiTile";
import { RadicalPicker } from "./RadicalPicker";
import { Segmented } from "./Segmented";
import { Sheet } from "./Sheet";
import { useAnalyzer } from "../providers/EngineProvider";
import { useKanjiRecognizer } from "../lib/handwriting/useKanjiRecognizer";
import type { Candidate, Stroke } from "../lib/handwriting/types";
import { useKanjiData } from "../lib/kanji/useKanjiData";

const TOP_K = 8;

type Tab = "draw" | "radicals";

export function KanjiLookupSheet({
  onClose,
  onPick,
}: {
  onClose: () => void;
  /** Fired when the user taps a candidate. The host should insert the
   *  character into its target field. The sheet does NOT auto-close — the
   *  user might want to insert several characters before dismissing. */
  onPick: (char: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("draw");
  const [detailChar, setDetailChar] = useState<string | null>(null);

  // Per-tab state lives here because the candidate row is shared and the
  // detail mode can be triggered from either tab — state must survive both
  // tab switches and the picker ↔ detail round-trip.
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawCandidates, setDrawCandidates] = useState<Candidate[]>([]);
  const [radicalSelection, setRadicalSelection] = useState<Set<string>>(
    () => new Set(),
  );
  const [radicalResults, setRadicalResults] = useState<string[]>([]);

  const recognizer = useKanjiRecognizer();

  const showDetail = useCallback((char: string) => setDetailChar(char), []);
  const closeDetail = useCallback(() => setDetailChar(null), []);
  const onInsertFromDetail = useCallback(
    (char: string) => {
      onPick(char);
      setDetailChar(null);
    },
    [onPick],
  );
  /** Detail-mode action: seed the radicals tab with a single radical and
   *  jump there. Closes detail and switches tabs in one transition so the
   *  user lands directly on the freshly-narrowed kanji list. */
  const onRadicalSearchSeed = useCallback((radical: string) => {
    setRadicalSelection(new Set([radical]));
    setTab("radicals");
    setDetailChar(null);
  }, []);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <Sheet onClose={onClose} className="hw-sheet">
        {detailChar === null ? (
          <>
            <div className="hw-sheet-head">
              <Segmented<Tab>
                value={tab}
                options={[
                  { value: "draw", label: "Draw" },
                  { value: "radicals", label: "Radicals" },
                ]}
                onChange={setTab}
                ariaLabel="Kanji lookup mode"
              />
            </div>

            {tab === "draw" ? (
              <DrawPanel
                strokes={strokes}
                onStrokesChange={setStrokes}
                candidates={drawCandidates}
                onCandidatesChange={setDrawCandidates}
                recognizerStatus={recognizer.status}
                recognize={recognizer.recognize}
                onPick={onPick}
                onInfo={showDetail}
              />
            ) : (
              <RadicalsPanel
                selected={radicalSelection}
                onSelectedChange={setRadicalSelection}
                results={radicalResults}
                onResultsChange={setRadicalResults}
                onPick={onPick}
                onInfo={showDetail}
              />
            )}
          </>
        ) : (
          <DetailPanel
            char={detailChar}
            onBack={closeDetail}
            onInsert={onInsertFromDetail}
            onRadicalSearch={onRadicalSearchSeed}
          />
        )}
      </Sheet>
    </>
  );
}


// ============================ Draw tab ===================================

function DrawPanel({
  strokes,
  onStrokesChange,
  candidates,
  onCandidatesChange,
  recognizerStatus,
  recognize,
  onPick,
  onInfo,
}: {
  strokes: Stroke[];
  onStrokesChange: (next: Stroke[]) => void;
  candidates: Candidate[];
  onCandidatesChange: (next: Candidate[]) => void;
  recognizerStatus: ReturnType<typeof useKanjiRecognizer>["status"];
  recognize: ReturnType<typeof useKanjiRecognizer>["recognize"];
  onPick: (char: string) => void;
  onInfo: (char: string) => void;
}) {
  useEffect(() => {
    if (recognizerStatus.kind !== "ready") return;
    if (strokes.length === 0) return;
    let cancelled = false;
    void recognize(strokes, TOP_K).then((next) => {
      if (cancelled) return;
      onCandidatesChange(next);
    });
    return () => {
      cancelled = true;
    };
  }, [strokes, recognize, recognizerStatus.kind, onCandidatesChange]);

  const onClear = useCallback(() => {
    onStrokesChange([]);
    onCandidatesChange([]);
  }, [onStrokesChange, onCandidatesChange]);
  const onUndo = useCallback(() => {
    onStrokesChange(strokes.length === 0 ? strokes : strokes.slice(0, -1));
  }, [strokes, onStrokesChange]);

  const shownCandidates: Candidate[] = strokes.length === 0 ? [] : candidates;
  const status = recognizerStatus;
  const loadingLabel =
    status.kind === "loading"
      ? `${status.step} ${Math.round(status.progress * 100)}%`
      : status.kind === "error"
        ? `Recognizer failed to load: ${status.message}`
        : strokes.length === 0
          ? "Draw a kanji above — candidates appear as you stroke."
          : shownCandidates.length === 0
            ? "Recognizing…"
            : null;

  return (
    <>
      <div className="hw-canvas-wrap">
        <HandwritingCanvas
          strokes={strokes}
          onStrokesChange={onStrokesChange}
          disabled={status.kind !== "ready"}
        />
      </div>

      <div className="hw-actions">
        <Button
          variant="ghost"
          leftIcon={<Icon.Undo size={14} />}
          onClick={onUndo}
          disabled={strokes.length === 0}
          aria-label="Undo last stroke"
        >
          <span className="btn-label-md">Undo</span>
        </Button>
        <Button
          variant="ghost"
          leftIcon={<Icon.Trash size={14} />}
          onClick={onClear}
          disabled={strokes.length === 0}
          aria-label="Clear all strokes"
        >
          <span className="btn-label-md">Clear</span>
        </Button>
        <span className="ink-faint mono hw-stroke-count">
          {strokes.length} stroke{strokes.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="hw-candidates">
        {shownCandidates.length > 0 ? (
          <div className="hw-candidate-row">
            {shownCandidates.map((c) => (
              <KanjiTile
                key={c.classIndex}
                char={c.char}
                score={c.score}
                onClick={() => onPick(c.char)}
                onInfo={() => onInfo(c.char)}
              />
            ))}
          </div>
        ) : (
          loadingLabel && (
            <div className="hw-status ink-faint">{loadingLabel}</div>
          )
        )}
      </div>
    </>
  );
}


// ============================ Radicals tab ===============================

function RadicalsPanel({
  selected,
  onSelectedChange,
  results,
  onResultsChange,
  onPick,
  onInfo,
}: {
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  results: string[];
  onResultsChange: (next: string[]) => void;
  onPick: (char: string) => void;
  onInfo: (char: string) => void;
}) {
  const kanji = useKanjiData();
  const status = kanji.status;

  if (status.kind === "loading") {
    return (
      <div className="hw-status ink-faint">
        {status.step} {Math.round(status.progress * 100)}%
      </div>
    );
  }
  if (status.kind === "error") {
    return (
      <div className="hw-status ink-faint">
        Radical data failed to load: {status.message}
      </div>
    );
  }
  if (!kanji.resources) {
    return null;
  }

  return (
    <>
      <RadicalPicker
        resources={kanji.resources}
        selected={selected}
        onSelectedChange={onSelectedChange}
        onResultsChange={onResultsChange}
      />
      <div className="hw-candidates">
        {results.length > 0 ? (
          <div className="hw-candidate-row">
            {results.map((char) => (
              <KanjiTile
                key={char}
                char={char}
                onClick={() => onPick(char)}
                onInfo={() => onInfo(char)}
              />
            ))}
          </div>
        ) : (
          <div className="hw-status ink-faint">
            Pick a radical to narrow the list — incompatible radicals dim out.
          </div>
        )}
      </div>
    </>
  );
}


// ============================ Detail mode ================================

function DetailPanel({
  char,
  onBack,
  onInsert,
  onRadicalSearch,
}: {
  char: string;
  onBack: () => void;
  onInsert: (char: string) => void;
  /** Tapping a radical chip in the card seeds the radicals tab with that
   *  one radical and jumps there, closing detail. */
  onRadicalSearch: (radical: string) => void;
}) {
  // useKanjiData is module-cached at the loader level — if Radicals already
  // loaded the data, this is instant; otherwise it kicks off the fetch now.
  const kanji = useKanjiData();
  const { findKanjiExamples } = useAnalyzer();

  const status = kanji.status;
  const info = kanji.resources?.kanji[char];
  const examples = info ? findKanjiExamples(char, 8) : [];

  const cardData: KanjiCardData | null = info ? { char, info, examples } : null;

  const onCopyChar = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(char);
    }
  }, [char]);

  return (
    <>
      <div className="hw-sheet-head kc-toolbar">
        <Button
          variant="ghost"
          leftIcon={<Icon.Collapse size={14} style={{ transform: "rotate(90deg)" }} />}
          onClick={onBack}
          aria-label="Back to picker"
        >
          <span className="btn-label-md">Back</span>
        </Button>
        <Button
          variant="primary"
          onClick={() => onInsert(char)}
          aria-label={`Insert ${char}`}
        >
          <span>Insert <span className="jp">{char}</span></span>
        </Button>
      </div>

      <div className="kc-body thin-scroll">
        {status.kind === "loading" ? (
          <div className="hw-status ink-faint">
            {status.step} {Math.round(status.progress * 100)}%
          </div>
        ) : status.kind === "error" ? (
          <div className="hw-status ink-faint">
            Kanji data failed to load: {status.message}
          </div>
        ) : !cardData ? (
          <div className="hw-status ink-faint">
            No metadata for <span className="jp">{char}</span>. The character
            may be outside the shipped class set.
          </div>
        ) : (
          <KanjiCard
            card={cardData}
            onCopy={onCopyChar}
            onRadicalClick={onRadicalSearch}
          />
        )}
      </div>
    </>
  );
}
