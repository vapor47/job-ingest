// Multi-select over a small fixed enum (e.g. seniority — a posting can name more than one
// level, like "Senior/Staff"). Plain checkboxes: the option set is tiny and fixed, so no
// search or "add new" is needed, unlike the growable-library inputs.
export function EnumCheckboxes({
  value,
  options,
  onChange,
}: {
  value: string[] | null;
  options: readonly string[];
  onChange: (value: string[] | null) => void;
}) {
  function toggle(opt: string) {
    const current = value ?? [];
    const next = current.includes(opt) ? current.filter((v) => v !== opt) : [...current, opt];
    onChange(next.length === 0 ? null : next);
  }

  return (
    <div className="enum-checkboxes">
      {options.map((opt) => (
        <label key={opt} className="enum-checkbox">
          <input type="checkbox" checked={(value ?? []).includes(opt)} onChange={() => toggle(opt)} />
          {opt}
        </label>
      ))}
    </div>
  );
}
