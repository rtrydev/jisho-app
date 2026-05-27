# Jisho · 辞書

A quiet, offline-first workspace for reading Japanese — and for finding the
right word when all you have is the English. The input direction is detected
automatically: Japanese sentences are segmented morphologically against JMdict
and a Yomitan-style grammar bank; English queries are segmented by greedy
longest-match against a pre-built reverse gloss index over the same two
dictionaries. Either path renders an interactive breakdown plus detailed term
cards.

Everything runs in the browser. There is no backend, no account system, and no
server-side state — the dictionary, grammar bank, gloss index, and morphology
engine are all shipped as static assets and processed locally.

Live at [jisho.rtrydev.com](https://jisho.rtrydev.com).

## What's in the box

- **Read** — the home screen. Type or paste Japanese OR English; the input
  language is detected by script. Japanese inputs produce a morphological
  breakdown with a deduplicated set of vocab + grammar term cards. English
  inputs produce a dictionary-driven breakdown with *inverted* cards — the
  head is your English query and the body lists the top JP translation
  candidates (kana reading, POS, disambiguation gloss per row). Multi-word
  expressions like "give up", "in spite of", and "as soon as possible" stay as
  single chips because the matched gloss says they belong together. URL
  `?q=…` is kept in sync so the current query is shareable / refreshable.
- **History** — every successful analysis is recorded locally and replayable.
- **Favorites** — save individual vocab or grammar terms; they're stored as
  dictionary references, not snapshots, so they re-resolve against the live
  resources.
- **Settings** — theme (light / dark / system), accent (seal / indigo / sumi),
  furigana mode (always / hover / off), Japanese-glyph scale (S / M / L),
  default sentence, copy format (Markdown / plain), and data export / import /
  reset.
- **Sharing & copying** — `?q=…` deep links, per-card copy + share, and a
  whole-analysis "copy all" formatted per the Settings preference.
- **PWA** — installable, with a web app manifest, maskable icons, and a
  pre-hydration script that paints the correct theme on the very first frame
  (no white flash on cold load, no light flash for dark-mode users).

## Stack

- **Framework:** Next.js 16 with `output: "export"` — the whole app is a static
  bundle. Hydration happens once on the client; kuromoji + the compiled
  dictionary load lazily on first analysis.
- **UI:** React 19, Tailwind v4, a first-party design system ("Editorial Ink")
  in [app/components/](app/components/) driven entirely by CSS variables and
  `data-*` attributes on `<html>`. See [AGENTS.md](AGENTS.md) for the
  rules — design tokens, components, and theme contract.
- **Engines:** kuromoji + IPADIC for the JP morphology path; JMdict (English)
  for vocab; a Yomitan v3 grammar bank for grammar pattern matching; and a
  pre-built reverse English-gloss index (built in stage 5b of the pipeline,
  queried by [app/lib/engine/englishLookup.ts](app/lib/engine/englishLookup.ts))
  for the EN path. A codepoint-based language detector
  ([app/lib/lang.ts](app/lib/lang.ts)) routes the input. All wrapped behind a
  single `useAnalyzer` hook ([app/lib/analyzer.ts](app/lib/analyzer.ts)).
- **Persistence:** `localStorage` under the `jp:v2:*` namespace with versioned
  payloads and graceful in-memory fallback when quota / private mode bite.
- **Tests:** Vitest + Testing Library; specs live in [tests/](tests/) next to
  the screen / component they cover.
- **Hosting:** S3 + CloudFront, provisioned by Terraform, deployed by
  [scripts/deploy.sh](scripts/deploy.sh).

## Repository layout

| Path | What's there |
|---|---|
| [app/](app/) | Next.js App Router source — `JishoApp.tsx` composes the providers + screens. |
| [app/components/](app/components/) | The Editorial Ink design system — the only place to reach for UI primitives. |
| [app/screens/](app/screens/) | Read / History / Favorites / Settings. |
| [app/providers/](app/providers/) | `EngineProvider`, `SettingsProvider`, `UserDataProvider`. |
| [app/lib/](app/lib/) | Pure logic: analyzer, storage, settings, history/favorites, share-URL helpers. The engine internals sit under `app/lib/engine/`. |
| [app/showcase/](app/showcase/) | A standalone reference page that exercises every design-system component, color token, and typography family. |
| [tools/](tools/) | Python data pipeline — produces the static assets the app loads at runtime. See [tools/README.md](tools/README.md). |
| [data/](data/) | Operator-supplied source files for the pipeline (`JMdict_e.gz`, `sentence_pairs.tsv`, `grammar.zip`). Gitignored. See [data/README.md](data/README.md). |
| [public/data/](public/data/) | Generated `dictionary.json.gz`, `grammar.json.gz`, `grammar-manifest.json` — the runtime assets the engine fetches. Gitignored. |
| [public/dict/](public/dict/) | Kuromoji IPADIC files synced from `node_modules` by `postinstall`. Gitignored. |
| [terraform/](terraform/) | AWS hosting stack (S3 + CloudFront + ACM + Route 53). See [terraform/README.md](terraform/README.md). |
| [scripts/](scripts/) | `deploy.sh` (build + sync + invalidate) and `sync-kuromoji-dict.mjs` (postinstall). |
| [docs/](docs/) | Long-form specs — `app-spec.md` and `data-pipeline-spec.md`. |
| [tests/](tests/) | Vitest suites for screens and components. |

## Getting started

```bash
npm install        # also runs postinstall → copies kuromoji IPADIC + ONNX Runtime WASM into public/
npm run data:fetch # pulls the prebuilt dictionary artifacts from the live deployment
npm run dev        # http://localhost:3000
```

That's the fast path. After `npm install` lays down the binary dictionaries
under `public/dict/` and `public/onnx/`, `npm run data:fetch` downloads the
pre-built data artifacts (dictionary, gloss index, grammar bank, …) from
[`jisho.rtrydev.com`](https://jisho.rtrydev.com) into `public/data/`. The app
then has everything it needs to run.

Available scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server. |
| `npm run build` | Static export into `out/`. |
| `npm run start` | Serve a previously built export. |
| `npm run lint` | ESLint (Next.js config). |
| `npm test` | Run the Vitest suite once. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run data:fetch` | Download pre-built data artifacts from the live deployment into `public/data/`. Pass `--force` to refetch existing files. Override the source with `JISHO_DATA_BASE=…`. |

### Runtime data assets

The app expects these files under [`public/data/`](public/data/):

- `dictionary.json.gz` — JMdict words + linked example sentences (JP path).
- `grammar.json.gz` + `grammar-manifest.json` — merged Yomitan grammar bank
  (JP path).
- `gloss-index.json.gz` — reverse English-gloss index covering both vocab and
  grammar (EN path). Posting scores combine a canonicity bucket (sense × gloss
  position) with a quality score, so the canonical translation of a token
  outranks deep-sense coincidences.
- `kanji.json.gz` + `radkfile.json.gz` — per-kanji metadata + radical → kanji
  bitsets. Powers the kanji detail card and the radical-search picker. Optional
  — when missing, the kanji detail view and the **Radicals** tab in the kanji
  picker degrade gracefully.
- `kanji-classes.json` + `kanji-recognizer.onnx` — class index and the int8
  ONNX model for the **Draw** tab in the kanji picker (synthetic-trained
  ~5,500-class CJK recognizer, ~3 MB). Optional — without them the Draw tab
  shows a load error but the rest of the app works.

None of these are committed. There are two ways to provision them:

**Fetch from the live deployment** (fastest; equivalent to what's serving on
`jisho.rtrydev.com`):

```bash
npm run data:fetch
```

Missing optional artifacts (the kanji/radical/handwriting set) report 404
cleanly and the script continues. Build them locally afterwards if you need
those features.

**Build from upstream EDRDG sources** (reproducible; needed when source
snapshots change or to build the optional artifacts that aren't on production
yet):

```bash
python -m venv venv               # one time
source venv/bin/activate          # or .\venv\Scripts\Activate.ps1 on Windows
pip install -r tools/requirements.txt

# Sources. JMdict, KANJIDIC2, and the kradzip archive are downloadable from
# EDRDG; sentence_pairs.tsv (Tatoeba-aligned) and grammar.zip are operator-
# supplied — see data/README.md for filenames and license context.
python -m tools.data_pipeline.fetch

python -m tools.data_pipeline     # → dictionary, grammar, gloss-index, kanji, radkfile
```

The handwriting OCR model is a separate, longer training run; see
[`tools/handwriting_ocr/README.md`](tools/handwriting_ocr/README.md) for the
GPU recipe and the production training command.

## Deploying

The site is hosted at `jisho.rtrydev.com` on a private S3 bucket fronted by
CloudFront, with ACM + Route 53 wired up to the existing `rtrydev.com` zone.
The whole stack is described in [terraform/](terraform/).

```bash
./scripts/deploy.sh           # terraform apply + next build + s3 sync + CloudFront invalidation
./scripts/deploy.sh --yes     # skip the terraform confirmation prompt
```

The script verifies AWS credentials, exports them so Terraform sees the same
identity, applies the stack, builds the static export, syncs `out/` to S3 with
split cache headers (immutable for fingerprinted assets, short TTL for HTML /
JSON / manifest), and issues a CloudFront invalidation.

Requires AWS CLI v2 (for `aws configure export-credentials`) and Terraform
`>= 1.6`.

## Project conventions

- **Design system is mandatory.** Don't roll bespoke buttons / chips / inputs;
  use or extend the components in [app/components/](app/components/). The full
  set of rules is in [AGENTS.md](AGENTS.md).
- **Tokens, not hex codes.** Colors come from CSS variables (`var(--seal)`,
  `var(--paper-card)`, …) or their Tailwind v4 mappings (`bg-paper`,
  `text-ink-faint`, …). Hard-coded colors break the theme/accent cascade.
- **Theme contract.** Theme / accent / furigana / glyph scale are driven from
  `<html data-*>`. Only `SettingsProvider` writes them; components only read.
- **Engine is sealed.** Every consumer goes through `useAnalyzer`. Nothing
  outside `app/lib/engine/` should import from `app/lib/engine/`.
- **No Python on the system interpreter.** Pipeline work uses the `venv/` at
  the repo root.
