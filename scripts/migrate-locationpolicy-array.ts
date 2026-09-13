// One-off migration for the locationPolicy array + in_person change and the sponsorship
// field removal. Run once against a live pool.jsonl that has records labeled under the old
// schema (single-string locationPolicy, a sponsorship key). Safe to re-run: already-migrated
// records (array locationPolicy, no sponsorship key) pass through unchanged.
//
// Usage: node scripts/migrate-locationpolicy-array.ts [path/to/pool.jsonl]

import { readFile, writeFile } from "node:fs/promises";

const FILE = process.argv[2] ?? "data/eval/pool.jsonl";

// The four records flagged during labeling as hybrid/onsite-ambiguous or multi-policy — see
// docs/labeling-rubric.md's locationPolicy rule. Resolved by hand, not by this script's
// generic string->array wrap, since the right answer isn't just "wrap the old value".
const RESOLVED: Record<string, string[]> = {
  "ashby:snowflake:97813cac-e55c-4631-94fe-5eda15c7eaed": ["in_person"],
  "greenhouse:databricks:8220814002": ["in_person"],
  "greenhouse:databricks:8635188002": ["in_person"],
  "greenhouse:pinterest:7683981": ["remote", "onsite"],
};

async function main() {
  const lines = (await readFile(FILE, "utf8")).trim().split("\n");
  let touched = 0;

  const migrated = lines.map((line) => {
    const record = JSON.parse(line);
    let changed = false;

    if (RESOLVED[record.id]) {
      record.locationPolicy = RESOLVED[record.id];
      changed = true;
    } else if (typeof record.locationPolicy === "string") {
      record.locationPolicy = [record.locationPolicy];
      changed = true;
    }

    if ("sponsorship" in record) {
      delete record.sponsorship;
      changed = true;
    }

    if (changed) touched++;
    return JSON.stringify(record);
  });

  await writeFile(FILE, migrated.join("\n") + "\n");
  console.log(`${lines.length} records read, ${touched} migrated, wrote ${FILE}`);
}

main();
