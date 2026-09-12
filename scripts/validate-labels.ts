// EVAL-1 scaffolding: checks a labeling pool against SCHEMA-1 while labeling, so a typo'd
// enum or a comp field that doesn't move with its siblings surfaces now, not at EVAL-5.
// Every judgment call is still the human's — this only catches malformed records.
//
// Usage: node scripts/validate-labels.ts [path/to/pool.jsonl]

import { readFile } from "node:fs/promises";
import { jobPostingSchema } from "../src/schema/job-posting.ts";

const FILE = process.argv[2] ?? "data/eval/pool.jsonl";

async function main() {
  const blocks = (await readFile(FILE, "utf8")).trim().split("\n");
  let valid = 0;
  let labeled = 0;
  let flagged = 0;
  const errors: string[] = [];

  for (const [i, block] of blocks.entries()) {
    const record = JSON.parse(block);
    const result = jobPostingSchema.safeParse(record);
    if (!result.success) {
      errors.push(`record ${i + 1} (${record.id ?? "?"}): ${result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`);
      continue;
    }
    valid++;
    // Rough progress signal only — an all-null record can still be a fully correct label.
    if (Object.entries(result.data).some(([k, v]) => k !== "title" && v !== null)) labeled++;
    if (Array.isArray(record.flags) && record.flags.length > 0) flagged++;
  }

  console.log(`${blocks.length} records: ${valid} schema-valid, ${labeled} with a non-null field, ${flagged} flagged`);
  if (errors.length) {
    console.log(`\n${errors.length} schema error(s):`);
    for (const e of errors) console.log(`  ${e}`);
    process.exitCode = 1;
  }
}

main();
