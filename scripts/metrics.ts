// EVAL-5: metrics harness. Scores one extraction run against the frozen ground truth for a
// split, per docs/labeling-rubric.md's null taxonomy: a null is only a defect when the truth
// states a value (missed) or when the truth is silent and the model states one anyway
// (invented) — correct nulls are a coverage ceiling, not a miss.
//
// Fields split into three families, each with its own notion of "match":
//   categorical (jobFunction, employmentType, titleCanonical, compCurrency) — exact equality
//   set (seniority, locationPolicy, stack, locationGeo)                    — set equality + P/R/F1
//   numeric (compMin, compMax)                                             — tolerance match
// The critical field set (seniority, locationPolicy, compMin, compMax) drives a composite
// "decision-usable rate": the share of records where every critical field matches, exact-match
// over that set rather than a full-record or micro-averaged score, split by whether the
// ground-truth record carries a labeler flag (flags are free-text, not per-field, so this is a
// record-level split, not a per-field flag attribution).
//
// Usage: node scripts/metrics.ts [--split dev|held-out] [--run <runId>]
// --run picks data/eval/predictions/<runId>_<split>.jsonl; omit it when exactly one prediction
// file exists for the split. Writes data/eval/results/<runId>_<split>.json and prints a diff
// against that file's previous contents, if any.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { jobPostingSchema } from "../src/schema/job-posting.ts";

const POOL_FILE = "data/eval/pool.jsonl";
const PRED_DIR = "data/eval/predictions";
const RESULTS_DIR = "data/eval/results";

const CATEGORICAL_FIELDS = ["jobFunction", "employmentType", "titleCanonical", "compCurrency"] as const;
const SET_FIELDS = ["seniority", "locationPolicy", "stack", "locationGeo"] as const;
const NUMERIC_FIELDS = ["compMin", "compMax"] as const;
const CRITICAL_FIELDS = ["seniority", "locationPolicy", "compMin", "compMax"] as const;

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const SPLIT = arg("split", "dev")!;

type Truth = Record<string, unknown> & { id: string; flags?: string[] };
type Pred = Record<string, unknown> & { id: string };

function wilson(successes: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const phat = successes / n;
  const denom = 1 + (z * z) / n;
  const center = phat + (z * z) / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
  return [Math.max(0, (center - margin) / denom), Math.min(1, (center + margin) / denom)];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ciStr = (ci: [number, number]) => `[${pct(ci[0])}, ${pct(ci[1])}]`;

function setEq(a: unknown, b: unknown): boolean {
  const as = new Set((a as string[] | null) ?? []);
  const bs = new Set((b as string[] | null) ?? []);
  if (as.size !== bs.size) return false;
  for (const v of as) if (!bs.has(v)) return false;
  return true;
}

function numMatch(a: unknown, b: unknown): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const [x, y] = [a as number, b as number];
  return Math.abs(x - y) <= Math.max(2500, 0.1 * Math.max(Math.abs(x), Math.abs(y)));
}

function fieldMatches(field: string, t: unknown, p: unknown): boolean {
  if ((SET_FIELDS as readonly string[]).includes(field)) return setEq(t, p);
  if ((NUMERIC_FIELDS as readonly string[]).includes(field)) return numMatch(t, p);
  return t === p;
}

async function findPredFile(runId: string | undefined): Promise<{ path: string; runId: string }> {
  if (runId) return { path: `${PRED_DIR}/${runId}_${SPLIT}.jsonl`, runId };
  const suffix = `_${SPLIT}.jsonl`;
  const files = (await readdir(PRED_DIR)).filter((f) => f.endsWith(suffix));
  if (files.length === 0) throw new Error(`no prediction files for split "${SPLIT}" in ${PRED_DIR}`);
  if (files.length > 1) throw new Error(`multiple prediction files for split "${SPLIT}", pass --run: ${files.join(", ")}`);
  return { path: `${PRED_DIR}/${files[0]}`, runId: files[0].slice(0, -suffix.length) };
}

