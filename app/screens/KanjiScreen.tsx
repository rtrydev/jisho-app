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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Button } from "../components/Button";
import { Eyebrow } from "../components/Eyebrow";
import * as Icon from "../components/Icon";
import { HandwritingCanvas } from "../components/HandwritingCanvas";
import { KanjiCard } from "../components/KanjiCard";
import { KanjiTile } from "../components/KanjiTile";
import { RadicalPicker } from "../components/RadicalPicker";
import { Segmented, type SegmentedOption } from "../components/Segmented";
import { TextField } from "../components/TextField";
import { useIsMobile } from "../components/AppShell";
import { useKanjiData } from "../lib/kanji/useKanjiData";
import { useKanjiRecognizer } from "../lib/handwriting/useKanjiRecognizer";
import { imageToCells, type ReadAxis } from "../lib/handwriting/imagePreprocess";
import { useCameraCapture, cameraSupported } from "../lib/camera/useCameraCapture";
import { useAnalyzer } from "../providers/EngineProvider";
import { useNav } from "../JishoApp";
import { writeKanjiParam } from "../lib/share";
import type { Candidate, Stroke } from "../lib/handwriting/types";

type Mode = "type" | "draw" | "radicals" | "camera";

const TOP_K = 12;

// Centered guide box per reading axis, as fractions of the viewfinder stage.
// The crop on capture and the overlay rectangle are both derived from these,
// so the box the user frames is exactly what gets read.
const GUIDE_BOX: Record<ReadAxis, { fx: number; fy: number; fw: number; fh: number }> = {
  h: { fx: 0.07, fy: 0.33, fw: 0.86, fh: 0.34 },
  v: { fx: 0.33, fy: 0.07, fw: 0.34, fh: 0.86 },
};

