"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Hanko } from "../components/Hanko";
import { Segmented } from "../components/Segmented";
import { TermCard } from "../components/TermCard";
import { useIsMobile } from "../components/AppShell";
import { dictKeyOf, getDictionaryEntry } from "../lib/analyzer";
import { formatCard, formatGloss, writeClipboard } from "../lib/copy";
import {
  exportJson,
  exportMarkdown,
  importJson,
  type FavoriteType,
} from "../lib/favorites";
import { buildShareUrl } from "../lib/share";
import { useSettings } from "../providers/SettingsProvider";
import { useUserData } from "../providers/UserDataProvider";

type Tab = "vocab" | "grammar";

export function FavoritesScreen() {
  const mobile = useIsMobile();
  const { settings } = useSettings();
  const { favorites, toggleFavorite, importFavorites } = useUserData();
  const [tab, setTab] = useState<Tab>("vocab");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const vocab = useMemo(() => favorites.entries.filter((e) => e.type === "vocab"), [favorites]);
  const grammar = useMemo(() => favorites.entries.filter((e) => e.type === "grammar"), [favorites]);

  const shown = tab === "vocab" ? vocab : grammar;

  // Re-resolve full cards live from the dictionary.
  const cards = useMemo(
    () =>
      shown
        .map((e) => ({
          entry: e,
          card: getDictionaryEntry(e.type, e.dictKey),
        }))
        .filter(
          (x): x is { entry: typeof shown[number]; card: NonNullable<ReturnType<typeof getDictionaryEntry>> } =>
            x.card !== null,
        ),
    [shown],
  );

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
    <div className={`screen favorites ${mobile ? "mobile" : "desktop"}`}>
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
        <div className="sc-head-actions">
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

      {cards.length === 0 ? (
        <div className="fav-empty">
          {shown.length === 0
            ? `No ${handleType} favorites yet. Save terms from the Read screen.`
            : `${shown.length} saved — but the dictionary doesn't expose these keys in the current stub.`}
        </div>
      ) : (
        <div className="fav-grid">
          {cards.map(({ entry, card }) => (
            <TermCard
              key={entry.id}
              card={card}
              favorite
              onToggleFavorite={() => toggleFavorite(card.type, dictKeyOf(card), card.surface ?? card.head)}
              onCopy={() => void writeClipboard(formatCard(card, settings.copyFormat))}
              onCopyGloss={(g) => void writeClipboard(formatGloss(g, settings.copyFormat))}
              onShare={() => void writeClipboard(buildShareUrl(card.surface ?? card.head))}
              compact={mobile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
