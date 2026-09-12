// EVAL-1 scaffolding: selects and formats the pool a human labels by hand.
//
// This script never fills in a jobPostingSchema field. Every label in the output is `null`
// — only provenance (id/url/etc.), `title`, and `description` are copied verbatim from the
// source, which is mechanical, not a labeling judgment. Filling in the rest is EVAL-1 itself
// and must not be automated; see docs/labeling-rubric.md and JOS-52 ("DO NOT DELEGATE").
//
// Usage: node scripts/build-eval-pool.ts [--size 150]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fetchBoard } from "../src/ingest/ats.ts";
import type { Ats, RawPosting } from "../src/schema/job-posting.ts";

const SIZE = Number(process.argv.includes("--size") ? process.argv[process.argv.indexOf("--size") + 1] : 150);
const CONCURRENCY = 6;
const TOKENS_FILE = "data/board-tokens.json";
const OUT_DIR = "data/eval";
const SEED = 42;

// Rare, so grabbed by name rather than left to random draw — see JOS-52's oversample list.
const OVERSAMPLE_TARGETS: Record<string, number> = { multiLocation: 8, multiLevel: 8, hourly: 6, upToX: 6 };

type Token = { company: string; token: string; ats: Ats; openJobs: number; teamSize: number | null; source: string };
type Candidate = {
  id: string;
  posting: RawPosting;
  company: string;
  sizeBucket: string;
  jurisdiction: string;
  oversample: string[];
  jobFunction: "engineering" | null;
};

function mulberry32(seed: number) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** No headcount API on hand for curated (non-YC) companies, so open-req count is the fallback
 *  proxy — noisy, but enough to separate "12-person startup" from "Amazon" per the rubric.
 *  Swap in a real employee-count source if this bucketing needs to be exact. */
function classifySize(t: Token): "small" | "mid" | "large" {
  if (t.teamSize != null) return t.teamSize < 20 ? "small" : t.teamSize < 200 ? "mid" : "large";
  return t.openJobs < 10 ? "small" : t.openJobs < 50 ? "mid" : "large";
}

/** Department + title keyword heuristic, not a labeling decision — department taxonomies vary
 *  across ATSs and are sometimes null, so title is checked too rather than trusted alone.
 *  Only "engineering" exists so far; null means "not yet classified into scope", matching
 *  JOB_FUNCTION in src/schema/job-posting.ts. */
const ENGINEERING_DEPARTMENT_RE = /engineering|software|infrastructure|platform|data\s*science|machine\s*learning|devops|security|\bqa\b|quality assurance/i;
const ENGINEERING_TITLE_RE =
  /engineer|developer|programmer|architect|\bsre\b|devops|machine learning|\bml\b|data scientist|infrastructure|platform|\bqa\b|quality assurance|full[- ]?stack|back[- ]?end|front[- ]?end/i;

function classifyJobFunction(department: string | null, title: string): "engineering" | null {
  if (department && ENGINEERING_DEPARTMENT_RE.test(department)) return "engineering";
  if (ENGINEERING_TITLE_RE.test(title)) return "engineering";
  return null;
}

/** Keyword match against the raw `location` string. Good enough to stratify; not a labeling
 *  decision — locationPolicy/locationGeo stay null in the output regardless. */
function classifyJurisdiction(location: string | null): string {
  const text = (location ?? "").toLowerCase();
  if (!text) return "unknown";
  if (/\bca\b|california|san francisco|los angeles|san jose|bay area/.test(text)) return "CA";
  if (/\bco\b|colorado|denver|boulder/.test(text)) return "CO";
  if (/\bny\b|new york/.test(text)) return "NY";
  if (/\bwa\b|seattle|\bwashington\b(?!,?\s*d\.?c\.?)/.test(text)) return "WA";
  if (/\btx\b|texas|austin|dallas|houston/.test(text)) return "TX";
  if (/remote/.test(text)) return "remote";
  return "other";
}

function oversampleReasons(p: RawPosting): string[] {
  const raw = p.raw as any;
  const reasons: string[] = [];
  const multiLocation =
    (Array.isArray(raw?.offices) && raw.offices.length > 1) ||
    (Array.isArray(raw?.secondaryLocations) && raw.secondaryLocations.length > 0);
  if (multiLocation) reasons.push("multiLocation");
  if (/\b(i|ii|iii|iv)\s*\/\s*(i|ii|iii|iv)\b|senior\s*\/\s*staff|junior\s*\/\s*mid|mid\s*\/\s*senior/i.test(p.title))
    reasons.push("multiLevel");
  if (/\bhourly\b|\/\s*hr\b|per hour/i.test(`${p.title} ${p.description}`)) reasons.push("hourly");
  if (/\bup to \$[\d,]+/i.test(p.description)) reasons.push("upToX");
  return reasons;
}

/** Content hash, scoped per company: catches near-identical reqs filed under different ids
 *  in the same poll, which would otherwise inflate the eval split with non-independent samples. */
function contentHash(p: RawPosting): string {
  return createHash("sha1").update(`${p.title}|${p.location ?? ""}|${p.description}`.toLowerCase().trim()).digest("hex");
}

