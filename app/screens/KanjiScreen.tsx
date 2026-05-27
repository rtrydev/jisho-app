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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";
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
import { writeKanjiParam } from "../lib/share";
import type { Candidate, Stroke } from "../lib/handwriting/types";

type Mode = "type" | "draw" | "radicals";

const TOP_K = 12;

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
  const { findKanjiExamples } = useAnalyzer();

  const [mode, setMode] = useState<Mode>(initialChar ? "type" : "type");
  const [typedText, setTypedText] = useState<string>(initialChar ?? "");
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawCandidates, setDrawCandidates] = useState<Candidate[]>([]);
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
  const drawCandidateChars = useMemo<string[]>(
    () => (strokes.length === 0 ? [] : drawCandidates.map((c) => c.char)),
    [drawCandidates, strokes.length],
  );
  const candidates: string[] =
    mode === "type"
      ? typeCandidates
      : mode === "draw"
        ? drawCandidateChars
        : radicalResults;

  // Auto-select the top candidate the first time a new candidate list comes
  // in for a mode — but never override an explicit user pick. The intent is
  // "if you type a kanji directly, you didn't have to also click it".
  useEffect(() => {
    if (!candidates.length) return;
    if (selected && candidates.includes(selected)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(candidates[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.join("|")]);

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
    void recognizeFn(strokes, TOP_K).then((next) => {
      if (cancelled) return;
      setDrawCandidates(next);
    });
    return () => {
      cancelled = true;
    };
  }, [strokes, recognizeFn, recognizerKind, mode]);

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

      {/* Candidate row — same primitive for all three modes. */}
      <section className="ks-candidates">
        {candidates.length > 0 ? (
          <div className="ks-candidate-row thin-scroll">
            {candidates.map((ch, i) => {
              const drawScore = drawCandidates.find((c) => c.char === ch)?.score;
              return (
                <KanjiTile
                  key={ch + i}
                  char={ch}
                  score={mode === "draw" ? drawScore : undefined}
                  active={ch === selected}
                  onClick={() => setSelected(ch)}
                  ariaLabel={`Show details for ${ch}`}
                />
              );
            })}
          </div>
        ) : (
          <p className="ks-empty ink-faint">
            {dataNotReady ? loadingMessage : modeHint}
          </p>
        )}
      </section>

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
