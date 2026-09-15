import { useEffect, useMemo, useRef, useState } from "react";
import { getPool, saveRecord } from "./api.ts";
import { Splitter } from "./components/Splitter.tsx";
import { PostingPane } from "./components/PostingPane.tsx";
import { LabelForm } from "./components/LabelForm.tsx";
import type { PoolRecord } from "./types.ts";
import { REVIEW_QUEUES, type QueueKey } from "./review-queue.ts";

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
  const [queue, setQueue] = useState<QueueKey>("all");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getPool().then(setPool);
  }, []);

  const labeledCount = useMemo(() => (pool ? pool.filter(isLabeled).length : 0), [pool]);

  // Indices into `pool` that belong to the selected queue, in pool order. "all" is every index.
  const visibleIndices = useMemo(() => {
    if (!pool) return [];
    if (queue === "all") return pool.map((_, i) => i);
    const ids = new Set(REVIEW_QUEUES[queue].ids);
    return pool.reduce<number[]>((acc, r, i) => (ids.has(r.id) ? [...acc, i] : acc), []);
  }, [pool, queue]);

  // Switching queues (or the pool loading in) can leave `index` pointing outside the new
  // filter — snap to the first record in the queue instead of showing a record it excludes.
  useEffect(() => {
    if (visibleIndices.length && !visibleIndices.includes(index)) setIndex(visibleIndices[0]);
  }, [queue, visibleIndices]);

  if (!pool) return <div className="loading">Loading pool…</div>;
  const record = pool[index];
  const position = visibleIndices.indexOf(index);

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

  // Step within the filtered queue (by position, not raw pool index) so Prev/Next skip
  // records the current queue excludes.
  function step(delta: number) {
    const next = position + delta;
    if (next >= 0 && next < visibleIndices.length) setIndex(visibleIndices[next]);
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
    step(1);
  }

  function handleJump() {
    const n = Number(jump);
    if (Number.isInteger(n) && n >= 1 && n <= pool!.length) {
      setQueue("all");
      goTo(n - 1);
    } else {
      const byId = pool!.findIndex((r) => r.id === jump.trim());
      if (byId >= 0) {
        setQueue("all");
        goTo(byId);
      }
    }
    setJump("");
  }

  return (
    <div className="app">
      <div className="toolbar">
        <select value={queue} onChange={(e) => setQueue(e.target.value as QueueKey)}>
          <option value="all">All records ({pool.length})</option>
          {(Object.keys(REVIEW_QUEUES) as (keyof typeof REVIEW_QUEUES)[]).map((key) => (
            <option key={key} value={key}>
              {REVIEW_QUEUES[key].label} ({REVIEW_QUEUES[key].ids.length})
            </option>
          ))}
        </select>
        <button onClick={() => step(-1)} disabled={position <= 0}>
          ← Prev
        </button>
        <span>
          {position + 1} / {visibleIndices.length}
        </span>
        <button onClick={() => step(1)} disabled={position === -1 || position === visibleIndices.length - 1}>
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
