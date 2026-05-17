import type { TermCardData } from "../components/TermCard";
import type { BreakdownToken } from "../components/BreakdownChip";
import type { HistoryEntry } from "../components/HistoryRow";

/**
 * Pre-baked Sōseki / Kokoro opening — public domain.
 * Used by the design system showcase to demonstrate every component
 * against realistic content.
 */

export const sentence = "私はその人を常に先生と呼んでいた。";
export const english = "I had always called that person 'Sensei.'";
export const source = "夏目漱石『こゝろ』(1914)";

export const tokens: BreakdownToken[] = [
  { surface: "私", reading: "わたし", pos: "pronoun", cardId: "v-watashi" },
  { surface: "は", pos: "particle" },
  { surface: "その", pos: "adn." },
  { surface: "人", reading: "ひと", pos: "noun", cardId: "v-hito" },
  { surface: "を", pos: "particle" },
  { surface: "常に", reading: "つねに", pos: "adverb", cardId: "v-tsuneni" },
  { surface: "先生", reading: "せんせい", pos: "noun", cardId: "v-sensei" },
  { surface: "と", pos: "particle", cardId: "g-toyobu" },
  { surface: "呼んで", reading: "よんで", pos: "verb·te", cardId: "v-yobu" },
  { surface: "いた", pos: "aux·past", cardId: "g-teita" },
  { surface: "。", pos: "punct" },
];

export const cards: TermCardData[] = [
  {
    id: "v-watashi",
    type: "vocab",
    head: "私",
    reading: "わたし",
    surface: "私",
    pos: ["pronoun"],
    tags: ["common", "JLPT N5"],
    glosses: ["I; me", "(formal) one; oneself"],
    notes: "Neutral first-person pronoun, used by both men and women in formal writing.",
    examples: [
      { jp: "私は学生です。", rt: "わたしはがくせいです。", en: "I am a student." },
      { jp: "私の名前は山田です。", rt: "わたしのなまえはやまだです。", en: "My name is Yamada." },
    ],
  },
  {
    id: "v-hito",
    type: "vocab",
    head: "人",
    reading: "ひと",
    surface: "人",
    pos: ["noun"],
    tags: ["common", "JLPT N5"],
    glosses: ["person; human being", "(in context) someone; somebody", "character; nature"],
    examples: [
      { jp: "あの人は誰ですか。", rt: "あのひとはだれですか。", en: "Who is that person?" },
      { jp: "人は皆違う。", rt: "ひとはみなちがう。", en: "People are all different." },
    ],
  },
  {
    id: "v-tsuneni",
    type: "vocab",
    head: "常に",
    reading: "つねに",
    surface: "常に",
    pos: ["adverb"],
    tags: ["literary", "JLPT N3"],
    glosses: ["always; constantly", "habitually; perpetually"],
    notes: "More formal/literary than 「いつも」. Common in written prose.",
    examples: [
      { jp: "彼は常に冷静だ。", rt: "かれはつねにれいせいだ。", en: "He is always calm." },
      { jp: "常に最善を尽くす。", rt: "つねにさいぜんをつくす。", en: "(I) always do my best." },
    ],
  },
  {
    id: "v-sensei",
    type: "vocab",
    head: "先生",
    reading: "せんせい",
    surface: "先生",
    pos: ["noun", "honorific"],
    tags: ["common", "JLPT N5"],
    glosses: [
      "teacher; instructor; master",
      "doctor (medical, etc.)",
      "(as suffix) respectful title for a learned person",
    ],
    notes:
      "Used as a stand-alone term of address for teachers, doctors, novelists, lawmakers, and other esteemed practitioners.",
    examples: [
      { jp: "先生、質問があります。", rt: "せんせい、しつもんがあります。", en: "Sensei, I have a question." },
      { jp: "彼は数学の先生だ。", rt: "かれはすうがくのせんせいだ。", en: "He is a math teacher." },
    ],
  },
  {
    id: "v-yobu",
    type: "vocab",
    head: "呼ぶ",
    reading: "よぶ",
    surface: "呼んで",
    pos: ["verb", "godan-bu"],
    tags: ["common", "JLPT N5"],
    glosses: [
      "to call out (to); to invite",
      "to call (someone) by a name",
      "to summon; to send for",
    ],
    conjugation: {
      dict: "呼ぶ",
      masu: "呼びます",
      te: "呼んで",
      past: "呼んだ",
      neg: "呼ばない",
    },
    examples: [
      { jp: "母を呼んでください。", rt: "ははをよんでください。", en: "Please call my mother." },
      { jp: "彼を「兄さん」と呼ぶ。", rt: "かれを「にいさん」とよぶ。", en: "(I) call him 'Nii-san.'" },
    ],
  },
  {
    id: "g-toyobu",
    type: "grammar",
    head: "〜を…と呼ぶ",
    reading: "を…とよぶ",
    pos: ["pattern", "quotative"],
    tags: ["N4"],
    glosses: ["to call X by the name Y; to refer to X as Y"],
    formula: "[N₁] を [N₂] と 呼ぶ",
    explanation:
      "Quotative particle と marks the name or label being applied to the object (を marks). The construction names or designates one thing as another. Verbs other than 呼ぶ — 言う, 思う, 名付ける — slot in identically.",
    examples: [
      {
        jp: "私はその人を先生と呼んでいた。",
        rt: "わたしはそのひとをせんせいとよんでいた。",
        en: "I called that person 'Sensei.'",
      },
      { jp: "犬を「タロウ」と名付けた。", rt: "いぬを「タロウ」となづけた。", en: "(I) named the dog 'Taro.'" },
    ],
  },
  {
    id: "g-teita",
    type: "grammar",
    head: "〜ていた",
    reading: "ていた",
    pos: ["pattern", "aspect"],
    tags: ["N5", "aspect"],
    glosses: [
      "past continuous: was ~ing",
      "past habitual: used to ~",
      "perfect/resultative: had ~",
    ],
    formula: "[Verb-te] + いた",
    explanation:
      "Past form of 〜ている. The contextual reading is determined by verb class and adverbs: with activity verbs + 常に / いつも → habitual past; with stative or instantaneous verbs → resultative or perfect.",
    examples: [
      { jp: "雨が降っていた。", rt: "あめがふっていた。", en: "It was raining." },
      { jp: "彼を毎日待っていた。", rt: "かれをまいにちまっていた。", en: "I used to wait for him every day." },
    ],
  },
];

export const history: HistoryEntry[] = [
  { id: "h1", text: "私はその人を常に先生と呼んでいた。", termCount: 7, when: "just now", active: true },
  { id: "h2", text: "国境の長いトンネルを抜けると雪国であった。", termCount: 9, when: "12 minutes ago" },
  { id: "h3", text: "吾輩は猫である。名前はまだ無い。", termCount: 6, when: "yesterday" },
  { id: "h4", text: "親譲りの無鉄砲で子供の時から損ばかりしている。", termCount: 11, when: "2 days ago" },
  { id: "h5", text: "メロスは激怒した。必ず、かの邪智暴虐の王を除かなければならぬと決意した。", termCount: 14, when: "May 9" },
  { id: "h6", text: "雨ニモマケズ風ニモマケズ", termCount: 4, when: "May 7" },
  { id: "h7", text: "猫の額ほどの庭ですが、よく手入れされている。", termCount: 8, when: "May 2" },
];

export const favoriteIds = new Set<string>(["v-sensei", "v-tsuneni", "v-yobu", "g-toyobu", "g-teita"]);
