"use client";

import { useEffect, useMemo, useState } from "react";
import * as Icon from "../components/Icon";
import {
  Hanko,
  Button,
  Ruby,
  FuriganaSentence,
  Segmented,
  SwatchRow,
  SearchField,
  TextField,
  Tag,
  PosPill,
  Eyebrow,
  RuleGold,
  Ornament,
  Note,
  FloatingActions,
  BreakdownChip,
  BreakdownLegend,
  Example,
  ExampleList,
  ConjugationGrid,
  TermCard,
  HistoryRow,
  HistoryList,
  SideRail,
  BottomTabs,
  Sheet,
  SettingGroup,
  SettingRow,
  DataAction,
  DataActionGrid,
  StorageBar,
  type RailItem,
  type TabItem,
} from "../components";
import { cards, history, sentence, english, source, tokens, favoriteIds } from "../lib/demoData";
import { useSplashRemoval } from "../lib/splash";

type Theme = "light" | "dark";
type Accent = "seal" | "indigo" | "sumi";
type Furigana = "always" | "hover" | "off";
type JpScale = "S" | "M" | "L";

const railItems: RailItem<"read" | "history" | "favorites" | "settings">[] = [
  { id: "read", label: "Read", kanji: "読" },
  { id: "history", label: "History", kanji: "歴" },
  { id: "favorites", label: "Favorites", kanji: "印" },
  { id: "settings", label: "Settings", kanji: "設" },
];

const tabItems: TabItem<"read" | "history" | "favorites" | "settings">[] = [
  { id: "read", label: "Read", icon: Icon.Read },
  { id: "history", label: "History", icon: Icon.History },
  { id: "favorites", label: "Favorites", icon: Icon.Favorites },
  { id: "settings", label: "Settings", icon: Icon.Settings },
];

