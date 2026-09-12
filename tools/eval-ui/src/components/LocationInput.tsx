import { useEffect, useState } from "react";
import { searchLocations, addLocation } from "../api.ts";
import type { LocationMatch } from "../types.ts";

// Freetext-with-autocomplete over data/geo/locations.json (JOS-63), with an "add new" escape
// hatch for places not yet in the taxonomy. Only ever stores a canonical `name` on the record —
// matched aliases (e.g. "NYC") resolve search, but the value written is always the real name.
export function LocationInput({ value, onChange }: { value: string[] | null; onChange: (value: string[] | null) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<LocationMatch[]>([]);
  const selected = value ?? [];

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      searchLocations(q).then(setMatches);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function add(name: string) {
    if (!selected.includes(name)) onChange([...selected, name]);
    setQuery("");
    setMatches([]);
  }

  async function addAsNew() {
    const node = await addLocation(query.trim());
    add(node.name);
  }

  const exactMatch = matches.some((m) => m.name.toLowerCase() === query.trim().toLowerCase());

  return (
    <div className="location-input">
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
      <input value={query} placeholder="search location…" onChange={(e) => setQuery(e.target.value)} />
      {query.trim() && (
        <ul className="location-matches">
          {matches.map((m) => (
            <li key={m.id} onClick={() => add(m.name)}>
              {m.name}
              {m.context && <span className="location-type">, {m.context}</span>}
            </li>
          ))}
          {!exactMatch && (
            <li className="location-add-new" onClick={addAsNew}>
              + Add "{query.trim()}" as a new location
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
