// Additive companion to build-eval-pool.ts: pulls a new batch of candidates and appends them
// to the existing data/eval/pool.jsonl instead of rebuilding it from scratch, so it never
// touches already-labeled records. Like build-eval-pool.ts, every label field stays null —
// only provenance/title/description are copied verbatim. See JOS-52 ("DO NOT DELEGATE"):
// pulling raw postings is fine, filling in labels is not.
//
// Biases the batch 90% toward postings the department/title heuristic classifies as
// "engineering", 10% toward hard negatives: postings classified as non-engineering whose
// title still carries an engineering-adjacent word (Solutions Engineer, Data Analyst, TPM,
// Support Engineer...). The point isn't to teach a model confidence score — none exists yet
// in this pipeline — it's a cheap proxy for the same idea: the labeled set should include
// near-miss titles, not just the unambiguous ones, so a downstream classifier sees where the
// real boundary is instead of only the easy cases on both sides.
//
// Usage: node scripts/pull-eval-batch.ts [--size 50]

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fetchBoard } from "../src/ingest/ats.ts";
import type { Ats, RawPosting } from "../src/schema/job-posting.ts";

const SIZE = Number(process.argv.includes("--size") ? process.argv[process.argv.indexOf("--size") + 1] : 50);
const CONCURRENCY = 6;
const TOKENS_FILE = "data/board-tokens.json";
const POOL_FILE = "data/eval/pool.jsonl";
const STRATIFICATION_FILE = "data/eval/pool-stratification.json";
const SEED = 1337; // distinct from build-eval-pool.ts's SEED so this batch doesn't shuffle identically

type Token = { company: string; token: string; ats: Ats; openJobs: number; teamSize: number | null; source: string };
type Candidate = { id: string; posting: RawPosting; company: string; jobFunction: "engineering" | null; ambiguous: boolean };

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

// Same heuristic as build-eval-pool.ts's classifyJobFunction — kept in sync by hand since it's
// a handful of lines, not worth a shared module for.
const ENGINEERING_DEPARTMENT_RE = /engineering|software|infrastructure|platform|data\s*science|machine\s*learning|devops|security|\bqa\b|quality assurance/i;
const ENGINEERING_TITLE_RE =
  /engineer|developer|programmer|architect|\bsre\b|devops|machine learning|\bml\b|data scientist|infrastructure|platform|\bqa\b|quality assurance|full[- ]?stack|back[- ]?end|front[- ]?end/i;

function classifyJobFunction(department: string | null, title: string): "engineering" | null {
  if (department && ENGINEERING_DEPARTMENT_RE.test(department)) return "engineering";
  if (ENGINEERING_TITLE_RE.test(title)) return "engineering";
  return null;
}

// Hard-negative proxy: non-engineering by the heuristic above, but the title still carries a
// word that sits near the engineering/non-engineering boundary in practice.
const AMBIGUOUS_TITLE_RE =
  /solutions?\b|technical\b|support\b|\bdata\b|analyst|program manager|\btpm\b|automation|scientist|product\b|implementation|integration/i;

function contentHash(p: RawPosting): string {
  return createHash("sha1").update(`${p.title}|${p.location ?? ""}|${p.description}`.toLowerCase().trim()).digest("hex");
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
        const jobFunction = classifyJobFunction(p.department, p.title);
        candidates.push({
          id: `${p.ats}:${p.boardToken}:${p.externalId}`,
          posting: p,
          company: t.company,
          jobFunction,
          ambiguous: jobFunction === null && AMBIGUOUS_TITLE_RE.test(p.title),
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

function selectBatch(candidates: Candidate[], size: number): Candidate[] {
  const rng = mulberry32(SEED);
  const pool = shuffle(candidates, rng);
  const ambiguousTarget = Math.round(size * 0.1);
  const engineeringTarget = size - ambiguousTarget;

  const selected: Candidate[] = [];
  for (const c of pool) {
    if (selected.length >= engineeringTarget) break;
    if (c.jobFunction === "engineering") selected.push(c);
  }
  for (const c of pool) {
    if (selected.length >= size) break;
    if (c.ambiguous) selected.push(c);
  }
  // Fallback: not enough hard negatives found — top up with more engineering postings rather
  // than shipping a short batch.
  for (const c of pool) {
    if (selected.length >= size) break;
    if (c.jobFunction === "engineering" && !selected.includes(c)) selected.push(c);
  }
  return shuffle(selected, rng);
}

async function main() {
  const { tokens } = JSON.parse(await readFile(TOKENS_FILE, "utf8")) as { tokens: Token[] };
  const existingLines = (await readFile(POOL_FILE, "utf8")).trim().split("\n");
  const existingIds = new Set(existingLines.map((l) => JSON.parse(l).id as string));
  const existingHashes = new Set(
    existingLines.map((l) => {
      const r = JSON.parse(l);
      return createHash("sha1").update(`${r.title}|${r.description}`.toLowerCase().trim()).digest("hex");
    }),
  );

  console.log(`Polling ${tokens.length} boards for a new batch (existing pool: ${existingLines.length} records)...`);
  const allCandidates = await pollBoards(tokens);
  const fresh = allCandidates.filter(
    (c) => !existingIds.has(c.id) && !existingHashes.has(createHash("sha1").update(`${c.posting.title}|${c.posting.description}`.toLowerCase().trim()).digest("hex")),
  );
  console.log(`${allCandidates.length} candidates polled, ${fresh.length} not already in the pool.`);

  const batch = selectBatch(fresh, SIZE);
  const engCount = batch.filter((c) => c.jobFunction === "engineering").length;
  const ambCount = batch.filter((c) => c.ambiguous).length;
  console.log(`Selected ${batch.length}: ${engCount} engineering, ${ambCount} ambiguous non-engineering.`);

  const newRecords = batch.map((c) => {
    const p = c.posting;
    return JSON.stringify({
      id: c.id,
      company: c.company,
      ats: p.ats,
      boardToken: p.boardToken,
      externalId: p.externalId,
      url: p.url,
      strata: { sizeBucket: "n/a", jurisdiction: "n/a", oversample: c.ambiguous ? ["ambiguousNonEng"] : [] },
      title: p.title,
      titleCanonical: null,
      jobFunction: c.jobFunction,
      seniority: null,
      locationPolicy: null,
      locationGeo: null,
      compMin: null,
      compMax: null,
      compCurrency: null,
      stack: null,
      employmentType: null,
      flags: [],
      description: p.description,
    });
  });

  await writeFile(POOL_FILE, [...existingLines, ...newRecords].join("\n") + "\n");
  console.log(`Wrote ${existingLines.length + newRecords.length} total records to ${POOL_FILE} (${existingLines.length} existing + ${newRecords.length} new).`);

  try {
    const strat = JSON.parse(await readFile(STRATIFICATION_FILE, "utf8"));
    strat.total = existingLines.length + newRecords.length;
    strat.lastBatch = { size: newRecords.length, engineering: engCount, ambiguousNonEngineering: ambCount };
    await writeFile(STRATIFICATION_FILE, JSON.stringify(strat, null, 2));
  } catch {
    // No existing stratification file to update — fine, build-eval-pool.ts owns that file's shape.
  }
}

main();
