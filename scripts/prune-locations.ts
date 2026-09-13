// Trims low-value noise out of the geonames-sourced location graph — most of its 1000+ city
// entries will never appear on a real posting. A manual pass at this got a tech hub (Chennai,
// Pune) cut alongside real noise, and orphaned other cities by deleting their admin1 parent.
// This script exists to make that judgment mechanical and auditable instead of eyeballed:
//
//   - only "city"/"admin1" nodes are ever candidates — continent/country/remote/custom nodes
//     (hand-curated, not geonames bulk import) are never touched.
//   - a node already referenced by a labeled record's locationGeo is never pruned, regardless
//     of population — real usage always outranks the heuristic.
//   - population must be below --threshold (default 300,000).
//   - a node with any surviving child is never pruned, even if it would otherwise qualify —
//     evaluated bottom-up (deepest nodes first) so a parent only becomes prunable once all of
//     its own children have already been pruned or kept.
//
// Dry-run by default: prints what would be removed and why, touches nothing. Pass --apply to
// actually write data/geo/locations.json.
//
// Usage: node scripts/prune-locations.ts [--threshold 300000] [--apply]

import { readFile, writeFile } from "node:fs/promises";

const LOCATIONS_FILE = "data/geo/locations.json";
const POOL_FILE = "data/eval/pool.jsonl";
const THRESHOLD = Number(process.argv.includes("--threshold") ? process.argv[process.argv.indexOf("--threshold") + 1] : 300_000);
const APPLY = process.argv.includes("--apply");

type Node = { id: string; type: string; name: string; parentId: string | null; population: number | null };

function depth(node: Node, byId: Map<string, Node>): number {
  let d = 0;
  let cur: Node | undefined = node;
  while (cur?.parentId) {
    cur = byId.get(cur.parentId);
    d++;
  }
  return d;
}

async function main() {
  const nodes: Node[] = JSON.parse(await readFile(LOCATIONS_FILE, "utf8"));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const poolLines = (await readFile(POOL_FILE, "utf8")).trim().split("\n");
  const referencedNames = new Set<string>();
  for (const line of poolLines) {
    const r = JSON.parse(line);
    if (Array.isArray(r.locationGeo)) for (const name of r.locationGeo) referencedNames.add(name);
  }

  // Process deepest-first so a parent's prune decision can see whether its children already
  // survived or were pruned in this same pass.
  const order = [...nodes].sort((a, b) => depth(b, byId) - depth(a, byId));
  const pruned = new Set<string>();
  const kept: { id: string; name: string; reason: string }[] = [];

  for (const n of order) {
    if (n.type !== "city" && n.type !== "admin1") continue;

    const hasSurvivingChild = nodes.some((c) => c.parentId === n.id && !pruned.has(c.id));
    if (hasSurvivingChild) {
      kept.push({ id: n.id, name: n.name, reason: "has a surviving child" });
      continue;
    }
    if (referencedNames.has(n.name)) {
      kept.push({ id: n.id, name: n.name, reason: "referenced by a labeled record" });
      continue;
    }
    if (n.population == null || n.population >= THRESHOLD) {
      kept.push({ id: n.id, name: n.name, reason: n.population == null ? "no population data" : "above threshold" });
      continue;
    }
    pruned.add(n.id);
  }

  console.log(`${nodes.length} total nodes. ${pruned.size} candidates for removal (population < ${THRESHOLD}, no surviving children, unreferenced):`);
  for (const n of nodes) {
    if (pruned.has(n.id)) console.log(`  - ${n.id}  ${n.name}  (pop ${n.population})`);
  }

  if (!APPLY) {
    console.log(`\nDry run only — no file written. Re-run with --apply to write ${LOCATIONS_FILE}.`);
    return;
  }

  const survivors = nodes.filter((n) => !pruned.has(n.id));
  await writeFile(LOCATIONS_FILE, JSON.stringify(survivors, null, 2) + "\n");
  console.log(`\nWrote ${survivors.length} nodes to ${LOCATIONS_FILE} (removed ${pruned.size}).`);
}

main();
