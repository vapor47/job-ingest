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
- jobFunction: "engineering" if a software/infrastructure/data engineering role, else null.
- seniority: array of levels named in the title, else an explicit level statement in the body, else null. Numeric ladders: I/Associate/Entry/Junior/New Grad -> junior, II/Mid -> mid, III/Senior/Sr./Lead -> senior, Staff/Senior Staff -> staff, Principal/Distinguished/Fellow -> principal, Intern/Co-op -> intern. A named range lists every level it spans in ladder order. An unbounded posting ("All Levels") lists every level. A bare, unqualified title defaults to ["mid"]. Management titles (Manager, Director, VP) are null.
- locationPolicy: array of remote/in_person/hybrid/onsite. "remote" if fully remote is allowed. "in_person" if in-office presence is required but cadence is unstated. "hybrid" only if a partial cadence is stated. "onsite" only if full-time presence is stated. A posting can list more than one (e.g. "Remote or onsite in SF" -> ["remote","onsite"]). A city name alone, or vague language like "remote-friendly" with no stated cadence, is null.
- locationGeo: every place the role may be based, normalized to "City, ST" (US) or "City, Country". For remote roles, the stated eligibility region ("United States", "EU"). null if no region or office is named.
- compMin, compMax, compCurrency: annual base salary cash only — no equity, bonus, signing, or benefits. A single stated number sets both min and max equal. Hourly x2080, monthly x12. Infer currency from location only when the posting gives a number but not a currency (US -> USD, Canada -> CAD); otherwise null. If no comp is stated, all three are null.
- stack: technologies named in the posting (including "nice to have"), not technologies implied by the role. null if none are named.
- employmentType: full_time/part_time/contract/internship from an explicit statement only, else null. Precedence when several apply: internship > contract > part_time > full_time.`;

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

async function extractOne(client: Anthropic, record: PoolRecord) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Title: ${record.title}\n\nDescription:\n${record.description}` }],
    output_config: { format: zodOutputFormat(extractionSchema) },
  });
  if (!response.parsed_output) throw new Error("model output failed schema validation");
  return { id: record.id, title: record.title, ...response.parsed_output };
}

async function main() {
  const ids: string[] = JSON.parse(await readFile(`data/eval/${SPLIT}-split.json`, "utf8"));
  const records = await loadRecords(ids);

  const promptHash = createHash("sha1").update(SYSTEM_PROMPT).digest("hex").slice(0, 8);
  const runId = `${SCHEMA_VERSION}_${MODEL}_${promptHash}`;

  const client = new Anthropic();
  const results: ReturnType<typeof JSON.parse>[] = [];
  const errors: string[] = [];
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < records.length) {
      const record = records[cursor++];
      try {
        results.push(await extractOne(client, record));
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
  if (errors.length) {
    console.log(`${errors.length} error(s):`);
    for (const e of errors) console.log(`  ${e}`);
    process.exitCode = 1;
  }
}

main();
