# Jisho — Product & Technical Specification

**Version:** 2.0 (Visual Overhaul + Workspace Features)
**Status:** Draft for implementation
**Scope:** Complete UI overhaul, new application shell, and four user-data features (Settings, History, Favorites, Sharing) plus result-copying. The parsing engine is explicitly out of scope for changes and must be preserved.

---

## 1. Overview

### 1.1 What the application is

JishoParser is a client-side Japanese reading-assistant. A user pastes Japanese text; the app segments it morphologically, matches multi-token grammar patterns against a grammar bank, looks up vocabulary against a dictionary, and presents an interactive breakdown plus detailed term cards with furigana, readings, glosses, and example sentences.

It runs entirely in the browser. There is no backend, no account system, and no server-side state. All data — the dictionary, the grammar banks, and the morphology engine — is fetched as static assets and processed locally.

### 1.2 What this version changes

Version 1 is a single screen. Version 2 turns it into a small workspace by adding persistent user data and navigation around the existing engine:

- A complete visual overhaul applied consistently through a design-token system.
- A responsive application shell with persistent navigation (bottom tabs on mobile, side rail on desktop).
- **Settings** — appearance, furigana behaviour, analysis defaults, data management.
- **History** — automatically recorded recent queries, replayable.
- **Favorites** — user-saved vocabulary and grammar terms, term-level.
- **Sharing** — encode a query into a shareable URL that auto-analyses on open.
- **Copying** — copy a single gloss, a full term card, or all results as a study note.

### 1.3 Non-goals for this version

No backend, accounts, or cloud sync. No changes to the parsing/lookup logic. No spaced-repetition review system (but the data model must not preclude it). No multi-document or file-import workflows.

### 1.4 Core principle

The parsing engine is the load-bearing, already-correct core. The overhaul separates this engine from a new application shell so that every new feature is an additive module consuming the engine's output, never a modification of it.

---

## 2. Architecture

### 2.1 Layered structure

The application is organised into four layers. Higher layers depend on lower ones; the engine depends on nothing above it.

1. **Engine layer** — morphological tokenisation, grammar-pattern matching, vocabulary lookup, deduplication/POS filtering. Pure logic, no UI, no storage. Preserved byte-for-byte from v1.
2. **Persistence layer** — a single module that owns all reads and writes to local browser storage, with namespaced keys and versioned schemas.
3. **State/provider layer** — React context providers exposing the engine, the active settings/theme, and the user-data stores to the UI.
4. **Shell/UI layer** — navigation, screens, and presentational components. Reads from providers; never touches storage or engine internals directly.

### 2.2 Engine boundary

The parsing pipeline is extracted out of the screen component into a single hook, `useAnalyzer`, which is the only sanctioned entry point to the engine.

**Inputs:** the resource bundle (dictionary, grammar map, tokenizer) loaded once at startup; an `analyze(text)` call.

**Outputs:**
- `tokens` — the ordered list of unified tokens for the breakdown row.
- `cardItems` — the deduplicated, POS-filtered list for the term cards.
- `status` — `loading | ready | error` plus the current loading step string.

**Rule:** the matching constants (6-token grammar window, ignored POS set, readings-to-kanji fallback order) are internal to the engine and not configurable from the UI in this version. If a future setting needs to influence them, it must be passed in as an explicit engine parameter, not by reaching into engine internals.

Consumers of `useAnalyzer`: the Read screen (live analysis), History (replay a stored query), Sharing (analyse a decoded deep link). All three use the same instance/output shape; none duplicate parsing logic.

### 2.3 Persistence layer

A single module wraps storage. No component or feature calls the storage API directly.

**Key namespacing:** `jp:v2:settings`, `jp:v2:history`, `jp:v2:favorites`. The `v2` segment is a schema-version marker, not the app version.

**Versioned schemas:** each store records its own schema version inside the payload. On read, if the stored version is older than the current one, a migration function upgrades it in place before the data is handed to the app. This is what allows the favorites model to gain fields later (e.g. review metadata) without breaking existing users.

**Failure behaviour:** storage access is wrapped so a quota error, disabled storage, or corrupt payload degrades gracefully — the feature falls back to in-memory-only for the session and surfaces a non-blocking notice; the analyzer itself never breaks because storage failed.

**Capacity policy:** History is capped (default 100 entries, oldest evicted). Favorites are uncapped but the export feature is the pressure valve. Settings are tiny and fixed-size.

### 2.4 Provider layer

Three providers wrap the app:

- **EngineProvider** — owns resource loading and exposes `useAnalyzer`.
- **SettingsProvider** — owns the active settings object and the derived theme tokens; persists on change; exposes `useSettings`.
- **UserDataProvider** — owns history and favorites collections; exposes query/mutation helpers; persists on change.

