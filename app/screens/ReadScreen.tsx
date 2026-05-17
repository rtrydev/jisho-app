"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Icon from "../components/Icon";
import { BreakdownChip, BreakdownLegend } from "../components/BreakdownChip";
import { Button } from "../components/Button";
import { Segmented } from "../components/Segmented";
import { Sheet } from "../components/Sheet";
import { TermCard, type TermCardData } from "../components/TermCard";
import { useIsMobile } from "../components/AppShell";
import { dictKeyOf } from "../lib/analyzer";
import {
  DEMO_ENGLISH,
  DEMO_SOURCE,
  isDemoSentence,
} from "../lib/engine/demoResources";
import { formatAllResults, formatCard, formatGloss, writeClipboard } from "../lib/copy";
import { buildShareUrl } from "../lib/share";
import { useAnalyzer } from "../providers/EngineProvider";
import { useSettings } from "../providers/SettingsProvider";
import { useUserData } from "../providers/UserDataProvider";

type Filter = "all" | "vocab" | "grammar";

export function ReadScreen({
  initialText,
}: {
  initialText?: string;
}) {
  const mobile = useIsMobile();
  const { settings } = useSettings();
  const { result, status, run } = useAnalyzer();
  const { recordHistory, isFavorite, toggleFavorite } = useUserData();

  const [text, setText] = useState<string>(initialText ?? settings.defaultSentence);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sheetCardId, setSheetCardId] = useState<string | null>(null);
  const [shareConfirm, setShareConfirm] = useState(false);
  const [copyAllConfirm, setCopyAllConfirm] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pulseId, setPulseId] = useState<string | null>(null);

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lastAnalysed = useRef<string | null>(null);

  // Run analyzer when text changes; record history on first successful pass.
  // While the engine is still loading, `run` queues the text and replays it on
  // ready — so we re-run history-recording from `result` once that lands.
  useEffect(() => {
    if (lastAnalysed.current === text) return;
    lastAnalysed.current = text;
    const out = run(text);
    if (text.trim() && out.cardItems.length > 0) {
      recordHistory(text, out.cardItems.length);
    }
  }, [text, run, recordHistory]);

  useEffect(() => {
    if (status.kind === "ready" && result.text && result.cardItems.length > 0) {
      recordHistory(result.text, result.cardItems.length);
    }
  }, [status.kind, result.text, result.cardItems.length, recordHistory]);

  // Trigger a one-shot pulse highlight on the selected card.
  useEffect(() => {
    if (!pulseId) return;
    const id = window.setTimeout(() => setPulseId(null), 1300);
    return () => window.clearTimeout(id);
  }, [pulseId]);

  const visibleCards = useMemo<TermCardData[]>(() => {
    if (filter === "all") return result.cardItems;
    return result.cardItems.filter((c) => c.type === filter);
  }, [result.cardItems, filter]);

  const onChipClick = useCallback(
    (cardId: string | null | undefined) => {
      if (!cardId) return;
      setActiveChip(cardId);
      if (mobile) {
        setSheetCardId(cardId);
      } else {
        setPulseId(cardId);
        const el = cardRefs.current.get(cardId);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },
    [mobile],
  );

  const onShare = useCallback(async () => {
    const url = buildShareUrl(text);
    const ok = await writeClipboard(url);
    if (ok) {
      setShareConfirm(true);
      window.setTimeout(() => setShareConfirm(false), 1300);
    }
    // Native share where available
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav && "share" in nav) {
      try {
        await (nav as Navigator & { share: (d: ShareData) => Promise<void> }).share({
          title: "Jisho · " + text.slice(0, 24),
          text,
          url,
        });
      } catch {
        /* user cancelled */
      }
    }
  }, [text]);

  const onCopyAll = useCallback(async () => {
    const formatted = formatAllResults(text, result.english, result.cardItems, settings.copyFormat);
    const ok = await writeClipboard(formatted);
    if (ok) {
      setCopyAllConfirm(true);
      window.setTimeout(() => setCopyAllConfirm(false), 1300);
    }
  }, [text, result, settings.copyFormat]);

  const onCardCopy = useCallback(
    (card: TermCardData) => {
      void writeClipboard(formatCard(card, settings.copyFormat));
    },
    [settings.copyFormat],
  );

  const onCardShare = useCallback(
    (card: TermCardData) => {
      void writeClipboard(buildShareUrl(card.surface ?? card.head));
    },
    [],
  );

  const onCardFavorite = useCallback(
    (card: TermCardData) => {
      toggleFavorite(card.type, dictKeyOf(card), card.surface ?? card.head);
    },
    [toggleFavorite],
  );

  const sheetCard = sheetCardId
    ? result.cardItems.find((c) => c.id === sheetCardId) ?? null
    : null;

  const meaningfulTokenCount = result.tokens.filter((t) => t.pos !== "punct" && t.pos !== "記号").length;
  const showDemoTranslation = isDemoSentence(result.text);
  const englishCaption = result.english ?? (showDemoTranslation ? DEMO_ENGLISH : undefined);
  const sourceCaption = result.source ?? (showDemoTranslation ? DEMO_SOURCE : undefined);

  return (
    <div className={`screen read ${mobile ? "mobile" : "desktop"}`}>
      {/* Sticky input */}
      <section className={`read-input ${collapsed ? "" : "sticky"}`}>
        <div className="ri-head">
          <div className="ri-meta">
            <span className="ri-title serif">Analysis</span>
            {sourceCaption && (
              <span className="ink-faint mono"> · {sourceCaption}</span>
            )}
          </div>
          <div className="ri-actions">
            <Button
              variant="ghost"
              leftIcon={<Icon.ShareArrow size={12} />}
              onClick={onShare}
              aria-label="Share query"
            >
              {shareConfirm ? "Link copied" : "Share"}
            </Button>
            <Button
              variant="ghost"
              leftIcon={<Icon.Copy size={12} />}
              onClick={onCopyAll}
              disabled={result.cardItems.length === 0}
              aria-label="Copy all results"
            >
              {copyAllConfirm ? "Copied" : "Copy all"}
            </Button>
            <Button
              variant="icon"
              aria-label={collapsed ? "Expand input" : "Collapse input"}
              onClick={() => setCollapsed((c) => !c)}
            >
              <Icon.Collapse
                size={14}
                style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform .14s" }}
              />
            </Button>
          </div>
        </div>
        {!collapsed && (
          <>
            <div className="ri-field">
              <textarea
                className="ri-textarea jp"
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                rows={1}
                placeholder="日本語をペーストしてください…"
              />
            </div>
            {englishCaption && (
              <div className="ri-trans serif">
                <span className="ink-faint">“</span>
                {englishCaption}
                <span className="ink-faint">”</span>
              </div>
            )}
          </>
        )}
      </section>

      {/* Breakdown */}
      {result.tokens.length > 0 && (
        <section className="read-breakdown">
          <div className="rb-label">
            <span>Breakdown</span>
            <span className="ink-faint mono">
              {" "}
              · {meaningfulTokenCount} token{meaningfulTokenCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className="rb-chips thin-scroll">
            {result.tokens.map((t, i) => (
              <BreakdownChip
                key={i}
                token={t}
                active={!!t.cardId && activeChip === t.cardId}
                onClick={() => onChipClick(t.cardId)}
              />
            ))}
          </div>
          <BreakdownLegend />
        </section>
      )}

      {/* Cards */}
      <section className="read-cards read-cards-wrap">
        <div className="rc-head">
          <span className="rc-title">
            Terms <span className="ink-faint mono">· {result.cardItems.length}</span>
          </span>
          {result.cardItems.length > 0 && (
            <Segmented<Filter>
              value={filter}
              options={["all", "vocab", "grammar"]}
              onChange={setFilter}
              ariaLabel="Filter terms"
            />
          )}
        </div>
        {visibleCards.length === 0 ? (
          <div className="rc-empty">
            {status.kind === "loading"
              ? `${status.step} ${Math.round(status.progress * 100)}%`
              : status.kind === "error"
                ? `Engine failed to load: ${status.message}`
                : result.cardItems.length === 0
                  ? text.trim()
                    ? "No analysis available for this input."
                    : "Paste Japanese text above to begin."
                  : "No terms match this filter."}
          </div>
        ) : (
          <div className="rc-grid">
            {visibleCards.map((c) => (
              <div
                key={c.id}
                ref={(node) => {
                  if (node) cardRefs.current.set(c.id, node);
                  else cardRefs.current.delete(c.id);
                }}
              >
                <TermCard
                  card={c}
                  favorite={isFavorite(c.type, dictKeyOf(c))}
                  onToggleFavorite={() => onCardFavorite(c)}
                  onCopy={() => onCardCopy(c)}
                  onCopyGloss={(g) =>
                    void writeClipboard(formatGloss(g, settings.copyFormat))
                  }
                  onShare={() => onCardShare(c)}
                  highlight={pulseId === c.id}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Vertical kanji marginalia (desktop only) */}
      {!mobile && (
        <aside className="margin-tate" aria-hidden>
          辞 ・ 書 ・ 読 ・ 解
        </aside>
      )}

      {/* Mobile focus sheet */}
      {mobile && sheetCard && (
        <>
          <div
            className="sheet-backdrop"
            onClick={() => setSheetCardId(null)}
            aria-hidden
          />
          <Sheet>
            <button
              type="button"
              className="sheet-close"
              aria-label="Close"
              onClick={() => setSheetCardId(null)}
            >
              <Icon.Close size={14} />
            </button>
            <TermCard
              card={sheetCard}
              favorite={isFavorite(sheetCard.type, dictKeyOf(sheetCard))}
              onToggleFavorite={() => onCardFavorite(sheetCard)}
              onCopy={() => onCardCopy(sheetCard)}
              onCopyGloss={(g) =>
                void writeClipboard(formatGloss(g, settings.copyFormat))
              }
              onShare={() => onCardShare(sheetCard)}
            />
          </Sheet>
        </>
      )}
    </div>
  );
}
