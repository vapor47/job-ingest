import { useEffect, useMemo, useRef, useState } from "react";
import { getPool, saveRecord } from "./api.ts";
import { Splitter } from "./components/Splitter.tsx";
import { PostingPane } from "./components/PostingPane.tsx";
import { LabelForm } from "./components/LabelForm.tsx";
import type { PoolRecord } from "./types.ts";

// Same "any label field non-null" heuristic scripts/validate-labels.ts uses for progress —
// keeps the two counts in agreement instead of drifting apart.
const LABEL_FIELDS: (keyof PoolRecord)[] = [
  "seniority", "locationPolicy", "locationGeo", "compMin", "compMax",
  "compCurrency", "stack", "employmentType",
];
const isLabeled = (r: PoolRecord) => LABEL_FIELDS.some((k) => r[k] !== null) || (r.flags?.length ?? 0) > 0;

const SKIP_FLAG = "non-eng";

export function App() {
  const [pool, setPool] = useState<PoolRecord[] | null>(null);
  const [index, setIndex] = useState(0);
  const [jump, setJump] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getPool().then(setPool);
  }, []);

  const labeledCount = useMemo(() => (pool ? pool.filter(isLabeled).length : 0), [pool]);

  if (!pool) return <div className="loading">Loading pool…</div>;
  const record = pool[index];

  // Debounced autosave: still "no save button, nothing is lost," just batched so a text
  // field doesn't rewrite the 150-record file on every keystroke.
  function update(patch: Partial<PoolRecord>) {
    const next = [...pool!];
    next[index] = { ...record, ...patch };
    setPool(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveRecord(index, next[index]), 400);
  }

  function goTo(i: number) {
    if (i >= 0 && i < pool!.length) setIndex(i);
  }

  // "Not engineering, leave every field null, come back to it later": autosave already
  // persists a plain null record, but that's indistinguishable from "not looked at yet".
  // Flagging it makes the skip explicit and keeps it out of the unlabeled count.
  function skipNonEng() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const flags = record.flags?.includes(SKIP_FLAG) ? record.flags : [...(record.flags ?? []), SKIP_FLAG];
    const flagged = { ...record, flags };
    const next = [...pool!];
    next[index] = flagged;
    setPool(next);
    saveRecord(index, flagged);
    goTo(index + 1);
  }

  function handleJump() {
    const n = Number(jump);
    if (Number.isInteger(n) && n >= 1 && n <= pool!.length) {
      goTo(n - 1);
    } else {
      const byId = pool!.findIndex((r) => r.id === jump.trim());
      if (byId >= 0) goTo(byId);
    }
    setJump("");
  }

  return (
    <div className="app">
      <div className="toolbar">
        <button onClick={() => goTo(index - 1)} disabled={index === 0}>
          ← Prev
        </button>
        <span>
          {index + 1} / {pool.length}
        </span>
        <button onClick={() => goTo(index + 1)} disabled={index === pool.length - 1}>
          Next →
        </button>
        <button onClick={skipNonEng}>Skip (non-eng) →</button>
        <input
          className="jump"
          placeholder="jump to # or id…"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleJump()}
        />
        <span className="progress">
          {labeledCount}/{pool.length} labeled {isLabeled(record) ? "✓" : ""}
        </span>
      </div>
      <Splitter
        left={<PostingPane url={record.url} title={record.title} />}
        right={<LabelForm record={record} onChange={update} />}
      />
    </div>
  );
}
