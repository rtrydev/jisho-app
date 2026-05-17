export function StorageBar({
  fraction,
  label,
}: {
  fraction: number;
  label?: React.ReactNode;
}) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="storage-bar">
      <div className="sb-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="sb-fill" style={{ width: `${pct}%` }} />
      </div>
      {label && <div className="mono ink-faint">{label}</div>}
    </div>
  );
}
