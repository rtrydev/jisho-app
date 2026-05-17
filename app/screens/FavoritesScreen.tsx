"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Hanko } from "../components/Hanko";
import { Segmented } from "../components/Segmented";
import { TermCard } from "../components/TermCard";
import { useToast } from "../components/Toast";
import { useIsMobile } from "../components/AppShell";
import { dictKeyOf } from "../lib/analyzer";
import { writeClipboard } from "../lib/copy";
import {
  exportJson,
  exportMarkdown,
  importJson,
  type FavoriteType,
} from "../lib/favorites";
import { buildShareUrl } from "../lib/share";
import { useAnalyzer } from "../providers/EngineProvider";
import { useUserData } from "../providers/UserDataProvider";

type Tab = "vocab" | "grammar";

export function FavoritesScreen() {
  const mobile = useIsMobile();
  const { favorites, toggleFavorite, importFavorites } = useUserData();
  const { getEntry } = useAnalyzer();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("vocab");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const copyTerm = useCallback(
    (term: string) => {
      void writeClipboard(term).then((ok) => {
        if (ok)
          showToast({
            message: (
              <>
                Copied <span className="jp">{term}</span>
              </>
            ),
            tone: "success",
          });
      });
    },
    [showToast],
  );

  const copyShareLink = useCallback(
    (term: string) => {
      void writeClipboard(buildShareUrl(term)).then((ok) => {
        if (ok)
          showToast({
            message: (
              <>
                Share link for <span className="jp">{term}</span> copied
              </>
            ),
            tone: "success",
          });
      });
    },
    [showToast],
  );

  const handleToggleFavorite = useCallback(
    (type: "vocab" | "grammar", dictKey: string, term: string) => {
      const wasFav = favorites.entries.some(
        (e) => e.type === type && e.dictKey === dictKey,
      );
      toggleFavorite(type, dictKey, term);
      showToast({
        message: wasFav ? (
          <>
            Removed <span className="jp">{term}</span> from favorites
          </>
        ) : (
          <>
            Added <span className="jp">{term}</span> to favorites
          </>
        ),
        tone: wasFav ? "warn" : "success",
      });
    },
    [favorites, toggleFavorite, showToast],
  );

  const vocab = useMemo(() => favorites.entries.filter((e) => e.type === "vocab"), [favorites]);
  const grammar = useMemo(() => favorites.entries.filter((e) => e.type === "grammar"), [favorites]);

  const shown = tab === "vocab" ? vocab : grammar;

  // Re-resolve full cards live from the dictionary.
  const cards = useMemo(() => {
    const out: Array<{
      entry: (typeof shown)[number];
      card: NonNullable<ReturnType<typeof getEntry>>;
    }> = [];
    for (const e of shown) {
      const card = getEntry(e.type, e.dictKey);
      if (card) out.push({ entry: e, card });
    }
    return out;
  }, [shown, getEntry]);

  const onExport = useCallback(() => {
    const md = exportMarkdown(favorites);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jisho-favorites-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [favorites]);

  const onExportJson = useCallback(() => {
    const json = exportJson(favorites);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jisho-favorites-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [favorites]);

  const onImportFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = importJson(text);
      if (parsed) importFavorites(parsed);
    },
    [importFavorites],
  );

  const handleType: FavoriteType = tab;

  return (
    <div className="screen favorites">
      <header className="sc-head">
        <div>
          <h1 className="sc-title" style={{ display: "flex", alignItems: "center" }}>
            Favorites
            <span style={{ marginLeft: 10 }}>
              <Hanko size="mini">印</Hanko>
            </span>
          </h1>
          <div className="sc-sub mono ink-faint">
            {favorites.entries.length} saved · re-resolved from live dictionary
          </div>
        </div>
        <div className="sc-head-actions sc-head-actions-equal">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = "";
            }}
          />
          <Button variant="quiet" onClick={() => fileInputRef.current?.click()}>
            Import…
          </Button>
          <Button variant="quiet" onClick={onExportJson} disabled={favorites.entries.length === 0}>
            Export JSON
          </Button>
          <Button variant="quiet" onClick={onExport} disabled={favorites.entries.length === 0}>
            Export {favorites.entries.length}
          </Button>
        </div>
      </header>

      <Segmented<Tab>
        value={tab}
        variant="card"
        onChange={setTab}
        ariaLabel="Favorites type"
        options={[
          { value: "vocab", label: <>Vocabulary <span className="mono ink-faint"> · {vocab.length}</span></> },
          { value: "grammar", label: <>Grammar <span className="mono ink-faint"> · {grammar.length}</span></> },
        ]}
      />

      <div className="screen-body">
        {cards.length === 0 ? (
          <div className="fav-empty">
            {shown.length === 0
              ? `No ${handleType} favorites yet. Save terms from the Read screen.`
              : `${shown.length} saved — but the dictionary doesn't expose these keys in the current stub.`}
          </div>
        ) : mobile ? (
          <div className="fav-grid">
            {cards.map(({ entry, card }) => {
              const term = card.surface ?? card.head;
              return (
                <TermCard
                  key={entry.id}
                  card={card}
                  favorite
                  onToggleFavorite={() => handleToggleFavorite(card.type, dictKeyOf(card), term)}
                  onCopy={() => copyTerm(term)}
                  onShare={() => copyShareLink(term)}
                  compact={mobile}
                />
              );
            })}
          </div>
        ) : (
          <div className="fav-grid rc-grid-cols">
            {[cards.filter((_, i) => i % 2 === 0), cards.filter((_, i) => i % 2 === 1)].map((col, colIdx) => (
              <div className="rc-col" key={colIdx}>
                {col.map(({ entry, card }) => {
                  const term = card.surface ?? card.head;
                  return (
                    <TermCard
                      key={entry.id}
                      card={card}
                      favorite
                      onToggleFavorite={() => handleToggleFavorite(card.type, dictKeyOf(card), term)}
                      onCopy={() => copyTerm(term)}
                      onShare={() => copyShareLink(term)}
                      compact={mobile}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
