// JOS-52 eval UI backend: a Vite dev-server plugin, not a standalone server, since Vite is
// already a devDependency once added for the React frontend — no need for Express too.
//
// Endpoints:
//   GET  /api/pool                 -> full pool (array of records, in file order)
//   PUT  /api/pool/:index          -> replace one record, rewrite pool.jsonl (autosave)
//   GET  /api/locations?q=<text>   -> up to 20 name/alias matches (never ships all ~38k nodes)
//   POST /api/locations            -> append a new node { name }, return it

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const POOL_PATH = path.join(REPO_ROOT, "data/eval/pool.jsonl");
const LOCATIONS_PATH = path.join(REPO_ROOT, "data/geo/locations.json");

// Same key order as scripts/build-eval-pool.ts's writePool, so re-saved records look
// identical to freshly-generated ones under a diff.
const FIELD_ORDER = [
  "id", "company", "ats", "boardToken", "externalId", "url", "strata",
  "title", "seniority", "locationPolicy", "locationGeo", "compMin", "compMax",
  "compCurrency", "sponsorship", "stack", "employmentType", "flags", "description",
];

function reorder(record: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of FIELD_ORDER) out[key] = record[key];
  return out;
}

async function readPool(): Promise<Record<string, unknown>[]> {
  const text = await readFile(POOL_PATH, "utf8");
  return text.trim().split(/\n\s*\n/).map((block) => JSON.parse(block));
}

async function writePool(records: Record<string, unknown>[]) {
  const blocks = records.map((r) => JSON.stringify(reorder(r), null, 2));
  await writeFile(POOL_PATH, blocks.join("\n\n") + "\n");
}

type LocationNode = {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  countryCode: string | null;
  admin1Code: string | null;
  population: number | null;
  aliases: string[];
};

async function readLocations(): Promise<LocationNode[]> {
  return JSON.parse(await readFile(LOCATIONS_PATH, "utf8"));
}

// "San Francisco" alone doesn't say which one — walk up to the admin1/country names so the
// dropdown reads "San Francisco, California, United States" instead of five identical rows.
function locationContext(node: LocationNode, byId: Map<string, LocationNode>): string {
  const parts: string[] = [];
  let current = node.parentId ? byId.get(node.parentId) : undefined;
  while (current) {
    if (current.type !== "continent") parts.push(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(", ");
}

function readBody(req: Parameters<NonNullable<ReturnType<ViteDevServer["middlewares"]["use"]>>>[0]): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function evalApiPlugin(): Plugin {
  return {
    name: "eval-ui-api",
    configureServer(server) {
      server.middlewares.use("/api/pool", async (req, res, next) => {
        try {
          if (req.method === "GET" && req.url === "/") {
            const pool = await readPool();
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(pool));
            return;
          }
          const match = req.method === "PUT" && req.url?.match(/^\/(\d+)$/);
          if (match) {
            const index = Number(match[1]);
            const body = JSON.parse(await readBody(req));
            const pool = await readPool();
            if (index < 0 || index >= pool.length) {
              res.statusCode = 404;
              res.end("record index out of range");
              return;
            }
            pool[index] = body;
            await writePool(pool);
            res.statusCode = 204;
            res.end();
            return;
          }
          next();
        } catch (e) {
          res.statusCode = 500;
          res.end((e as Error).message);
        }
      });

      server.middlewares.use("/api/locations", async (req, res, next) => {
        try {
          if (req.method === "GET") {
            const url = new URL(req.url ?? "", "http://localhost");
            const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
            const nodes = await readLocations();
            const byId = new Map(nodes.map((n) => [n.id, n]));
            // "San Francisco, CA" (pop ~874k) was getting buried below "San Francisco de
            // Macorís" (pop ~126k) and other same-name matches in arbitrary file order —
            // sort by population (bigger, more likely places first) before truncating.
            const matches = q
              ? nodes
                  .filter((n) => n.name.toLowerCase().includes(q) || n.aliases.some((a) => a.toLowerCase().includes(q)))
                  .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
                  .slice(0, 20)
                  .map((n) => ({ ...n, context: locationContext(n, byId) }))
              : [];
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(matches));
            return;
          }
          if (req.method === "POST") {
            const body = JSON.parse(await readBody(req)) as { name: string };
            const nodes = await readLocations();
            const id = `custom:${body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            const existing = nodes.find((n) => n.id === id);
            if (existing) {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(existing));
              return;
            }
            // ponytail: type/hierarchy for a hand-added place can't be inferred from a bare
            // name, so it's filed as a parentless "custom" node rather than guessed at.
            // Upgrade path: reconcile these into the real hierarchy in a later GeoNames pass.
            const node: LocationNode = {
              id,
              type: "custom",
              name: body.name.trim(),
              parentId: null,
              countryCode: null,
              admin1Code: null,
              population: null,
              aliases: [],
            };
            nodes.push(node);
            await writeFile(LOCATIONS_PATH, JSON.stringify(nodes.sort((a, b) => a.id.localeCompare(b.id)), null, 2) + "\n");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(node));
            return;
          }
          next();
        } catch (e) {
          res.statusCode = 500;
          res.end((e as Error).message);
        }
      });
    },
  };
}