export default function ShowcasePage() {
  const [theme, setTheme] = useState<Theme>("light");
  const [accent, setAccent] = useState<Accent>("seal");
  const [furigana, setFurigana] = useState<Furigana>("always");
  const [jpScale, setJpScale] = useState<JpScale>("M");
  const [active, setActive] = useState<"read" | "history" | "favorites" | "settings">("read");
  const [favs, setFavs] = useState<Set<string>>(() => new Set(favoriteIds));
  const [activeChip, setActiveChip] = useState<string | null>("v-sensei");

  // The splash overlay (app/layout.tsx) paints on every route, but this
  // reference page never mounts EngineProvider to clear it — there's no engine
  // to load here, so dismiss it on mount.
  useSplashRemoval(true);

  // Sync data-attrs on <html> so token cascade reaches everything (including portals).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.accent = accent;
    root.dataset.furigana = furigana;
    root.dataset.jpScale = jpScale;
  }, [theme, accent, furigana, jpScale]);

  const toggleFav = (id: string) =>
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const vocabCards = useMemo(() => cards.filter((c) => c.type === "vocab"), []);
  const grammarCards = useMemo(() => cards.filter((c) => c.type === "grammar"), []);
  const sensei = cards.find((c) => c.id === "v-sensei")!;
  const yobu = cards.find((c) => c.id === "v-yobu")!;
  const toyobu = cards.find((c) => c.id === "g-toyobu")!;
  const teita = cards.find((c) => c.id === "g-teita")!;

  return (
    <div className="paper-tex" style={{ minHeight: "100vh", padding: "32px 24px 80px" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 40 }}>
        {/* ── Page header ───────────────────────────────────────────── */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Hanko size="lg" aria-label="Jisho" />
            <div>
              <div className="serif" style={{ fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.01em" }}>
                Jisho
              </div>
              <div className="mono ink-faint" style={{ fontSize: 11, marginTop: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Editorial Ink · Design System
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Segmented<Theme>
              value={theme}
              options={["light", "dark"]}
              onChange={setTheme}
              ariaLabel="Theme"
            />
            <Segmented<Furigana>
              value={furigana}
              options={["always", "hover", "off"]}
              onChange={setFurigana}
              ariaLabel="Furigana"
            />
            <Segmented<JpScale>
              value={jpScale}
              options={["S", "M", "L"]}
              onChange={setJpScale}
              ariaLabel="JP scale"
            />
            <SwatchRow<Accent>
              value={accent}
              options={[
                { id: "seal", color: "#b73a2a", label: "Vermilion" },
                { id: "indigo", color: "#34568b", label: "Indigo" },
                { id: "sumi", color: "#1c1a14", label: "Sumi" },
              ]}
              onChange={setAccent}
              ariaLabel="Accent"
            />
          </div>
        </header>

        <RuleGold />

        {/* ── Foundations: Type ─────────────────────────────────────── */}
        <Section title="Type" kanji="字" description="Four families: serif for display, DM Sans for UI, Mincho for Japanese, JetBrains Mono for codes.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <Specimen label="Display · EB Garamond">
              <div className="serif" style={{ fontSize: 36, lineHeight: 1.15, letterSpacing: "-0.01em" }}>
                The quiet workspace.
              </div>
            </Specimen>
            <Specimen label="UI · DM Sans">
              <div style={{ fontSize: 16, lineHeight: 1.5 }}>
                Settings flow through providers; theme tokens cascade from one CSS-variable root.
              </div>
            </Specimen>
            <Specimen label="Japanese · Noto Serif JP">
              <div className="jp" style={{ fontSize: 24, lineHeight: 1.7 }}>
                <FuriganaSentence jp={sentence} rt="わたしはそのひとをつねにせんせいとよんでいた。" />
              </div>
            </Specimen>
            <Specimen label="Mono · JetBrains Mono">
              <div className="mono" style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                settings → SettingsProvider → CSS vars → every component
              </div>
            </Specimen>
          </div>
        </Section>

        {/* ── Foundations: Color tokens ─────────────────────────────── */}
        <Section title="Color tokens" kanji="色" description="Tokens flow from data-theme + data-accent on the document root. No component computes its own colors.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {[
              ["--paper", "Paper"],
              ["--paper-card", "Card surface"],
              ["--paper-sink", "Sink"],
              ["--paper-edge", "Edge"],
              ["--ink", "Ink"],
              ["--ink-soft", "Ink soft"],
              ["--ink-faint", "Ink faint"],
              ["--ink-ghost", "Ink ghost"],
              ["--seal", "Seal (accent)"],
              ["--seal-ink", "Seal ink"],
              ["--indigo", "Indigo"],
              ["--moss", "Moss"],
            ].map(([token, label]) => (
              <Swatch key={token} token={token} label={label} />
            ))}
          </div>
        </Section>

        {/* ── Brand: Hanko ──────────────────────────────────────────── */}
        <Section title="Hanko" kanji="印" description="Vermilion seal logomark. Sizes mini → lg. Embossed via inset shadow layers.">
          <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
            <SizedHanko size="mini">印</SizedHanko>
            <SizedHanko size="sm">辞書</SizedHanko>
            <SizedHanko size="md">辞書</SizedHanko>
            <SizedHanko size="lg">辞書</SizedHanko>
          </div>
        </Section>

        {/* ── Buttons ──────────────────────────────────────────────── */}
        <Section title="Buttons" kanji="鈕" description="Five variants. All consume the accent token; warn variant uses seal-glow on hover.">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="primary">Primary</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="ghost" leftIcon={<Icon.Copy size={14} />}>
              Ghost · with icon
            </Button>
            <Button variant="warn">Warn</Button>
            <Button variant="icon" aria-label="Trash">
              <Icon.Trash size={14} />
            </Button>
            <Button variant="icon" aria-label="Share">
              <Icon.ShareArrow size={14} />
            </Button>
          </div>
        </Section>

        {/* ── Form controls ────────────────────────────────────────── */}
        <Section title="Form controls" kanji="入" description="Segmented, swatch row, search and text fields. Used across settings & headers.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <Specimen label="Segmented · inline">
              <Segmented<JpScale> value={jpScale} options={["S", "M", "L"]} onChange={setJpScale} />
            </Specimen>
            <Specimen label="Segmented · card variant">
              <Segmented<"vocab" | "grammar">
                value="vocab"
                variant="card"
                options={[
                  { value: "vocab", label: <>Vocabulary <span className="mono ink-faint"> · {vocabCards.length}</span></> },
                  { value: "grammar", label: <>Grammar <span className="mono ink-faint"> · {grammarCards.length}</span></> },
                ]}
              />
            </Specimen>
            <Specimen label="Swatch row">
              <SwatchRow<Accent>
                value={accent}
                options={[
                  { id: "seal", color: "var(--seal)", label: "Vermilion" },
                  { id: "indigo", color: "#34568b", label: "Indigo" },
                  { id: "sumi", color: "var(--ink)", label: "Sumi" },
                ]}
                onChange={setAccent}
              />
            </Specimen>
            <Specimen label="Search field">
              <SearchField placeholder="Filter…" />
            </Specimen>
            <Specimen label="Text field (jp)">
              <TextField jp defaultValue="私はその人を常に先生と呼んでいた。" />
            </Specimen>
            <Specimen label="Eyebrow + rule + ornament">
              <Eyebrow>Section</Eyebrow>
              <RuleGold />
              <Ornament>辞 ・ 書</Ornament>
            </Specimen>
          </div>
        </Section>

        {/* ── Tags & POS ───────────────────────────────────────────── */}
        <Section title="Tags & POS pills" kanji="札" description="Quiet badges for JLPT levels, POS, and modifiers.">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Tag>common</Tag>
            <Tag>literary</Tag>
            <Tag tone="jlpt">JLPT N5</Tag>
            <Tag tone="jlpt">N3</Tag>
            <Tag tone="vocab">vocab</Tag>
            <Tag tone="grammar">grammar</Tag>
            <PosPill>noun</PosPill>
            <PosPill>verb · godan-bu</PosPill>
            <PosPill>pattern</PosPill>
          </div>
        </Section>

        {/* ── Furigana ─────────────────────────────────────────────── */}
        <Section title="Furigana" kanji="仮" description="Ruby + sentence renderer. Mode is driven by data-furigana on the root.">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="jp" style={{ fontSize: 22 }}>
              <Ruby base="先生" rt="せんせい" /> ・{" "}
              <Ruby base="呼ぶ" rt="よぶ" /> ・{" "}
              <Ruby base="辞書" rt="じしょ" />
            </div>
            <div className="jp" style={{ fontSize: 18, lineHeight: 2 }}>
              <FuriganaSentence jp={sentence} rt="わたしはそのひとをつねにせんせいとよんでいた。" />
            </div>
            <div className="ink-faint mono" style={{ fontSize: 11 }}>
              Current mode: <span className="ink">{furigana}</span>
            </div>
          </div>
        </Section>

        {/* ── Breakdown ────────────────────────────────────────────── */}
        <Section title="Breakdown chips" kanji="解" description="One chip per token. Vocab edges indigo, grammar edges & tints seal, particles use a dashed border.">
          <div className="thin-scroll" style={{ display: "flex", alignItems: "flex-end", gap: 4, overflowX: "auto", paddingBottom: 8 }}>
            {tokens.map((t, i) => (
              <BreakdownChip
                key={i}
                token={t}
                active={!!t.cardId && activeChip === t.cardId}
                onClick={() => t.cardId && setActiveChip(t.cardId)}
              />
            ))}
          </div>
          <BreakdownLegend />
        </Section>

        {/* ── Floating actions ─────────────────────────────────────── */}
        <Section title="Floating actions" kanji="作" description="The action cluster pinned to the top-right of every term card.">
          <div style={{ position: "relative", padding: "18px 22px", background: "var(--paper-card)", border: "1px solid var(--line)", borderRadius: 3 }}>
            <FloatingActions favorite onFavorite={() => {}} />
            <span className="serif" style={{ fontSize: 18 }}>
              Pinned to the top-right of any card surface.
            </span>
          </div>
        </Section>

        {/* ── Term cards ───────────────────────────────────────────── */}
        <Section title="Term cards" kanji="札" description="The atomic content unit. Vocab cards (indigo edge) and grammar cards (seal edge + tint). Conjugation grid + examples appear when present.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <TermCard
              card={sensei}
              favorite={favs.has(sensei.id)}
              onToggleFavorite={() => toggleFav(sensei.id)}
            />
            <TermCard
              card={toyobu}
              favorite={favs.has(toyobu.id)}
              onToggleFavorite={() => toggleFav(toyobu.id)}
            />
            <TermCard
              card={yobu}
              favorite={favs.has(yobu.id)}
              onToggleFavorite={() => toggleFav(yobu.id)}
              highlight={activeChip === "v-yobu"}
            />
            <TermCard
              card={teita}
              favorite={favs.has(teita.id)}
              onToggleFavorite={() => toggleFav(teita.id)}
            />
          </div>
        </Section>

        {/* ── Sub-components ───────────────────────────────────────── */}
        <Section title="Examples & conjugation" kanji="例" description="Reusable sub-blocks of a card — also available standalone.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <Specimen label="ExampleList">
              <ExampleList
                examples={[
                  { jp: "先生、質問があります。", rt: "せんせい、しつもんがあります。", en: "Sensei, I have a question." },
                  { jp: "彼は数学の先生だ。", rt: "かれはすうがくのせんせいだ。", en: "He is a math teacher." },
                ]}
              />
            </Specimen>
            <Specimen label="ConjugationGrid">
              <ConjugationGrid
                conjugation={{
                  dict: "呼ぶ",
                  masu: "呼びます",
                  te: "呼んで",
                  past: "呼んだ",
                  neg: "呼ばない",
                }}
              />
            </Specimen>
            <Specimen label="Example (single)">
              <Example jp="雨が降っていた。" rt="あめがふっていた。" en="It was raining." />
            </Specimen>
            <Specimen label="Note (italic callout)">
              <Note>
                More formal/literary than 「いつも」. Common in written prose; pairs with stative or
                habitual readings of ていた.
              </Note>
            </Specimen>
          </div>
        </Section>

        {/* ── History list ─────────────────────────────────────────── */}
        <Section title="History list" kanji="歴" description="Dedup-by-hash, oldest-evicted. Active row highlights with a seal dot + ruled tint.">
          <HistoryList>
            {history.map((h, i) => (
              <HistoryRow key={h.id} entry={h} index={i} />
            ))}
          </HistoryList>
        </Section>

        {/* ── Navigation ───────────────────────────────────────────── */}
        <Section title="Navigation" kanji="行" description="Desktop side rail and mobile bottom tabs share the same item shape.">
          <div style={{ display: "grid", gridTemplateColumns: "232px 1fr", alignItems: "stretch", border: "1px solid var(--line)", borderRadius: 3, overflow: "hidden", minHeight: 320 }}>
            <SideRail<"read" | "history" | "favorites" | "settings">
              items={railItems}
              active={active}
              onChange={setActive}
            />
            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
              <Eyebrow>Active screen</Eyebrow>
              <div className="serif" style={{ fontSize: 28, letterSpacing: "-0.01em" }}>
                {active.charAt(0).toUpperCase() + active.slice(1)}
              </div>
              <div className="ink-faint" style={{ fontSize: 13, maxWidth: 380 }}>
                The side rail emits an id when clicked. Use it to drive your top-level router.
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16, maxWidth: 390, border: "1px solid var(--line)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ background: "var(--paper-card)", padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <span className="mono ink-faint" style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Mobile preview
              </span>
            </div>
            <BottomTabs<"read" | "history" | "favorites" | "settings">
              items={tabItems}
              active={active}
              onChange={setActive}
            />
          </div>
        </Section>

        {/* ── Settings groups ──────────────────────────────────────── */}
        <Section title="Setting groups" kanji="設" description="Card surface + kanji glyph + rows. Compose any settings screen with these.">
          <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
            <SettingGroup kanji="外" title="Appearance" description="Theme tokens flow from here to every component.">
              <SettingRow label="Theme" hint="Light or dark; tokens cascade from the root.">
                <Segmented<Theme> value={theme} options={["light", "dark"]} onChange={setTheme} />
              </SettingRow>
              <SettingRow label="Japanese font scale" hint="Affects Mincho rendering and ruby spacing.">
                <Segmented<JpScale> value={jpScale} options={["S", "M", "L"]} onChange={setJpScale} />
              </SettingRow>
              <SettingRow label="Furigana" hint="Visible always, on hover only, or hidden entirely.">
                <Segmented<Furigana> value={furigana} options={["always", "hover", "off"]} onChange={setFurigana} />
              </SettingRow>
              <SettingRow label="Accent">
                <SwatchRow<Accent>
                  value={accent}
                  options={[
                    { id: "seal", color: "var(--seal)", label: "Vermilion" },
                    { id: "indigo", color: "#34568b", label: "Indigo" },
                    { id: "sumi", color: "var(--ink)", label: "Sumi" },
                  ]}
                  onChange={setAccent}
                />
              </SettingRow>
            </SettingGroup>

            <SettingGroup kanji="解" title="Analysis" description="What seeds an empty session, and how copying behaves.">
              <SettingRow label="Default sentence" hint="Seeds the input when you open a fresh session.">
                <TextField jp defaultValue="私はその人を常に先生と呼んでいた。" />
              </SettingRow>
              <SettingRow label="Copy format" hint="Single gloss, full card, all results.">
                <Segmented<"markdown" | "plain"> value="markdown" options={["markdown", "plain"]} />
              </SettingRow>
            </SettingGroup>

            <SettingGroup kanji="蔵" title="Data" description="All data lives on this device. No sync, no account.">
              <DataActionGrid>
                <DataAction label="Export favorites" description={`Markdown bundle, ${favs.size} terms`} />
                <DataAction label="Import favorites" description="Merge a JSON bundle" />
                <DataAction label="Clear history" description={`Erases ${history.length} entries`} tone="warn" />
                <DataAction label="Clear all data" description="Reset to first-run state" tone="warn" />
              </DataActionGrid>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dotted var(--line)" }}>
                <StorageBar fraction={0.12} label="12.4 KB / ~5 MB · localStorage" />
              </div>
            </SettingGroup>
          </div>
        </Section>

        {/* ── Sheet ────────────────────────────────────────────────── */}
        <Section title="Bottom sheet" kanji="底" description="The modal surface used on mobile to focus a single card.">
          <div style={{ position: "relative", height: 440, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 3, overflow: "hidden" }}>
            <div className="paper-tex" style={{ position: "absolute", inset: 0, padding: 24 }}>
              <Eyebrow>Mobile · focus sheet</Eyebrow>
              <p className="ink-faint" style={{ fontSize: 13, marginTop: 12 }}>
                Tap a chip to surface its card in a peek sheet.
              </p>
            </div>
            <Sheet>
              <TermCard
                card={toyobu}
                favorite={favs.has(toyobu.id)}
                onToggleFavorite={() => toggleFav(toyobu.id)}
              />
            </Sheet>
          </div>
        </Section>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <footer style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24 }}>
          <div className="mono ink-faint" style={{ fontSize: 11 }}>
            {source} · {english}
          </div>
          <Hanko size="sm">辞</Hanko>
        </footer>
      </div>
    </div>
  );
}

