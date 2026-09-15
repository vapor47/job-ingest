// EVAL-3: extraction pipeline v1. One structured Anthropic API call per posting — no planner,
// no critic, no retry chain. The dominant failure mode this guards against is an *invented*
// value: most postings outside pay-transparency states state no salary, and a model asked for
// compMin will produce a number anyway. The prompt makes null a first-class, expected answer
// per field, not a fallback — see docs/labeling-rubric.md, which this prompt condenses.
//
// Usage: node scripts/extract.ts [--split dev|held-out] [--out data/eval/predictions]
// Writes one JSONL line per posting to <out>/<runId>_<split>.jsonl, where runId encodes
// (schema version, model, prompt hash) so a prediction always traces back to exactly what
// produced it (EVAL-3 acceptance). Split is a separate filename component, not part of runId,
// so running the same run against both splits doesn't overwrite one with the other.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { jobPostingSchema, SCHEMA_VERSION } from "../src/schema/job-posting.ts";

const MODEL = "claude-opus-5";
const CONCURRENCY = 5;
const POOL_FILE = "data/eval/pool.jsonl";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const SPLIT = arg("split", "dev");
const OUT_DIR = arg("out", "data/eval/predictions");

// `title` is copied verbatim from the source, never extracted — see labeling-rubric.md.
const extractionSchema = jobPostingSchema.omit({ title: true });

const SYSTEM_PROMPT = `You extract structured fields from a job posting's title and description.

Global rules:
- Base every field only on the posting text. No outside knowledge, no inference from company reputation.
- null means "the posting does not say this." It is the single most common correct answer for most fields — never guess a value just to avoid a null.
- Never infer one field from another (a React role does not imply JavaScript; an office address does not imply onsite).

Field guide:
- titleCanonical: the role's canonical bucket (e.g. "Machine Learning Engineer"), level-agnostic. If the title is too vague to bucket, null.
- jobFunction: "engineering" if a software/infrastructure/data engineering role, else null. Only fill every other field below when this is "engineering" — leave every other field null when it isn't, even where the posting states values that would otherwise be labelable.
- seniority: array of levels named in the title, else an explicit level statement in the body, else null. Numeric ladders: I/Associate/Entry/Junior/New Grad -> junior, II/Mid -> mid, III/Senior/Sr./Lead -> senior, Staff/Senior Staff -> staff, Principal/Distinguished/Fellow -> principal, Intern/Co-op -> intern. A named range lists every level it spans in ladder order. An unbounded posting ("All Levels") lists every level. A bare, unqualified title defaults to ["mid"]. Management titles (Manager, Director, VP) are null.
- locationPolicy: array of remote/in_person/hybrid/onsite. "remote" if fully remote is allowed. "in_person" if in-office presence is required but cadence is unstated. "hybrid" only if a partial cadence is stated. "onsite" only if full-time presence is stated. A posting can list more than one (e.g. "Remote or onsite in SF" -> ["remote","onsite"]). A city name alone, or vague language like "remote-friendly" with no stated cadence, is null.
- locationGeo: every place the role may be based, normalized to "City, ST" (US) or "City, Country". For remote roles, the stated eligibility region ("United States", "EU"). null if no region or office is named.
- compMin, compMax, compCurrency: annual base salary cash only — no equity, bonus, signing, or benefits. A single stated number sets both min and max equal. Hourly x2080, monthly x12. Infer currency from location only when the posting gives a number but not a currency (US -> USD, Canada -> CAD); otherwise null. If no comp is stated, all three are null.
- stack: technologies named in the posting (including "nice to have"), not technologies implied by the role. null if none are named.
- employmentType: full_time/part_time/contract/internship from an explicit statement only, else null. Precedence when several apply: internship > contract > part_time > full_time.`;

// titleCanonical/locationGeo/stack are growable-library fields (data/titles, data/geo,
// data/stack) — the model free-generates text for them, so it can't reliably hit the exact
// canonical string a library node uses. Resolving against the library post-hoc (rather than
// asking the model to search it, which would break the one-call design above) lets the model
// say whatever it wants while the output still lines up with labeling-rubric.md's format.
export type LocationNode = {
  id: string; type: string; name: string; parentId: string | null;
  countryCode: string | null; admin1Code: string | null; population: number | null; aliases: string[];
};
export type LibNode = { id: string; name: string; aliases: string[] };
type Libraries = { locations: LocationNode[]; locationsById: Map<string, LocationNode>; titles: LibNode[]; stack: LibNode[] };

