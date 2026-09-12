// JOS-52 eval UI backend: a Vite dev-server plugin, not a standalone server, since Vite is
// already a devDependency once added for the React frontend — no need for Express too.
//
// Endpoints:
//   GET  /api/pool                 -> full pool (array of records, in file order)
//   PUT  /api/pool/:index          -> replace one record, rewrite pool.jsonl (autosave)
//   GET  /api/locations?q=<text>   -> up to 20 name/alias matches (never ships all ~38k nodes)
//   POST /api/locations            -> append a new node { name }, where name may be
//                                      "Child, Parent" to nest under an existing (or
//                                      just-added) node; returns { node, orphaned, attemptedParent }
//   GET  /api/titles?q=<text>      -> up to 20 name/alias matches from the canonical title library
//   POST /api/titles               -> append a new canonical title { name }, return it
//   GET  /api/stack?q=<text>       -> up to 20 name/alias matches from the canonical stack library
//   POST /api/stack                -> append a new stack entry { name }, return it

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const POOL_PATH = path.join(REPO_ROOT, "data/eval/pool.jsonl");
const LOCATIONS_PATH = path.join(REPO_ROOT, "data/geo/locations.json");
const TITLES_PATH = path.join(REPO_ROOT, "data/titles/canonical-titles.json");
const STACK_PATH = path.join(REPO_ROOT, "data/stack/canonical-stack.json");

// Shared by /api/titles and /api/stack's "add new" handlers. Symbols are spelled out rather
// than stripped so distinct names don't collide onto the same id ("C++" vs "C#" both reducing
// to "c-" was a real bug caught seeding data/stack/canonical-stack.json).
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/#/g, "sharp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Same key order as scripts/build-eval-pool.ts's writePool, so re-saved records look
// identical to freshly-generated ones under a diff.
const FIELD_ORDER = [
  "id", "company", "ats", "boardToken", "externalId", "url", "strata",
  "title", "titleCanonical", "jobFunction", "seniority", "locationPolicy", "locationGeo", "compMin", "compMax",
  "compCurrency", "sponsorship", "stack", "employmentType", "flags", "description",
];

function reorder(record: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of FIELD_ORDER) out[key] = record[key];
  return out;
}

async function readPool(): Promise<Record<string, unknown>[]> {
  const text = await readFile(POOL_PATH, "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

async function writePool(records: Record<string, unknown>[]) {
  const lines = records.map((r) => JSON.stringify(reorder(r)));
  await writeFile(POOL_PATH, lines.join("\n") + "\n");
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

// Shared by the search dropdown and the "add new" parent lookup below: substring match on
// name/alias, exact match first, then biggest population — "San Francisco, CA" (pop ~874k)
// would otherwise get buried below "San Francisco de Macorís" (pop ~126k) in arbitrary file
// order. Exact match must win the tie-break too: admin1 records carry no population data, so
// typing "California" as an add-new parent would otherwise resolve to whichever of
// California/Baja California/Baja California Sur (all substring matches, all population null)
// happened to appear first in the file, rather than the one actually typed.
function matchLocations(nodes: LocationNode[], q: string): LocationNode[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const isExact = (n: LocationNode) => n.name.toLowerCase() === needle || n.aliases.some((a) => a.toLowerCase() === needle);
  return nodes
    .filter((n) => n.name.toLowerCase().includes(needle) || n.aliases.some((a) => a.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const exactDiff = Number(isExact(b)) - Number(isExact(a));
      return exactDiff !== 0 ? exactDiff : (b.population ?? 0) - (a.population ?? 0);
    });
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

type TitleNode = { id: string; name: string; aliases: string[] };

async function readTitles(): Promise<TitleNode[]> {
  return JSON.parse(await readFile(TITLES_PATH, "utf8"));
}

type StackNode = { id: string; name: string; aliases: string[] };

async function readStack(): Promise<StackNode[]> {
  return JSON.parse(await readFile(STACK_PATH, "utf8"));
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
              ? matchLocations(nodes, q)
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

            // "Menlo Park, San Francisco Bay Area" nests under an existing (or just-added)
            // node instead of always filing a flat orphan. Split on the *last* comma only —
            // no existing location name contains one, so this can't misparse real data.
            const commaAt = body.name.lastIndexOf(",");
            const namePart = (commaAt === -1 ? body.name : body.name.slice(0, commaAt)).trim();
            const parentText = commaAt === -1 ? "" : body.name.slice(commaAt + 1).trim();
            const parent = parentText ? matchLocations(nodes, parentText)[0] : undefined;
            const orphaned = parentText !== "" && !parent;

            const id = `custom:${namePart.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            const existing = nodes.find((n) => n.id === id);
            if (existing) {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ node: existing, orphaned: false, attemptedParent: null }));
              return;
            }
            // ponytail: hierarchy for a node with no resolvable parent can't be inferred from
            // a bare name, so it's filed parentless rather than guessed at. Upgrade path:
            // reconcile orphans into the real hierarchy in a later GeoNames pass.
            const node: LocationNode = {
              id,
              type: "custom",
              name: namePart,
              parentId: parent?.id ?? null,
              countryCode: parent?.countryCode ?? null,
              admin1Code: parent?.admin1Code ?? null,
              population: null,
              aliases: [],
            };
            nodes.push(node);
            await writeFile(LOCATIONS_PATH, JSON.stringify(nodes.sort((a, b) => a.id.localeCompare(b.id)), null, 2) + "\n");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ node, orphaned, attemptedParent: orphaned ? parentText : null }));
            return;
          }
          next();
        } catch (e) {
          res.statusCode = 500;
          res.end((e as Error).message);
        }
      });

      server.middlewares.use("/api/titles", async (req, res, next) => {
        try {
          if (req.method === "GET") {
            const url = new URL(req.url ?? "", "http://localhost");
            const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
            const titles = await readTitles();
            const matches = q
              ? titles
                  .filter((t) => t.name.toLowerCase().includes(q) || t.aliases.some((a) => a.toLowerCase().includes(q)))
                  .slice(0, 20)
              : [];
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(matches));
            return;
          }
          if (req.method === "POST") {
            const body = JSON.parse(await readBody(req)) as { name: string };
            const titles = await readTitles();
            const id = slugify(body.name);
            const existing = titles.find((t) => t.id === id);
            if (existing) {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(existing));
              return;
            }
            const node: TitleNode = { id, name: body.name.trim(), aliases: [] };
            titles.push(node);
            await writeFile(TITLES_PATH, JSON.stringify(titles.sort((a, b) => a.id.localeCompare(b.id)), null, 2) + "\n");
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

      server.middlewares.use("/api/stack", async (req, res, next) => {
        try {
          if (req.method === "GET") {
            const url = new URL(req.url ?? "", "http://localhost");
            const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
            const stack = await readStack();
            const matches = q
              ? stack
                  .filter((s) => s.name.toLowerCase().includes(q) || s.aliases.some((a) => a.toLowerCase().includes(q)))
                  .slice(0, 20)
              : [];
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(matches));
            return;
          }
          if (req.method === "POST") {
            const body = JSON.parse(await readBody(req)) as { name: string };
            const stack = await readStack();
            const id = slugify(body.name);
            const existing = stack.find((s) => s.id === id);
            if (existing) {
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify(existing));
              return;
            }
            const node: StackNode = { id, name: body.name.trim(), aliases: [] };
            stack.push(node);
            await writeFile(STACK_PATH, JSON.stringify(stack.sort((a, b) => a.id.localeCompare(b.id)), null, 2) + "\n");
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
