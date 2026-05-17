import type { ReactNode } from "react";

export function Ruby({ base, rt }: { base: ReactNode; rt?: string | null }) {
  if (!rt) return <span>{base}</span>;
  return (
    <ruby>
      {base}
      <rt>{rt}</rt>
    </ruby>
  );
}

/**
 * Render a Japanese string with furigana when a reading is provided.
 * The reading is naively distributed across kanji-runs, with kana subtracted first.
 * Adequate for short headwords and example sentences in the demo set.
 */
export function FuriganaSentence({
  jp,
  rt,
  className,
}: {
  jp: string;
  rt?: string;
  className?: string;
}) {
  if (!rt || rt === jp) return <span className={`jp ${className ?? ""}`}>{jp}</span>;

  const isKanji = (c: string) => /[㐀-鿿]/.test(c);

  // Build runs of kanji-vs-non-kanji
  const runs: { text: string; kanji: boolean }[] = [];
  let cur = "";
  let kanji: boolean | null = null;
  for (const ch of jp) {
    const k = isKanji(ch);
    if (kanji === null) {
      cur = ch;
      kanji = k;
      continue;
    }
    if (k === kanji) {
      cur += ch;
    } else {
      runs.push({ text: cur, kanji });
      cur = ch;
      kanji = k;
    }
  }
  if (cur) runs.push({ text: cur, kanji: kanji ?? false });

  // Subtract kana from rt
  let kanaInJp = "";
  for (const r of runs) if (!r.kanji) kanaInJp += r.text;
  let rem = rt;
  for (const ch of kanaInJp) {
    const i = rem.indexOf(ch);
    if (i >= 0) rem = rem.slice(0, i) + rem.slice(i + 1);
  }

  const kanjiRuns = runs.filter((r) => r.kanji);
  const totalK = kanjiRuns.reduce((s, r) => s + r.text.length, 0);
  let pos = 0;
  const out: ReactNode[] = [];
  let kIdx = 0;
  for (const r of runs) {
    if (!r.kanji) {
      out.push(<span key={out.length}>{r.text}</span>);
    } else {
      const share =
        kIdx === kanjiRuns.length - 1
          ? rem.length - pos
          : Math.round(rem.length * (r.text.length / totalK));
      const reading = rem.slice(pos, pos + share);
      pos += share;
      kIdx++;
      out.push(<Ruby key={out.length} base={r.text} rt={reading} />);
    }
  }
  return <span className={`jp ${className ?? ""}`}>{out}</span>;
}

/**
 * Demo-grade hiragana → romaji.
 */
export function romanize(kana: string): string {
  const M: Record<string, string> = {
    あ: "a", い: "i", う: "u", え: "e", お: "o",
    か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
    が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
    さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
    ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
    た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
    だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
    な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
    は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
    ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
    ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
    ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
    や: "ya", ゆ: "yu", よ: "yo",
    ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
    わ: "wa", を: "wo", ん: "n",
    ゃ: "ya", ゅ: "yu", ょ: "yo", っ: "",
  };
  let out = "";
  for (let i = 0; i < kana.length; i++) {
    const ch = kana[i];
    const nx = kana[i + 1];
    if (nx && (nx === "ゃ" || nx === "ゅ" || nx === "ょ")) {
      const base = M[ch] || ch;
      out += base.slice(0, -1) + "y" + M[nx];
      i++;
    } else {
      out += M[ch] || ch;
    }
  }
  return out;
}