// ONNX inference runs in a dedicated Web Worker (see lib/handwriting/
// recognizerClient.ts → recognizer.worker.ts), so the forward passes no longer
// block the canvas pointer events — a stroke always starts on touch even
// mid-recognition. The debounce stays only to coalesce a flurry of strokes into
// a single recognize pass: recognizing every intermediate stroke would queue
// redundant inference whose results are immediately superseded. ~150ms is below
// the stroke-to-stroke gap of normal handwriting, so candidates still refresh
// the moment the hand pauses.
const RECOGNIZE_DEBOUNCE_MS = 150;

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
  // Camera mode produces the same per-character shape as Draw, so it flows
  // through the same downstream candidate/detail/word-suggestion logic.
  const [cameraCandidates, setCameraCandidates] = useState<Candidate[][]>([]);
  const [radicalSelection, setRadicalSelection] = useState<Set<string>>(
    () => new Set(),
  );
  const [radicalResults, setRadicalResults] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(
    initialChar ? (extractKanji(initialChar)[0] ?? null) : null,
  );

  // Camera entry is mobile-only and needs a secure context with getUserMedia.
  // `cameraSupported()` reads navigator/window, so it can't run during SSR —
  // read it through useSyncExternalStore (server snapshot `false`, client
  // snapshot real) the same way useIsMobile bridges the breakpoint. It never
  // changes at runtime, so the subscribe is a no-op.
  const isMobile = useIsMobile();
  const camAvailable = useSyncExternalStore(
    () => () => {},
    () => cameraSupported(),
    () => false,
  );
  const showCamera = isMobile && camAvailable;

  // If the Camera segment goes away (resize to desktop, or it was never
  // available), don't strand the screen on a hidden mode.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mode === "camera" && !showCamera) setMode("type");
  }, [mode, showCamera]);

  // When the parent deep-links a seed, jump back to Type mode and drop the
  // whole string into the field. `initialChar` is now a *combined* input
  // string (one or many kanji — see `inputString` below), so a multi-kanji
  // query restores all of its candidates, with the first one inspected.
  // The setStates here legitimately sync state from props — the screen's
  // initial state can't be expressed in useState because the prop changes
  // after mount via the openKanji nav action.
  useEffect(() => {
    if (initialChar && initialChar !== typedText) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode("type");
      setTypedText(initialChar);
      setSelected(extractKanji(initialChar)[0] ?? null);
    }
    onClearInitial?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialChar]);

  // ----- Candidates per mode (memoized; cheap) ---------------------- //

  const typeCandidates = useMemo<string[]>(
    () => extractKanji(typedText),
    [typedText],
  );
  // Draw and Camera share a per-character candidate shape (Candidate[][]), so
  // the rest of the screen treats them identically via `multiGroups`. Draw
  // hides stale output when strokes are wiped (clearing in an effect would trip
  // the set-state-in-effect rule); Camera clears via the panel's onResult on
  // retake / mode entry.
  const isMulti = mode === "draw" || mode === "camera";
  const multiGroups = useMemo<Candidate[][]>(() => {
    if (mode === "draw") return strokes.length === 0 ? [] : drawCandidates;
    if (mode === "camera") return cameraCandidates;
    return [];
  }, [mode, strokes.length, drawCandidates, cameraCandidates]);
  // Grouped view for rendering — type/radicals modes always have a single
  // group; draw/camera have one per detected character.
  const candidateGroups: string[][] = useMemo(() => {
    if (mode === "type")
      return typeCandidates.length ? [typeCandidates] : [];
    if (isMulti)
      return multiGroups
        .map((g) => g.map((c) => c.char))
        .filter((g) => g.length > 0);
    return radicalResults.length ? [radicalResults] : [];
  }, [mode, isMulti, typeCandidates, multiGroups, radicalResults]);
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
    if (!isMulti) return [];
    return multiGroups.map((g) => {
      if (selected && g.some((c) => c.char === selected)) return selected;
      return g[0]?.char ?? "";
    });
  }, [isMulti, multiGroups, selected]);

  // The combined kanji string currently shown for this mode: every kanji in the
  // Type field, every detected character in a Draw (its highlighted candidate),
  // or the single inspected result in Radicals. This is what we mirror to the
  // URL (below) so a refresh or shared link restores the *whole* multi-character
  // input, not just the one kanji whose detail card happens to be open.
  const inputString = useMemo<string>(() => {
    if (mode === "type") return typeCandidates.join("");
    if (isMulti) return groupHighlights.join("");
    return selected ?? "";
  }, [mode, isMulti, typeCandidates, groupHighlights, selected]);

  // Mirror the current input string to ?kanji= so refresh/share lands you where
  // you were. Treats the Kanji screen the same way ReadScreen mirrors ?q=. The
  // seed flows back through `initialChar` → Type field on load, so a multi-kanji
  // input round-trips as its combined string.
  useEffect(() => {
    writeKanjiParam(inputString);
  }, [inputString]);

  // Auto-select the top candidate when a new candidate list comes in for a
  // mode. Type/Radicals preserve an explicit user pick ("if you type a kanji
  // directly, you didn't have to also click it"). Draw mode refines with each
  // stroke, so every candidate change is treated as a brand-new input and we
  // re-snap to the top recognizer guess — the selected candidate in a segment
  // must always be its highest-confidence one. The user can still click
  // another tile to inspect it until the next stroke changes the candidates.
  useEffect(() => {
    if (!candidates.length) return;
    if (isMulti) {
      // Draw refines per stroke and each Camera capture is a fresh input, so a
      // new candidate list always re-snaps to the top recognizer guess.
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
    // Debounced so rapid strokes coalesce into one worker round-trip — see
    // RECOGNIZE_DEBOUNCE_MS. The cleanup clears the pending timer, so a new
    // stroke arriving within the window resets the wait instead of stacking up,
    // and `cancelled` drops a result that resolves after newer strokes landed.
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
    if (!isMulti) return [];
    return suggestWordCombinations(multiGroups);
  }, [isMulti, multiGroups, suggestWordCombinations]);

  // ----- Radical click-through from KanjiCard ----------------------- //

  const onRadicalSearch = useCallback((radical: string) => {
    setRadicalSelection(new Set([radical]));
    setMode("radicals");
    setSelected(null);
  }, []);

  // ----- Detail entries --------------------------------------------- //
  //
  // One entry per slot the user is inspecting. Draw mode can detect several
  // character groups, and each gets its own card driven by that group's
  // highlighted candidate (groupHighlights) — so a two-kanji drawing yields
  // two cards, not one. Type/Radicals inspect the single explicit `selected`.
  // An entry whose char isn't in the shipped class set carries a null `info`,
  // so the detail shows the out-of-set note in its place.
  const detailChars = useMemo<string[]>(() => {
    if (isMulti) return groupHighlights.filter((c) => c.length > 0);
    return selected ? [selected] : [];
  }, [isMulti, groupHighlights, selected]);

  const detailEntries = useMemo(
    () =>
      detailChars.map((char) => {
        const info = kanji.resources?.kanji[char] ?? null;
        return { char, info, examples: info ? findKanjiExamples(char, 10) : [] };
      }),
    [detailChars, kanji.resources, findKanjiExamples],
  );

  // ----- Actions ----------------------------------------------------- //

  const onClearStrokes = useCallback(() => {
    setStrokes([]);
    setDrawCandidates([]);
  }, []);
  const onUndoStroke = useCallback(
    () => setStrokes((s) => (s.length === 0 ? s : s.slice(0, -1))),
    [],
  );
  const copyChar = useCallback((char: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(char);
    }
  }, []);

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
        : mode === "camera"
          ? "Capture a line of kanji with the camera above — candidates appear after the shot. Kana isn't read."
          : "Select radicals from the panel above. Adding a radical narrows the matching kanji; incompatible radicals dim out.";

  // The Camera segment only appears on mobile with a usable camera; everything
  // else keeps the original three.
  const modeOptions: SegmentedOption<Mode>[] = [
    { value: "type", label: "Type" },
    { value: "draw", label: "Draw" },
    { value: "radicals", label: "Radicals" },
  ];
  if (showCamera) modeOptions.push({ value: "camera", label: "Camera" });

  return (
    <div className="screen kanji-screen">
      {/* Mode selector */}
      <section className="ks-modes">
        <Segmented<Mode>
          value={mode}
          options={modeOptions}
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
        {mode === "camera" && showCamera && (
          <CameraPanel
            recognizeImage={recognizer.recognizeImage}
            recognizerStatus={recognizer.status}
            onResult={setCameraCandidates}
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

      {/* Candidates — one horizontally-scrolling row per detected character.
          Type/Radicals produce a single group (one row); Draw/Camera produce
          one row per segmented character, stacked top-to-bottom. */}
      <section className="ks-candidates">
        {candidateGroups.length > 0 ? (
          <div className="ks-candidate-groups">
            {candidateGroups.map((group, gi) => (
              <div className="ks-candidate-row thin-scroll" key={gi}>
                {group.map((ch, i) => {
                  const score = isMulti
                    ? multiGroups[gi]?.find((c) => c.char === ch)?.score
                    : undefined;
                  const active = isMulti
                    ? ch === groupHighlights[gi]
                    : ch === selected;
                  return (
                    <KanjiTile
                      key={`${gi}-${ch}-${i}`}
                      char={ch}
                      score={score}
                      active={active}
                      onClick={() => setSelected(ch)}
                      ariaLabel={`Show details for ${ch}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <p className="ks-empty ink-faint">
            {dataNotReady ? loadingMessage : modeHint}
          </p>
        )}
      </section>

      {/* Word suggestions — meaningful in Draw and Camera modes when ≥2
          characters were detected AND at least one combination matched the
          dictionary. Tapping a suggestion jumps to Read with the headword
          seeded so the user can look it up immediately. */}
      {isMulti && wordSuggestions.length > 0 && (
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
        ) : (
          detailEntries.map((entry, i) =>
            entry.info ? (
              <KanjiCard
                key={`${i}-${entry.char}`}
                card={{
                  char: entry.char,
                  info: entry.info,
                  examples: entry.examples,
                }}
                onCopy={() => copyChar(entry.char)}
                onRadicalClick={onRadicalSearch}
              />
            ) : (
              <p key={`${i}-${entry.char}`} className="ks-empty ink-faint">
                <span className="jp">{entry.char}</span> is outside the shipped
                class set (kanji.json.gz only covers JMdict ∩ KANJIDIC2 ∩
                RADKFILE).
              </p>
            ),
          )
        )}
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


// ============================ Camera panel ===============================
//
// Multi-character camera capture (mobile-only). A live rear-camera viewfinder
// with a manual horizontal/vertical guide box; the shutter grabs one still,
// crops it to the guide box, runs the pixel pipeline (imagePreprocess.ts), and
// recognizes each detected cell off the main thread. Results flow through the
// same candidate row + KanjiCard as Draw. Capture-then-process, not live —
// the recognizer is WASM and the pre-stage is one-shot (FINDINGS §9).

type CropRect = { fx: number; fy: number; fw: number; fh: number };

function CameraPanel({
  recognizeImage,
  recognizerStatus,
  onResult,
}: {
  recognizeImage: (
    cells: Float32Array[],
    topK?: number,
  ) => Promise<Candidate[][]>;
  recognizerStatus: ReturnType<typeof useKanjiRecognizer>["status"];
  onResult: (groups: Candidate[][]) => void;
}) {
  const { status, videoRef, start, stop, grabFrame } = useCameraCapture();
  const [axis, setAxis] = useState<ReadAxis>("h");
  const [phase, setPhase] = useState<"live" | "captured">("live");
  const [busy, setBusy] = useState(false);
  // The captured still is shown as the FULL frame at the same framing as the
  // live viewfinder (object-fit: cover), so the shot doesn't appear to zoom on
  // capture. The frame canvas is also kept in a ref so the crop can be re-read
  // at intrinsic resolution whenever the user adjusts the box.
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const frameRef = useRef<HTMLCanvasElement | null>(null);
  const [cropRect, setCropRect] = useState<CropRect>(GUIDE_BOX.h);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Mirrors for async handlers (pointer-up commit, axis change) so they read
  // the latest crop + axis without a stale closure.
  const cropRef = useRef(cropRect);
  const axisRef = useRef(axis);

  // Start the camera on entry and clear any candidates from a prior visit so
  // the candidate row matches the (empty) live viewfinder.
  useEffect(() => {
    start();
    onResult([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCrop = useCallback((next: CropRect) => {
    cropRef.current = next;
    setCropRect(next);
  }, []);

  // Crop the frozen frame to `rect` and recognize it along `readAxis`. Used by
  // the initial shutter, the crop-box commit, and axis changes.
  const recognizeCrop = useCallback(
    async (rect: CropRect, readAxis: ReadAxis) => {
      const stage = stageRef.current;
      const frame = frameRef.current;
      if (!stage || !frame) return;
      const crop = cropFromRect(frame, stage, rect);
      if (!crop) return;
      setBusy(true);
      try {
        const cells = imageToCells(crop, readAxis);
        onResult(await recognizeImage(cells, TOP_K));
      } finally {
        setBusy(false);
      }
    },
    [recognizeImage, onResult],
  );

  const onShutter = useCallback(async () => {
    const frame = grabFrame();
    if (!frame) return;
    frameRef.current = frame;
    setFrameUrl(frame.toDataURL("image/png"));
    const rect = GUIDE_BOX[axisRef.current];
    setCrop(rect);
    setPhase("captured");
    stop(); // freeze on the still; release the camera until Retake
    await recognizeCrop(rect, axisRef.current);
  }, [grabFrame, stop, setCrop, recognizeCrop]);

  const onRetake = useCallback(() => {
    frameRef.current = null;
    setFrameUrl(null);
    onResult([]);
    setPhase("live");
    start();
  }, [start, onResult]);

  const onChangeAxis = useCallback(
    (next: ReadAxis) => {
      axisRef.current = next;
      setAxis(next);
      if (phase === "captured") {
        // Re-segment the same still in the new reading direction.
        void recognizeCrop(cropRef.current, next);
      } else {
        // Live: reset the guide to the default shape for the new axis.
        setCrop(GUIDE_BOX[next]);
      }
    },
    [phase, recognizeCrop, setCrop],
  );

  const onCropCommit = useCallback(() => {
    void recognizeCrop(cropRef.current, axisRef.current);
  }, [recognizeCrop]);

  const live = status.kind === "streaming";
  const recognizerReady = recognizerStatus.kind === "ready";

  return (
    <div className="ks-camera">
      <Segmented<ReadAxis>
        value={axis}
        options={[
          { value: "h", label: "Horizontal" },
          { value: "v", label: "Vertical" },
        ]}
        onChange={onChangeAxis}
        ariaLabel="Reading direction"
      />

      <div className="ks-cam-stage" ref={stageRef}>
        {phase === "captured" ? (
          <>
            {frameUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="ks-cam-still" src={frameUrl} alt="Captured photo" />
            )}
            <CropBox
              rect={cropRect}
              stageRef={stageRef}
              onChange={setCrop}
              onCommit={onCropCommit}
            />
            {busy && <div className="ks-cam-veil">Reading…</div>}
          </>
        ) : live || status.kind === "requesting" ? (
          <>
            <video
              ref={videoRef}
              className="ks-cam-video"
              muted
              playsInline
              aria-label="Camera viewfinder"
            />
            <div
              className={`ks-cam-guide${axis === "v" ? " is-v" : ""}`}
              aria-hidden
            />
            {!live && <div className="ks-cam-veil">Starting camera…</div>}
          </>
        ) : (
          <CameraMessage status={status} onRetry={start} />
        )}
      </div>

      <div className="ks-cam-actions">
        {phase === "captured" ? (
          <Button
            variant="ghost"
            leftIcon={<Icon.Camera size={14} />}
            onClick={onRetake}
            aria-label="Retake photo"
          >
            Retake
          </Button>
        ) : (
          <Button
            variant="icon"
            className="ks-cam-shutter"
            onClick={onShutter}
            disabled={!live || !recognizerReady}
            aria-label="Capture"
          >
            <Icon.Camera size={22} />
          </Button>
        )}
      </div>

      <p className="ks-cam-hint ink-faint">
        {phase === "captured"
          ? "Drag the box to fine-tune what's read — it re-reads when you let go."
          : "Frame a line of kanji inside the box and tap the shutter. Kana isn’t read — kanji only."}
      </p>
      {recognizerStatus.kind === "loading" && (
        <p className="ks-draw-status ink-faint">
          {recognizerStatus.step} {Math.round(recognizerStatus.progress * 100)}%
        </p>
      )}
      {recognizerStatus.kind === "error" && (
        <p className="ks-draw-status ink-faint">
          Recognizer failed to load: {recognizerStatus.message}
        </p>
      )}
    </div>
  );
}

// Draggable + corner-resizable crop rectangle over the captured still. Works in
// stage fractions; pointer capture on the grabbed element keeps the drag alive
// even if the pointer leaves it, and events bubble back to the box so a single
// move/up handler covers both move and resize.
const MIN_CROP_FRAC = 0.08;
type DragMode = "move" | "nw" | "ne" | "sw" | "se";

function CropBox({
  rect,
  stageRef,
  onChange,
  onCommit,
}: {
  rect: CropRect;
  stageRef: RefObject<HTMLDivElement | null>;
  onChange: (next: CropRect) => void;
  onCommit: () => void;
}) {
  const drag = useRef<{ mode: DragMode; x: number; y: number; start: CropRect } | null>(
    null,
  );

  // One pointerdown handler on the box; the grabbed corner (if any) is read
  // from the hit element's data-handle, defaulting to "move" for the body.
  // Capture stays on the box so move/up keep firing through the drag.
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const mode = ((e.target as HTMLElement).dataset.handle as DragMode) || "move";
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, start: rect };
  };

  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    const stage = stageRef.current;
    if (!d || !stage) return;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (!sw || !sh) return;
    const dx = (e.clientX - d.x) / sw;
    const dy = (e.clientY - d.y) / sh;
    const s = d.start;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    let next: CropRect;
    if (d.mode === "move") {
      next = {
        fx: clamp(s.fx + dx, 0, 1 - s.fw),
        fy: clamp(s.fy + dy, 0, 1 - s.fh),
        fw: s.fw,
        fh: s.fh,
      };
    } else {
      let x0 = s.fx;
      let y0 = s.fy;
      let x1 = s.fx + s.fw;
      let y1 = s.fy + s.fh;
      if (d.mode === "nw" || d.mode === "sw") x0 = clamp(s.fx + dx, 0, x1 - MIN_CROP_FRAC);
      if (d.mode === "ne" || d.mode === "se") x1 = clamp(x1 + dx, x0 + MIN_CROP_FRAC, 1);
      if (d.mode === "nw" || d.mode === "ne") y0 = clamp(s.fy + dy, 0, y1 - MIN_CROP_FRAC);
      if (d.mode === "sw" || d.mode === "se") y1 = clamp(y1 + dy, y0 + MIN_CROP_FRAC, 1);
      next = { fx: x0, fy: y0, fw: x1 - x0, fh: y1 - y0 };
    }
    onChange(next);
  };

  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    onCommit();
  };

  const handles: DragMode[] = ["nw", "ne", "sw", "se"];
  return (
    <div
      className="ks-cam-crop"
      style={{
        left: `${rect.fx * 100}%`,
        top: `${rect.fy * 100}%`,
        width: `${rect.fw * 100}%`,
        height: `${rect.fh * 100}%`,
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      role="presentation"
    >
      {handles.map((h) => (
        <span key={h} className={`ks-cam-handle is-${h}`} data-handle={h} />
      ))}
    </div>
  );
}

function CameraMessage({
  status,
  onRetry,
}: {
  status: ReturnType<typeof useCameraCapture>["status"];
  onRetry: () => void;
}) {
  const copy: Partial<Record<typeof status.kind, string>> = {
    denied:
      "Camera access was denied. Enable camera permission for this site in your browser settings, then retry.",
    unsupported:
      "The camera needs a secure (https) connection and a browser that supports camera capture.",
    nocamera: "No camera was found on this device.",
    idle: "Starting camera…",
    requesting: "Requesting camera access…",
  };
  const message =
    status.kind === "error"
      ? `Camera error: ${status.message}`
      : (copy[status.kind] ?? "Camera unavailable.");
  const canRetry = status.kind === "denied" || status.kind === "error";
  return (
    <div className="ks-cam-msg ink-faint">
      <p>{message}</p>
      {canRetry && (
        <Button variant="quiet" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

// --- camera capture geometry --------------------------------------------- //

/** Map a crop rectangle (fractions of the stage) to a crop of the
 *  intrinsic-resolution frame, accounting for the still's object-fit: cover.
 *  The frozen <img> uses the same cover fit as the live <video>, so the box the
 *  user sees maps exactly to the pixels that get read. */
function cropFromRect(
  frame: HTMLCanvasElement,
  stage: HTMLElement,
  rect: CropRect,
): ImageData | null {
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const vw = frame.width;
  const vh = frame.height;
  if (!sw || !sh || !vw || !vh) return null;
  // object-fit: cover → the larger scale fills the stage; the overflow is
  // cropped equally on both sides. Invert that to find the visible region.
  const scale = Math.max(sw / vw, sh / vh);
  const visW = sw / scale;
  const visH = sh / scale;
  const visX = (vw - visW) / 2;
  const visY = (vh - visH) / 2;
  let cx = Math.round(visX + rect.fx * visW);
  let cy = Math.round(visY + rect.fy * visH);
  let cw = Math.round(rect.fw * visW);
  let ch = Math.round(rect.fh * visH);
  cx = Math.max(0, Math.min(cx, vw - 1));
  cy = Math.max(0, Math.min(cy, vh - 1));
  cw = Math.min(cw, vw - cx);
  ch = Math.min(ch, vh - cy);
  if (cw <= 0 || ch <= 0) return null;
  const ctx = frame.getContext("2d", { willReadFrequently: true });
  return ctx ? ctx.getImageData(cx, cy, cw, ch) : null;
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