// ── Local helpers (page-only) ────────────────────────────────────────

function Section({
  title,
  kanji,
  description,
  children,
}: {
  title: React.ReactNode;
  kanji?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        {kanji && (
          <span className="set-group-kanji jp" aria-hidden>
            {kanji}
          </span>
        )}
        <div>
          <h2 className="serif" style={{ fontSize: 22, lineHeight: 1.2, margin: 0, fontWeight: 500 }}>
            {title}
          </h2>
          {description && (
            <p className="ink-faint" style={{ fontSize: 12.5, margin: "4px 0 0", maxWidth: 720 }}>
              {description}
            </p>
          )}
        </div>
      </div>
      <div
        style={{
          padding: 22,
          background: "var(--paper-card)",
          border: "1px solid var(--line)",
          borderRadius: 3,
          boxShadow: "var(--sh-2)",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="mono ink-faint" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          height: 56,
          background: `var(${token})`,
          border: "1px solid var(--line)",
          borderRadius: 3,
          boxShadow: "var(--sh-1)",
        }}
      />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 12 }}>{label}</span>
        <span className="mono ink-faint" style={{ fontSize: 10 }}>{token}</span>
      </div>
    </div>
  );
}

function SizedHanko({ size, children }: { size: "mini" | "sm" | "md" | "lg"; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <Hanko size={size}>{children}</Hanko>
      <span className="mono ink-faint" style={{ fontSize: 10 }}>{size}</span>
    </div>
  );
}
