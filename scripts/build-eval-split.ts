// EVAL-2: freezes the dev/held-out split. Each labeled record's assignment depends only on
// its own id (salted hash, not a global shuffle), so growing the pool later — labeling a new
// batch — never moves an existing id between sets. That's the rule this script exists to
// enforce: "freeze it, never reshuffle old ones" (JOS-53).
//
// Re-run any time the pool grows; already-assigned ids keep their set, new ids just fall in.
//
// Usage: node scripts/build-eval-split.ts

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const POOL_FILE = "data/eval/pool.jsonl";
const OUT_DIR = "data/eval";
const SALT = "jos-53-eval-split-v1";
const DEV_SHARE = 0.6; // 90/60 target ratio

function assign(id: string): "dev" | "held-out" {
  const hash = createHash("sha1").update(`${SALT}:${id}`).digest("hex");
  const bucket = parseInt(hash.slice(0, 8), 16) / 0xffffffff;
  return bucket < DEV_SHARE ? "dev" : "held-out";
}

async function main() {
  const lines = (await readFile(POOL_FILE, "utf8")).trim().split("\n");
  const records = lines.map((l) => JSON.parse(l));
  const eligible = records.filter((r) => r.jobFunction === "engineering");

  const dev: string[] = [];
  const heldOut: string[] = [];
  for (const r of eligible) (assign(r.id) === "dev" ? dev : heldOut).push(r.id);

  await writeFile(`${OUT_DIR}/dev-split.json`, JSON.stringify(dev.sort(), null, 2) + "\n");
  await writeFile(`${OUT_DIR}/held-out-split.json`, JSON.stringify(heldOut.sort(), null, 2) + "\n");

  const countBy = (ids: string[], key: (r: any) => string) => {
    const byId = new Map(eligible.map((r) => [r.id, r]));
    const out: Record<string, number> = {};
    for (const id of ids) {
      const k = key(byId.get(id));
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };

  const stratification = {
    salt: SALT,
    devShare: DEV_SHARE,
    total: eligible.length,
    dev: { count: dev.length, byAts: countBy(dev, (r) => r.ats), byJurisdiction: countBy(dev, (r) => r.strata.jurisdiction) },
    heldOut: {
      count: heldOut.length,
      byAts: countBy(heldOut, (r) => r.ats),
      byJurisdiction: countBy(heldOut, (r) => r.strata.jurisdiction),
    },
  };
  await writeFile(`${OUT_DIR}/split-stratification.json`, JSON.stringify(stratification, null, 2) + "\n");

  console.log(`${eligible.length} eligible (engineering, labeled) records: ${dev.length} dev, ${heldOut.length} held-out`);
  console.log(JSON.stringify(stratification, null, 2));
}

main();
