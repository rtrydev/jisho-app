export type Conjugation = Record<string, string>;

export function ConjugationGrid({
  conjugation,
  label = "Conjugation",
}: {
  conjugation: Conjugation;
  label?: string;
}) {
  const entries = Object.entries(conjugation);
  if (!entries.length) return null;
  return (
    <div className="card-conj">
      <div className="conj-label">{label}</div>
      <div className="conj-grid">
        {entries.map(([k, v]) => (
          <div key={k} className="conj-cell">
            <div className="conj-form">{k}</div>
            <div className="conj-val jp">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
