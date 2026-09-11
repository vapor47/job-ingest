// Single-select dropdown over a fixed enum, with "Not stated" standing in for null on every
// field — a plain native <select> covers the "at most one value" case with no extra library.
export function NullableSelect({
  value,
  options,
  onChange,
  labels,
}: {
  value: string | null;
  options: readonly string[];
  onChange: (value: string | null) => void;
  labels?: Record<string, string>;
}) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
      <option value="">— Not stated —</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {labels?.[opt] ?? opt}
        </option>
      ))}
    </select>
  );
}
