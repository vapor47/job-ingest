import { useEffect, useState } from "react";
import { searchStack, addStack } from "../api.ts";
import type { StackNode } from "../types.ts";

// Freetext-with-autocomplete over data/stack/canonical-stack.json, with an "add new" escape
// hatch — same multi-select pattern as LocationInput, replacing the old fixed STACK_VOCAB
// dropdown. Only ever stores a canonical `name`; matched aliases (e.g. "k8s") resolve search.
export function StackInput({ value, onChange }: { value: string[] | null; onChange: (value: string[] | null) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<StackNode[]>([]);
  const selected = value ?? [];

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      searchStack(q).then(setMatches);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function add(name: string) {
    if (!selected.includes(name)) onChange([...selected, name]);
    setQuery("");
    setMatches([]);
  }

  async function addAsNew() {
    const node = await addStack(query.trim());
    add(node.name);
  }

  const exactMatch = matches.some((m) => m.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="stack-input">
      {selected.map((name) => (
        <span
          key={name}
          className="tag"
          onClick={() => {
            const next = selected.filter((n) => n !== name);
            onChange(next.length === 0 ? null : next);
          }}
          title="Remove"
        >
          {name} ×
        </span>
      ))}
      <input value={query} placeholder="search stack…" onChange={(e) => setQuery(e.target.value)} />
      {query.trim() && (
        <ul className="location-matches">
          {matches.map((m) => (
            <li key={m.id} onClick={() => add(m.name)}>
              {m.name}
            </li>
          ))}
          {!exactMatch && (
            <li className="location-add-new" onClick={addAsNew}>
              + Add "{query.trim()}" as a new stack entry
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
