// Hand-built EngineResources for tests and showcase fixtures.
//
// The kuromoji + JMdict pipeline can't be invoked in jsdom: the IPADIC dat
// files are huge and the gzipped dictionary is megabytes. Instead we ship a
// small in-memory bundle that matches the shapes the engine consumes, plus a
// mock tokenizer that returns the canonical kuromoji+IPADIC tokenization of
// the demo sentence. Other inputs fall back to a single unknown token so the
// analyzer still produces a breakdown.
//
// `english` + `source` are returned by analyze() only for the demo sentence so
// the Read screen can show the curated translation in its banner.

import type {
  Dictionary,
  EngineResources,
  GrammarEntry,
  GrammarMap,
  RawToken,
  TokenizerLike,
  VocabEntry,
} from "./types";

export const DEMO_SENTENCE = "私はその人を常に先生と呼んでいた。";
export const DEMO_ENGLISH = "I had always called that person 'Sensei.'";
export const DEMO_SOURCE = "夏目漱石『こゝろ』(1914)";

const DEMO_TOKENS: RawToken[] = [
  { surface_form: "私", basic_form: "私", pos: "名詞", reading: "ワタシ" },
  { surface_form: "は", basic_form: "は", pos: "助詞", reading: "ハ" },
  { surface_form: "その", basic_form: "その", pos: "連体詞", reading: "ソノ" },
  { surface_form: "人", basic_form: "人", pos: "名詞", reading: "ヒト" },
  { surface_form: "を", basic_form: "を", pos: "助詞", reading: "ヲ" },
  { surface_form: "常に", basic_form: "常に", pos: "副詞", reading: "ツネニ" },
  { surface_form: "先生", basic_form: "先生", pos: "名詞", reading: "センセイ" },
  { surface_form: "と", basic_form: "と", pos: "助詞", reading: "ト" },
  { surface_form: "呼ん", basic_form: "呼ぶ", pos: "動詞", reading: "ヨン" },
  { surface_form: "で", basic_form: "で", pos: "助詞", reading: "デ" },
  { surface_form: "い", basic_form: "いる", pos: "動詞", reading: "イ" },
  { surface_form: "た", basic_form: "た", pos: "助動詞", reading: "タ" },
  { surface_form: "。", basic_form: "。", pos: "記号" },
];

function fallbackTokenize(text: string): RawToken[] {
  return Array.from(text).map((ch) => ({
    surface_form: ch,
    basic_form: ch,
    pos: /[　-ヿ＀-ﾟ]/.test(ch) ? "名詞" : "記号",
  }));
}

const demoTokenizer: TokenizerLike = {
  tokenize(text: string): RawToken[] {
    const trimmed = text.trim();
    if (trimmed === DEMO_SENTENCE) return DEMO_TOKENS;
    return fallbackTokenize(trimmed);
  },
};

// JMdict-shaped vocab entries for the demo sentence. Sense glosses follow the
// real JMdict English variant so copy/share output is realistic.
const vocab: Record<string, VocabEntry> = {
  私: {
    r: ["わたし"],
    s: [
      { pos: ["pn"], glosses: ["I", "me"] },
      { pos: ["n"], glosses: ["private affairs", "personal matter"] },
    ],
    e: [0],
    f: 48,
  },
  人: {
    r: ["ひと"],
    s: [
      { pos: ["n"], glosses: ["person", "human being"] },
      { pos: ["n"], glosses: ["someone", "somebody"] },
    ],
    e: [1],
    f: 40,
  },
  常に: {
    r: ["つねに"],
    s: [{ pos: ["adv"], glosses: ["always", "constantly"] }],
    e: [2],
    f: 10,
  },
  先生: {
    r: ["せんせい"],
    s: [
      { pos: ["n"], glosses: ["teacher", "instructor", "master"] },
      { pos: ["n"], glosses: ["doctor"] },
    ],
    e: [3],
    f: 30,
  },
  呼ぶ: {
    r: ["よぶ"],
    s: [
      { pos: ["v5b", "vt"], glosses: ["to call out (to)", "to call", "to invoke"] },
      { pos: ["v5b", "vt"], glosses: ["to invite"] },
    ],
    e: [4],
    f: 25,
  },
  いる: {
    r: ["いる"],
    s: [{ pos: ["v1", "vi"], glosses: ["to be (of animate objects)", "to exist"] }],
    e: [],
    f: 50,
  },
};

const sentences: Array<[string, string]> = [
  ["私は学生です。", "I am a student."],
  ["あの人は誰ですか。", "Who is that person?"],
  ["彼は常に冷静だ。", "He is always calm."],
  ["先生、質問があります。", "Sensei, I have a question."],
  ["母を呼んでください。", "Please call my mother."],
];

const dictionary: Dictionary = {
  meta: { version: "demo", words: Object.keys(vocab).length, sentences: sentences.length },
  words: vocab,
  readings: {},
  sentences,
};

// A grammar entry for the ていた pattern that the demo sentence terminates in.
// Modelled after the real Yomitan v3 8-tuple; only the fields the renderer
// reads are populated, but the rest are valid placeholders.
const teitaEntry: GrammarEntry = [
  "ていた",
  "",
  "ていた",
  "",
  0,
  [
    {
      type: "structured-content",
      content: [
        "【 Meaning 】",
        {
          tag: "div",
          content: "Past continuous; past habitual; perfect/resultative",
        },
        "【 Explanation 】",
        {
          tag: "div",
          content:
            "Past form of ている. The reading depends on verb class and adverbs — with activity verbs and 常に/いつも it reads as habitual past.",
        },
        "【 Example sentences 】",
        {
          tag: "ol",
          content: [
            {
              tag: "li",
              content: "雨が降っていた。\n It was raining.",
            },
            {
              tag: "li",
              content: "毎日待っていた。\n I used to wait every day.",
            },
          ],
        },
      ],
    },
  ],
  0,
  "N5",
];

const grammar: GrammarMap = new Map();
// Register both the canonical headword and the godan-bu te-form variant —
// 呼ん+で+い+た composes as "でいた", not "ていた". A real bank would key both.
grammar.set("ていた", teitaEntry);
grammar.set("でいた", teitaEntry);

export const demoResources: EngineResources = {
  dictionary,
  grammar,
  tokenizer: demoTokenizer,
  glossIndex: {
    vocab: { u: {}, p: {} },
    grammar: { u: {}, p: {} },
  },
};

/** True if `text` matches the curated demo sentence (after whitespace
 *  normalisation). The Read screen uses this to surface the curated English
 *  translation. */
export function isDemoSentence(text: string): boolean {
  return text.replace(/\s+/g, "").trim() === DEMO_SENTENCE.replace(/\s+/g, "");
}
