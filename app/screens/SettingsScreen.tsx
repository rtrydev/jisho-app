"use client";

import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { DataAction, DataActionGrid } from "../components/DataAction";
import { Hanko } from "../components/Hanko";
import { Segmented } from "../components/Segmented";
import { SettingGroup, SettingRow } from "../components/SettingGroup";
import { StorageBar } from "../components/StorageBar";
import { SwatchRow } from "../components/SwatchRow";
import { TextField } from "../components/TextField";
import { useToast } from "../components/Toast";
import { approximateUsageBytes } from "../lib/storage";
import type {
  Accent,
  CopyFormat,
  FuriganaMode,
  JpScale,
  Theme,
} from "../lib/settings";
import { useSettings } from "../providers/SettingsProvider";
import { useUserData } from "../providers/UserDataProvider";

type Confirm = null | "clearHistory" | "clearAll" | "reset";

const STORAGE_BUDGET = 5 * 1024 * 1024; // ~5 MB practical localStorage budget

export function SettingsScreen() {
  const { settings, setSetting, reset } = useSettings();
  const { history, favorites, clearHistory, clearAllData, storageStatus } = useUserData();
  const { showToast } = useToast();
  const [confirm, setConfirm] = useState<Confirm>(null);

  // Recompute usage whenever any persisted store changes. `approximateUsageBytes`
  // reads localStorage directly; the deps are signals that storage has shifted.
  const usageBytes = useMemo(
    () => approximateUsageBytes(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, favorites, settings],
  );
  const usageKb = (usageBytes / 1024).toFixed(1);

  return (
    <div className="screen settings">
      <header className="sc-head">
        <div>
          <h1 className="sc-title">Settings</h1>
          <div className="sc-sub mono ink-faint">
            Changes apply immediately · stored locally on this device
          </div>
        </div>
      </header>

      <div className="screen-body">
        {storageStatus.status !== "ready" && (
          <div className="storage-notice">
            Storage unavailable — settings won’t persist this session. ({storageStatus.reason ?? "no detail"})
          </div>
        )}

        <div className="set-groups">
        <SettingGroup
          kanji="外"
          title="Appearance"
          description="Theme tokens flow from here to every component."
        >
          <SettingRow label="Theme" hint="Sepia is a warm low-contrast reading mode.">
            <Segmented<Theme>
              value={settings.theme}
              options={["light", "dark", "sepia", "system"]}
              onChange={(v) => setSetting("theme", v)}
              ariaLabel="Theme"
            />
          </SettingRow>
          <SettingRow label="Japanese font scale" hint="Affects Mincho rendering and ruby spacing.">
            <Segmented<JpScale>
              value={settings.japaneseFontScale}
              options={["S", "M", "L"]}
              onChange={(v) => setSetting("japaneseFontScale", v)}
              ariaLabel="JP scale"
            />
          </SettingRow>
          <SettingRow label="Furigana" hint="Visible always, on hover only, or hidden entirely.">
            <Segmented<FuriganaMode>
              value={settings.furiganaMode}
              options={["always", "hover", "off"]}
              onChange={(v) => setSetting("furiganaMode", v)}
              ariaLabel="Furigana"
            />
          </SettingRow>
          <SettingRow label="Accent">
            <SwatchRow<Accent>
              value={settings.accent}
              options={[
                { id: "seal", color: "#b73a2a", label: "Vermilion" },
                { id: "indigo", color: "#34568b", label: "Indigo" },
                { id: "sumi", color: "#1c1a14", label: "Sumi" },
              ]}
              onChange={(v) => setSetting("accent", v)}
              ariaLabel="Accent"
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          kanji="解"
          title="Analysis"
          description="What seeds an empty session, and how copying behaves."
        >
          <SettingRow label="Default sentence" hint="Seeds the input when you open a fresh session.">
            <DefaultSentenceEditor
              key={settings.defaultSentence}
              initial={settings.defaultSentence}
              onCommit={(v) => setSetting("defaultSentence", v)}
            />
          </SettingRow>
          <SettingRow label="Copy format" hint="Single gloss, full card, all results.">
            <Segmented<CopyFormat>
              value={settings.copyFormat}
              options={["markdown", "plain"]}
              onChange={(v) => setSetting("copyFormat", v)}
              ariaLabel="Copy format"
            />
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          kanji="蔵"
          title="Data"
          description="All data lives on this device. No sync, no account."
        >
          <DataActionGrid>
            <DataAction
              label="Reset settings"
              description="Restore defaults"
              onClick={() => setConfirm("reset")}
            />
            <DataAction
              label="Export favorites"
              description={`${favorites.entries.length} terms — use the Favorites screen for file output`}
            />
            <DataAction
              label="Clear history"
              description={`Erases ${history.entries.length} entries`}
              tone="warn"
              onClick={() => setConfirm("clearHistory")}
              disabled={history.entries.length === 0}
            />
            <DataAction
              label="Clear all data"
              description="Reset to first-run state"
              tone="warn"
              onClick={() => setConfirm("clearAll")}
            />
          </DataActionGrid>

          {confirm && (
            <div className="confirm-row" style={{ marginTop: 12 }}>
              <span className="grow">
                {confirm === "clearHistory" && `Erase all ${history.entries.length} history entries? Cannot be undone.`}
                {confirm === "clearAll" && "Erase ALL local data (settings, history, favorites)? Cannot be undone."}
                {confirm === "reset" && "Reset settings to defaults?"}
              </span>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="warn"
                onClick={() => {
                  if (confirm === "clearHistory") {
                    const n = history.entries.length;
                    clearHistory();
                    showToast({
                      message: `Cleared ${n} history ${n === 1 ? "entry" : "entries"}`,
                      tone: "warn",
                    });
                  }
                  if (confirm === "clearAll") {
                    clearAllData();
                    reset();
                    showToast({ message: "All local data erased", tone: "warn" });
                  }
                  if (confirm === "reset") {
                    reset();
                    showToast({ message: "Settings reset to defaults", tone: "success" });
                  }
                  setConfirm(null);
                }}
              >
                Confirm
              </Button>
            </div>
          )}

          <StorageBar
            fraction={Math.min(1, usageBytes / STORAGE_BUDGET)}
            label={`${usageKb} KB / ~5 MB · localStorage`}
          />
        </SettingGroup>

        <section className="set-group set-about">
          <div className="set-about-card paper-tex">
            <Hanko size="lg">辞書</Hanko>
            <div className="set-about-text">
              <div className="serif" style={{ fontSize: 22, lineHeight: 1.2 }}>
                Jisho
              </div>
              <div className="mono ink-faint" style={{ fontSize: 11, marginTop: 4 }}>
                build 2026.05 · client-only · MIT
              </div>
              <div className="ink-soft" style={{ fontSize: 13, marginTop: 10, maxWidth: 340 }}>
                A quiet workspace for reading Japanese.
              </div>
            </div>
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}

function DefaultSentenceEditor({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const dirty = draft.trim() !== initial.trim();
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <TextField
        jp
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (dirty && draft.trim()) onCommit(draft.trim());
        }}
      />
      {dirty && (
        <Button
          variant="quiet"
          onClick={() => {
            if (draft.trim()) onCommit(draft.trim());
          }}
        >
          Save
        </Button>
      )}
    </div>
  );
}
