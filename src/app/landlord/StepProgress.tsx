export function StepProgress({ step, label }: { step: 1 | 2 | 3 | 4; label: string }) {
  return (
    <div className="ll-progress-row">
      <span className="ll-progress-label">LANDLORD</span>
      <div className="ll-progress-bar">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className={`ll-progress-seg ${s <= step ? "done" : ""}`} />
        ))}
      </div>
      <span className="ll-progress-current">{label}</span>
    </div>
  );
}
