import { useEffect, useState } from "react";
import { searchTitles, addTitle } from "../api.ts";
import type { TitleNode } from "../types.ts";

// Freetext-with-autocomplete over data/titles/canonical-titles.json (JOS-64), with an "add new"
// escape hatch — same pattern as LocationInput, but single-select: a title maps to exactly one
// canonical bucket, and the library starts empty and grows as labelers hit real titles.
export function TitleInput({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<TitleNode[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      searchTitles(q).then(setMatches);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function select(name: string) {
    onChange(name);
    setQuery("");
    setMatches([]);
  }

  async function selectAsNew() {
    const node = await addTitle(query.trim());
    select(node.name);
  }

  const exactMatch = matches.some((m) => m.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="title-input">
      {value && (
        <span className="tag" onClick={() => onChange(null)} title="Remove">
          {value} ×
        </span>
      )}
      {!value && (
        <>
          <input value={query} placeholder="search canonical title…" onChange={(e) => setQuery(e.target.value)} />
          {query.trim() && (
            <ul className="location-matches">
              {matches.map((m) => (
                <li key={m.id} onClick={() => select(m.name)}>
                  {m.name}
                </li>
              ))}
              {!exactMatch && (
                <li className="location-add-new" onClick={selectAsNew}>
                  + Add "{query.trim()}" as a new canonical title
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