function selectPool(candidates: Candidate[], size: number): Candidate[] {
  const rng = mulberry32(SEED);
  const pool = shuffle(candidates, rng);
  const selected = new Map<string, Candidate>();

  for (const [reason, target] of Object.entries(OVERSAMPLE_TARGETS)) {
    let count = 0;
    for (const c of pool) {
      if (count >= target || selected.size >= size) break;
      if (c.oversample.includes(reason) && !selected.has(c.id)) {
        selected.set(c.id, c);
        count++;
      }
    }
  }

  // Fill the rest proportional to each (ats, sizeBucket, jurisdiction) stratum's share of the
  // remaining population — largest-remainder rounding so small strata aren't starved to zero.
  const remaining = pool.filter((c) => !selected.has(c.id));
  const remainingSlots = size - selected.size;
  const byStratum = new Map<string, Candidate[]>();
  for (const c of remaining) {
    const key = `${c.posting.ats}|${c.sizeBucket}|${c.jurisdiction}`;
    const bucket = byStratum.get(key) ?? [];
    bucket.push(c);
    byStratum.set(key, bucket);
  }

  const strata = [...byStratum.values()];
  const quotas = strata.map((items) => (items.length / remaining.length) * remainingSlots);
  const floors = quotas.map(Math.floor);
  let leftover = remainingSlots - floors.reduce((a, b) => a + b, 0);
  const byFrac = quotas.map((q, i) => ({ i, frac: q - floors[i] })).sort((a, b) => b.frac - a.frac);
  for (const { i } of byFrac) {
    if (leftover <= 0) break;
    floors[i]++;
    leftover--;
  }

  strata.forEach((items, i) => {
    for (const c of items.slice(0, floors[i])) selected.set(c.id, c);
  });

  return shuffle([...selected.values()], rng);
}

async function pollBoards(tokens: Token[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const seenHash = new Set<string>();
  let cursor = 0;
  let polled = 0;

  async function worker() {
    while (cursor < tokens.length) {
      const t = tokens[cursor++];
      let postings: RawPosting[];
      try {
        postings = await fetchBoard(t.token, t.ats);
      } catch (e) {
        process.stdout.write(`\n  skip ${t.ats}:${t.token} — ${(e as Error).message}`);
        continue;
      }
      for (const p of postings) {
        const hash = `${p.ats}:${p.boardToken}:${contentHash(p)}`;
        if (seenHash.has(hash)) continue;
        seenHash.add(hash);
        candidates.push({
          id: `${p.ats}:${p.boardToken}:${p.externalId}`,
          posting: p,
          company: t.company,
          sizeBucket: classifySize(t),
          jurisdiction: classifyJurisdiction(p.location),
          oversample: oversampleReasons(p),
          jobFunction: classifyJobFunction(p.department, p.title),
        });
      }
      polled++;
      process.stdout.write(`\r  ${polled}/${tokens.length} boards polled, ${candidates.length} candidates`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");
  return candidates;
}

async function writePool(pool: Candidate[]) {
  await mkdir(OUT_DIR, { recursive: true });

  // Pretty-printed, blank-line-delimited (not strict one-line JSONL): a human fills these in
  // by hand, and one key per line beats hunting for "seniority" inside a single giant line.
  // `description` — by far the longest field — goes last so the labels to fill sit up top.
  const records = pool.map((c) => {
    const p = c.posting;
    return JSON.stringify(
      {
        id: c.id,
        company: c.company,
        ats: p.ats,
        boardToken: p.boardToken,
        externalId: p.externalId,
        url: p.url,
        strata: { sizeBucket: c.sizeBucket, jurisdiction: c.jurisdiction, oversample: c.oversample },
        // `title` is copied verbatim per the rubric. Every field below it is the label —
        // left null for the human to fill in. Do not pre-fill these.
        title: p.title,
        titleCanonical: null,
        // Pre-filled by a department/title heuristic (see classifyJobFunction), not a human
        // label — EVAL-1's first pass only labels the rest of the fields for "engineering"
        // records; everything else here stays null for non-engineering ones for now.
        jobFunction: c.jobFunction,
        seniority: null,
        locationPolicy: null,
        locationGeo: null,
        compMin: null,
        compMax: null,
        compCurrency: null,
        sponsorship: null,
        stack: null,
        employmentType: null,
        flags: [],
        description: p.description,
      },
      null,
      2,
    );
  });
  await writeFile(`${OUT_DIR}/pool.jsonl`, records.join("\n\n") + "\n");

  const countBy = (key: (c: Candidate) => string) =>
    Object.fromEntries([...new Set(pool.map(key))].sort().map((k) => [k, pool.filter((c) => key(c) === k).length]));

  const stratification = {
    total: pool.length,
    byAts: countBy((c) => c.posting.ats),
    bySizeBucket: countBy((c) => c.sizeBucket),
    byJurisdiction: countBy((c) => c.jurisdiction),
    byJobFunction: countBy((c) => c.jobFunction ?? "unclassified"),
    byOversampleReason: Object.fromEntries(
      Object.keys(OVERSAMPLE_TARGETS).map((r) => [r, pool.filter((c) => c.oversample.includes(r)).length]),
    ),
  };
  await writeFile(`${OUT_DIR}/pool-stratification.json`, JSON.stringify(stratification, null, 2));

  console.log(`\nWrote ${pool.length} records to ${OUT_DIR}/pool.jsonl`);
  console.log(JSON.stringify(stratification, null, 2));
}

async function main() {
  const { tokens } = JSON.parse(await readFile(TOKENS_FILE, "utf8")) as { tokens: Token[] };
  console.log(`Polling ${tokens.length} boards for eval pool candidates...`);
  const candidates = await pollBoards(tokens);
  console.log(`${candidates.length} unique candidates after per-company dedup.`);
  await writePool(selectPool(candidates, SIZE));
}

main();