async function loadLibraries(): Promise<Libraries> {
  const locations: LocationNode[] = JSON.parse(await readFile("data/geo/locations.json", "utf8"));
  return {
    locations,
    locationsById: new Map(locations.map((n) => [n.id, n])),
    titles: JSON.parse(await readFile("data/titles/canonical-titles.json", "utf8")),
    stack: JSON.parse(await readFile("data/stack/canonical-stack.json", "utf8")),
  };
}

// Exact match only (name or alias, case-insensitive) — unlike api-plugin.ts's dropdown search,
// this pick is never reviewed by a human before landing in a prediction, so a loose substring
// match is a silent wrong answer rather than a suggestion (e.g. "EU" would substring-match
// "Ceuta"). A miss just falls through to the new-node candidate list, which is the safe failure.
function exactLocationMatches(nodes: LocationNode[], needle: string): LocationNode[] {
  return nodes.filter((n) => n.name.toLowerCase() === needle || n.aliases.some((a) => a.toLowerCase() === needle));
}

// country/admin1 outranks city so a bare "United States" or "California" resolves to the region
// itself rather than a same-named city.
const REGION_FIRST_RANK: Record<string, number> = { country: 0, admin1: 1, remote: 2, city: 3, custom: 4 };
// A "City, X" shape names a specific place, not a bare region — prefer the city reading among
// same-named nodes so "Washington, DC" resolves to the city, not the state of the same name.
const CITY_FIRST_RANK: Record<string, number> = { city: 0, custom: 1, remote: 2, admin1: 3, country: 4 };
function rankMatches(nodes: LocationNode[], rank: Record<string, number>): LocationNode[] {
  return [...nodes].sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9) || (b.population ?? 0) - (a.population ?? 0));
}

// "Mountain View, CA" won't exact-match any node name verbatim (nodes are bare place names) —
// retry on the part before the comma, which is exactly what the model uses to name the place
// itself.
export function resolveLocationNode(nodes: LocationNode[], value: string): LocationNode | null {
  const needle = value.trim().toLowerCase();
  const direct = rankMatches(exactLocationMatches(nodes, needle), REGION_FIRST_RANK)[0];
  if (direct) return direct;
  const primary = value.split(",")[0].trim().toLowerCase();
  if (!primary || primary === needle) return null;
  return rankMatches(exactLocationMatches(nodes, primary), CITY_FIRST_RANK)[0] ?? null;
}

// Normalizes a matched node back to labeling-rubric.md's "City, ST" / "City, Country"
// convention, independent of how the node happens to be named for the labeling UI (e.g.
// "Remote - United States" collapses to its parent's plain name, "United States").
export function formatLocation(node: LocationNode, byId: Map<string, LocationNode>): string {
  if (node.type === "remote") {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    return parent ? formatLocation(parent, byId) : node.name.replace(/^remote[\s-–—]+/i, "");
  }
  if (node.type === "country") return node.name;
  const country = node.countryCode ? byId.get(`country:${node.countryCode}`)?.name : undefined;
  if (node.type === "admin1") return node.countryCode === "US" ? node.name : country ? `${node.name}, ${country}` : node.name;
  // city / custom: node.admin1Code is the node's own state, not an ancestor's — e.g. "US.CA" on
  // the Mountain View node itself, not on some parent.
  if (node.countryCode === "US" && node.admin1Code) return `${node.name}, ${node.admin1Code.split(".")[1]}`;
  return country ? `${node.name}, ${country}` : node.name;
}

export function resolveSimpleNode(nodes: LibNode[], value: string): LibNode | null {
  const needle = value.trim().toLowerCase();
  return nodes.find((n) => n.name.toLowerCase() === needle || n.aliases.some((a) => a.toLowerCase() === needle)) ?? null;
}

export type Candidate = { id: string; field: string; value: string };