function computeCategorical(field: string, truths: unknown[], preds: unknown[]) {
  const n = truths.length;
  const truthNonNull = truths.filter((t) => t !== null).length;
  const matches = truths.filter((t, i) => t === preds[i]).length;
  const missed = truths.filter((t, i) => t !== null && preds[i] === null).length;
  const invented = truths.filter((t, i) => t === null && preds[i] !== null).length;
  const confusion = new Map<string, number>();
  truths.forEach((t, i) => {
    const p = preds[i];
    if (t !== p) {
      const key = `${t ?? "null"} -> ${p ?? "null"}`;
      confusion.set(key, (confusion.get(key) ?? 0) + 1);
    }
  });
  const topConfusions = [...confusion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return {
    type: "categorical" as const,
    n,
    coverageCeiling: truthNonNull / n,
    accuracy: matches / n,
    ci: wilson(matches, n),
    missedRate: truthNonNull ? missed / truthNonNull : 0,
    inventedRate: n - truthNonNull ? invented / (n - truthNonNull) : 0,
    topConfusions,
  };
}

function computeSet(field: string, truths: unknown[], preds: unknown[]) {
  const n = truths.length;
  const truthNonNull = truths.filter((t) => t !== null).length;
  const exactMatches = truths.filter((t, i) => setEq(t, preds[i])).length;
  const missed = truths.filter((t, i) => t !== null && preds[i] === null).length;
  const invented = truths.filter((t, i) => t === null && preds[i] !== null).length;
  let tp = 0, fp = 0, fn = 0;
  truths.forEach((t, i) => {
    const ts = new Set((t as string[] | null) ?? []);
    const ps = new Set((preds[i] as string[] | null) ?? []);
    for (const v of ps) (ts.has(v) ? tp++ : fp++);
    for (const v of ts) if (!ps.has(v)) fn++;
  });
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    type: "set" as const,
    n,
    coverageCeiling: truthNonNull / n,
    exactMatchRate: exactMatches / n,
    ci: wilson(exactMatches, n),
    missedRate: truthNonNull ? missed / truthNonNull : 0,
    inventedRate: n - truthNonNull ? invented / (n - truthNonNull) : 0,
    precision,
    recall,
    f1,
  };
}

function computeNumeric(field: string, truths: unknown[], preds: unknown[]) {
  const n = truths.length;
  const truthNonNull = truths.filter((t) => t !== null).length;
  const matches = truths.filter((t, i) => numMatch(t, preds[i])).length;
  const missed = truths.filter((t, i) => t !== null && preds[i] === null).length;
  const invented = truths.filter((t, i) => t === null && preds[i] !== null).length;
  return {
    type: "numeric" as const,
    n,
    coverageCeiling: truthNonNull / n,
    toleranceMatchRate: matches / n,
    ci: wilson(matches, n),
    missedRate: truthNonNull ? missed / truthNonNull : 0,
    inventedRate: n - truthNonNull ? invented / (n - truthNonNull) : 0,
  };
}

