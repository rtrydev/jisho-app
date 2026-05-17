import { FuriganaSentence } from "./Ruby";

export type ExampleSentence = {
  jp: string;
  rt?: string;
  en?: string;
};

export function Example({ jp, rt, en }: ExampleSentence) {
  return (
    <div className="example">
      <div className="ex-jp">
        <FuriganaSentence jp={jp} rt={rt} />
      </div>
      {en && <div className="ex-en">{en}</div>}
    </div>
  );
}

export function ExampleList({
  examples,
  label = "Examples",
}: {
  examples: ExampleSentence[];
  label?: string;
}) {
  if (!examples.length) return null;
  return (
    <div className="card-examples">
      <div className="ex-label">{label}</div>
      {examples.map((ex, i) => (
        <Example key={i} {...ex} />
      ))}
    </div>
  );
}