// Resolves each growable-library field to its canonical library form. A value with no library
// match is left as the model wrote it (still informative) and reported as a suggested new node
// instead of being silently dropped or forced to match something it isn't.
export function resolveLibraryFields(
  id: string,
  out: { titleCanonical: string | null; locationGeo: string[] | null; stack: string[] | null },
  libs: Libraries,
  candidates: Candidate[],
) {
  if (out.titleCanonical) {
    const match = resolveSimpleNode(libs.titles, out.titleCanonical);
    if (match) out.titleCanonical = match.name;
    else candidates.push({ id, field: "titleCanonical", value: out.titleCanonical });
  }
  if (out.locationGeo) {
    out.locationGeo = out.locationGeo.map((value) => {
      const match = resolveLocationNode(libs.locations, value);
      if (match) return formatLocation(match, libs.locationsById);
      candidates.push({ id, field: "locationGeo", value });
      return value;
    });
  }
  if (out.stack) {
    out.stack = out.stack.map((value) => {
      const match = resolveSimpleNode(libs.stack, value);
      if (match) return match.name;
      candidates.push({ id, field: "stack", value });
      return value;
    });
  }
}

type PoolRecord = { id: string; title: string; description: string };

async function loadRecords(ids: string[]): Promise<PoolRecord[]> {
  const lines = (await readFile(POOL_FILE, "utf8")).trim().split("\n");
  const byId = new Map(lines.map((l) => { const r = JSON.parse(l); return [r.id as string, r]; }));
  return ids.map((id) => {
    const r = byId.get(id);
    if (!r) throw new Error(`split references unknown pool id: ${id}`);
    return { id: r.id, title: r.title, description: r.description };
  });
}

async function extractOne(client: Anthropic, record: PoolRecord, libs: Libraries, candidates: Candidate[]) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Title: ${record.title}\n\nDescription:\n${record.description}` }],
    output_config: { format: zodOutputFormat(extractionSchema) },
  });
  if (!response.parsed_output) throw new Error("model output failed schema validation");
  const out = response.parsed_output;
  // Structured output doesn't reliably self-enforce the jobFunction -> other-fields dependency
  // (the model sometimes fills titleCanonical/seniority even after calling jobFunction null) —
  // so enforce the labeling-rubric gate here instead of trusting the prompt alone.
  if (out.jobFunction !== "engineering") {
    for (const key of Object.keys(out) as (keyof typeof out)[]) {
      if (key !== "jobFunction") (out as Record<string, unknown>)[key] = null;
    }
  }
  resolveLibraryFields(record.id, out, libs, candidates);
  return { id: record.id, title: record.title, ...out };
}

async function main() {
  const ids: string[] = JSON.parse(await readFile(`data/eval/${SPLIT}-split.json`, "utf8"));
  const records = await loadRecords(ids);

  const promptHash = createHash("sha1").update(SYSTEM_PROMPT).digest("hex").slice(0, 8);
  const runId = `${SCHEMA_VERSION}_${MODEL}_${promptHash}`;

  const libs = await loadLibraries();
  const client = new Anthropic();
  const results: ReturnType<typeof JSON.parse>[] = [];
  const candidates: Candidate[] = [];
  const errors: string[] = [];
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < records.length) {
      const record = records[cursor++];
      try {
        results.push(await extractOne(client, record, libs, candidates));
      } catch (e) {
        errors.push(`${record.id}: ${(e as Error).message}`);
      }
      done++;
      process.stdout.write(`\r  ${done}/${records.length} extracted (${errors.length} error(s))`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");

  await mkdir(OUT_DIR, { recursive: true });
  const outFile = `${OUT_DIR}/${runId}_${SPLIT}.jsonl`;
  const byId = new Map(results.map((r) => [r.id, r]));
  const ordered = ids.filter((id) => byId.has(id)).map((id) => JSON.stringify(byId.get(id)));
  await writeFile(outFile, ordered.join("\n") + "\n");

  console.log(`${results.length}/${records.length} succeeded -> ${outFile}`);
  if (candidates.length) {
    const candidatesFile = `${OUT_DIR}/${runId}_${SPLIT}_library-candidates.jsonl`;
    await writeFile(candidatesFile, candidates.map((c) => JSON.stringify(c)).join("\n") + "\n");
    console.log(`${candidates.length} unresolved library value(s) -> ${candidatesFile}`);
  }
  if (errors.length) {
    console.log(`${errors.length} error(s):`);
    for (const e of errors) console.log(`  ${e}`);
    process.exitCode = 1;
  }
}

// Guarded so extract.test.ts can import the resolver functions without running the whole
// pipeline (and its live API calls) as a side effect of import.
if (import.meta.url === `file://${process.argv[1]}`) main();
