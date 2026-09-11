import { useState } from "react";

// Free-text tags (flags): type + Enter to add, click a tag to remove it.
export function TagInput({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function commit() {
    const tag = draft.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  }

  return (
    <div className="tag-input">
      {value.map((tag) => (
        <span key={tag} className="tag" onClick={() => onChange(value.filter((t) => t !== tag))} title="Remove">
          {tag} ×
        </span>
      ))}
      <input
        value={draft}
        placeholder="add flag…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