Theme tokens flow strictly one way: Settings → SettingsProvider → token CSS variables on a root element → every component. No component computes its own colors.

### 2.5 Data model

**Settings**
- `theme`: `light | dark | sepia | system`
- `furiganaMode`: `always | hover | off`
- `japaneseFontScale`: enumerated steps (e.g. S / M / L)
- `defaultSentence`: string used to seed an empty analyzer
- `copyFormat`: `markdown | plain`
- `schemaVersion`: integer

**History entry**
- `id`: stable hash of the normalised input text
- `text`: the full original input
- `preview`: first ~24 characters, for list display
- `termCount`: number of card items the query produced (derived at save time)
- `createdAt`, `lastViewedAt`: timestamps
- Re-analysing identical text updates `lastViewedAt` and reorders, rather than creating a duplicate (dedupe by `id`).

**Favorite entry**
- `id`: `type + ":" + dictKey`
- `type`: `vocab | grammar`
- `dictKey`: the key needed to re-resolve the full entry from the loaded dictionary/grammar bank
- `surface`: the surface form as originally encountered (display only)
- `addedAt`: timestamp
- Reserved space for future review metadata (not populated in v2). Favorites store the *key*, not a frozen copy, so cards re-render from the live dictionary and stay correct if assets are updated.

---

## 3. Visual design system

### 3.1 Direction

A single cohesive aesthetic — "Editorial Ink" — applied everywhere rather than per-screen restyling. The feel is paper-and-ink: a calm reading surface appropriate to a study tool, with one disciplined accent rather than competing colors.

### 3.2 Tokens

Every visual value is a named token, defined once per theme. Components reference tokens only.

- **Color:** paper (background), paper-card (raised surface), paper-sink (inset surface), ink (primary text), ink-soft (secondary), ink-faint (tertiary/labels), line (borders), seal (single vermilion accent, used for grammar + primary actions), indigo-soft (a muted secondary used only to keep vocabulary visually distinct from grammar).
- **Themes:** `light`, `dark`, `sepia` (a warm low-contrast reading theme), and `system` (follows OS preference, resolving to light or dark). All four are first-class; adding a theme is adding a token set, not editing components.
- **Typography:** a display serif for headings, a humanist sans for UI/Latin body text, and a Japanese serif (Mincho) for all Japanese text. Japanese and Latin are treated as separate type concerns with their own line-heights; furigana ruby spacing is part of the Japanese rhythm, not an afterthought.
- **Scale tokens:** spacing steps, corner radii, elevation/shadow levels, and motion durations are all tokenised so density and feel can be tuned globally.

### 3.3 Motion

Restrained and purposeful. The analysis "develops" rather than snapping in: a brief staggered reveal for breakdown chips and a fade-up for cards. Scroll-to-card uses a single seal-colored pulse, not a persistent highlight. Motion respects the OS reduced-motion preference.

### 3.4 Furigana presentation

Furigana behaviour is user-controlled via `furiganaMode`: always visible, visible on hover/focus only, or off entirely. The setting flows through the provider so every furigana-rendering surface (breakdown chips, vocab examples, grammar explanations) honours it identically.

---

## 4. Layout & navigation

### 4.1 Shell

A responsive shell hosts all screens:

- **Mobile:** a fixed bottom tab bar; the active screen scrolls above it.
- **Desktop/wide:** a persistent left side rail; content in a centered column.

The same four destinations in both: **Read**, **History**, **Favorites**, **Settings**. Read is the default.

### 4.2 Read screen

Retains the v1 flow — input → breakdown → terms — with these changes:

- The input becomes a sticky, collapsible element so the breakdown and cards gain vertical room as the user scrolls.
- The breakdown chip row is horizontally scrollable on narrow screens for long sentences, rather than wrapping into a tall block.
- Tapping a chip can open its term as a focused bottom sheet (mobile) in addition to scroll-to-card, so long sentences remain navigable. The sheet hosts the per-card action bar (favorite, copy, share-term).

### 4.3 History screen

Reverse-chronological list of stored queries. Each row shows the preview text, relative timestamp, and term count. Tapping reloads the query into Read and analyses it. Supports text filtering over stored inputs and per-row delete (swipe on mobile, control on desktop), plus a clear-all guarded by confirmation.

### 4.4 Favorites screen

Two segments — Vocabulary and Grammar. Each favorited term renders as the same card component used on the Read screen, re-resolved live from the dictionary by its stored key. Supports removal and is the primary surface for the export action.

### 4.5 Settings screen

