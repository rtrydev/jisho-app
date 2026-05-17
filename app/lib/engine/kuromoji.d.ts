// Minimal declarations for the bundled `kuromoji` package — it ships no
// TypeScript types. We expose only the IPADIC token fields the engine reads.

declare module "kuromoji" {
  export type IpadicToken = {
    word_id: number;
    word_type: string;
    word_position: number;
    surface_form: string;
    pos: string;
    pos_detail_1: string;
    pos_detail_2: string;
    pos_detail_3: string;
    conjugated_type: string;
    conjugated_form: string;
    basic_form: string;
    reading?: string;
    pronunciation?: string;
  };

  export type Tokenizer = {
    tokenize(text: string): IpadicToken[];
  };

  export type TokenizerBuilder = {
    build(callback: (err: Error | null, tokenizer: Tokenizer) => void): void;
  };

  const kuromoji: {
    builder(opts: { dicPath: string }): TokenizerBuilder;
  };

  export default kuromoji;
  export function builder(opts: { dicPath: string }): TokenizerBuilder;
}
