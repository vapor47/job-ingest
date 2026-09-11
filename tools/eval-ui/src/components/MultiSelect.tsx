// Multi-select over a fixed vocabulary (e.g. stack) via a native <select multiple> —
// ctrl/cmd-click to toggle entries, no options selected means null (not []).
export function MultiSelect({
  value,
  options,
  onChange,
}: {
  value: string[] | null;
  options: readonly string[];
  onChange: (value: string[] | null) => void;
}) {
  const selected = new Set(value ?? []);
  return (
    <select
      multiple
      size={Math.min(options.length, 6)}
      value={value ?? []}
      onChange={(e) => {
        const next = Array.from(e.target.selectedOptions, (o) => o.value);
        onChange(next.length === 0 ? null : next);
      }}
    >
      {options.map((opt) => (
        <option key={opt} value={opt} style={selected.has(opt) ? { fontWeight: 600 } : undefined}>
          {opt}
        </option>
      ))}
    </select>
  );
}