async function main() {
  const { path: predFile, runId } = await findPredFile(arg("run"));

  const ids: string[] = JSON.parse(await readFile(`data/eval/${SPLIT}-split.json`, "utf8"));
  const poolLines = (await readFile(POOL_FILE, "utf8")).trim().split("\n");
  const truthById = new Map<string, Truth>(poolLines.map((l) => { const r = JSON.parse(l); return [r.id, r]; }));
  const predLines = (await readFile(predFile, "utf8")).trim().split("\n");
  const predById = new Map<string, Pred>(predLines.map((l) => { const r = JSON.parse(l); return [r.id, r]; }));

  const missingPred = ids.filter((id) => !predById.has(id));
  if (missingPred.length) throw new Error(`${missingPred.length} split id(s) missing from ${predFile}: ${missingPred.slice(0, 5).join(", ")}...`);

  const truths = ids.map((id) => truthById.get(id)!);
  for (const t of truths) {
    const r = jobPostingSchema.safeParse(t);
    if (!r.success) throw new Error(`ground truth ${t.id} fails schema: ${r.error.message}`);
  }
  const preds = ids.map((id) => predById.get(id)!);

  const fields: Record<string, ReturnType<typeof computeCategorical> | ReturnType<typeof computeSet> | ReturnType<typeof computeNumeric>> = {};
  for (const f of CATEGORICAL_FIELDS) fields[f] = computeCategorical(f, truths.map((t) => t[f] ?? null), preds.map((p) => p[f] ?? null));
  for (const f of SET_FIELDS) fields[f] = computeSet(f, truths.map((t) => t[f] ?? null), preds.map((p) => p[f] ?? null));
  for (const f of NUMERIC_FIELDS) fields[f] = computeNumeric(f, truths.map((t) => t[f] ?? null), preds.map((p) => p[f] ?? null));

  function decisionUsable(subset: number[]) {
    const n = subset.length;
    const usable = subset.filter((i) => CRITICAL_FIELDS.every((f) => fieldMatches(f, truths[i][f] ?? null, preds[i][f] ?? null))).length;
    return { n, rate: n ? usable / n : 0, ci: wilson(usable, n) };
  }
  const allIdx = ids.map((_, i) => i);
  const flaggedIdx = allIdx.filter((i) => (truths[i].flags?.length ?? 0) > 0);
  const unflaggedIdx = allIdx.filter((i) => (truths[i].flags?.length ?? 0) === 0);

  const result = {
    runId,
    split: SPLIT,
    n: ids.length,
    computedAt: new Date().toISOString(),
    fields,
    decisionUsable: {
      overall: decisionUsable(allIdx),
      flagged: decisionUsable(flaggedIdx),
      unflagged: decisionUsable(unflaggedIdx),
    },
  };

  console.log(`\n${runId} (${SPLIT}, n=${ids.length})\n`);
  console.log("field".padEnd(16), "n".padEnd(5), "coverage".padEnd(10), "match".padEnd(8), "95% CI".padEnd(18), "missed".padEnd(9), "invented".padEnd(9), "extra");
  for (const [name, m] of Object.entries(fields)) {
    const matchRate = "accuracy" in m ? m.accuracy : "exactMatchRate" in m ? m.exactMatchRate : m.toleranceMatchRate;
    const extra = m.type === "set" ? `P=${pct(m.precision)} R=${pct(m.recall)} F1=${pct(m.f1)}` : "";
    console.log(
      name.padEnd(16),
      String(m.n).padEnd(5),
      pct(m.coverageCeiling).padEnd(10),
      pct(matchRate).padEnd(8),
      ciStr(m.ci).padEnd(18),
      pct(m.missedRate).padEnd(9),
      pct(m.inventedRate).padEnd(9),
      extra,
    );
  }
  console.log(`\ndecision-usable rate (${CRITICAL_FIELDS.join(", ")}):`);
  console.log(`  overall:   ${pct(result.decisionUsable.overall.rate)} ${ciStr(result.decisionUsable.overall.ci)} (n=${result.decisionUsable.overall.n})`);
  console.log(`  unflagged: ${pct(result.decisionUsable.unflagged.rate)} ${ciStr(result.decisionUsable.unflagged.ci)} (n=${result.decisionUsable.unflagged.n})`);
  console.log(`  flagged:   ${pct(result.decisionUsable.flagged.rate)} ${ciStr(result.decisionUsable.flagged.ci)} (n=${result.decisionUsable.flagged.n})`);

  await mkdir(RESULTS_DIR, { recursive: true });
  const resultFile = `${RESULTS_DIR}/${runId}_${SPLIT}.json`;
  let prev: typeof result | undefined;
  try {
    prev = JSON.parse(await readFile(resultFile, "utf8"));
  } catch { /* no previous run at this path */ }
  await writeFile(resultFile, JSON.stringify(result, null, 2) + "\n");
  console.log(`\nwrote ${resultFile}`);

  if (prev) {
    const delta = result.decisionUsable.overall.rate - prev.decisionUsable.overall.rate;
    console.log(`decision-usable rate vs previous run at this path: ${delta >= 0 ? "+" : ""}${pct(delta)}`);
  }
}

main();