Grouped sections: **Appearance** (theme, Japanese font scale, furigana mode), **Analysis** (default sentence, copy format), **Data** (export favorites, import favorites, clear history, clear all data — destructive actions confirmed). Changes apply immediately and persist.

---

## 5. Feature specifications

### 5.1 Settings

Settings is the simplest feature and validates the persistence + provider pipeline, so it ships first. All values live in the Settings store; the SettingsProvider is the single source of truth; changing a value updates the provider, persists, and re-derives theme tokens synchronously so the UI reflects it without reload. Reset-to-defaults is available and confirmed.

### 5.2 History

Every successful analysis records or updates a History entry, keyed by a normalised hash of the input so whitespace-only differences don't create duplicates. Re-analysing an existing query bumps it to the top via `lastViewedAt` rather than duplicating. The list is capped; eviction is oldest-first by `lastViewedAt`. Replay routes to Read with the stored text, which flows through the same `useAnalyzer` path as fresh input. History never stores analysis *results* — only the input and a small derived summary — so it stays correct if the dictionary changes and stays small.

### 5.3 Favorites

A favorite toggle (seal/star) appears on every vocab and grammar card, in all contexts (Read, History replay, the Favorites screen itself). Toggling writes to the Favorites store keyed by `type:dictKey`. The Favorites screen re-renders each saved term as a full card by resolving its key against the loaded dictionary/grammar bank — favorites are references, not snapshots. The data model reserves room for future review metadata so a study/quiz mode can be added later without a migration that breaks v2 users (the migration path is additive).

### 5.4 Sharing queries

A share action on the Read screen encodes the current input into a URL — the text compressed (reuse the existing pako dependency) and placed in the URL fragment so it never hits a server. On load, if such a fragment is present, the app decodes it, seeds the Read input, and auto-analyses. The UI offers "copy link" everywhere and additionally the native share sheet where available (mobile). Shared links are self-contained and require no account or backend.

### 5.5 Copying results

Copy affordances at three granularities, all respecting the `copyFormat` setting (Markdown or plain text):

- **Single gloss line** — copies one definition.
- **Full term card** — headword, readings, part of speech, all glosses, and one example with translation.
- **All results** — every card item from the current analysis as a single study-note block, suitable for pasting into notes or flashcard tools.

Copy actions confirm with a brief inline state change on the control itself rather than a disruptive global notification.

---

## 6. Cross-cutting requirements

**Preservation:** the engine layer (tokenisation, 6-token grammar window, readings→kanji fallback, dedup + ignored-POS filter, resource loading sequence) must remain behaviourally identical to v1. Changes to it are out of scope and not permitted under this spec.

**Offline/client-only:** no feature may introduce a network dependency beyond the existing static asset fetches. Sharing is URL-fragment based specifically to preserve this.

**Graceful degradation:** if storage is unavailable, History/Favorites/Settings fall back to session-only memory with a non-blocking notice; the analyzer remains fully functional.

**Accessibility:** keyboard navigation for all interactive elements, focus-visible states from tokens, reduced-motion honoured, sufficient contrast in every theme including sepia.

**Internationalisation of content vs UI:** Japanese content rendering (Mincho, furigana, ruby rhythm) is independent of UI chrome language; this spec does not localise UI strings but must not hard-code layout assumptions that would prevent it.

---

## 7. Implementation sequencing

Ordered to surface risk early and keep each step shippable:

1. **Foundations (invisible):** design-token + theme provider; extract the engine into `useAnalyzer`; stand up the persistence layer with versioned schemas. Nothing user-visible changes, but everything after is unblocked.
2. **Shell:** responsive navigation and screen container.
3. **Settings:** smallest feature; proves persistence + provider + theming end to end.
4. **History:** first feature that records user activity; exercises capacity/dedupe policy.
5. **Favorites:** term-level data tied to live dictionary resolution.
6. **Sharing & Copy:** additive, low-risk, polish-stage; finalize the overhaul visuals across all screens.

Each phase is independently releasable; the engine is never modified in any phase.

---

## 8. Acceptance criteria (summary)

- Pasting text produces a breakdown and term cards behaviourally identical to v1.
- All four themes render every screen correctly; switching is immediate and persisted.
- Furigana mode setting is honoured on every furigana surface.
- A query appears in History after analysis; replaying it reproduces the same result; duplicates are not created.
- Favoriting a term persists it; the Favorites screen re-renders it as a full card resolved from the live dictionary; it survives reload.
- A shared link opens, decodes, and auto-analyses with no network call beyond static assets.
- All three copy granularities produce output in the configured format.
- With browser storage disabled, the analyzer still works and the app reports the limitation without crashing.
