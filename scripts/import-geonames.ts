// JOS-63: builds data/geo/locations.json, a flat hierarchical place list for locationGeo
// autocomplete (labeling tool) and later area-based filtering (M3).
//
// Source: GeoNames (https://www.geonames.org), CC BY 4.0 — see docs/data-sources.md.
// Raw downloads are cached under data/cache/geonames/ (gitignored); only the small,
// filtered output below is committed.
//
// Hierarchy is continent -> country -> admin1 (state/province) -> city, built from each
// city's own country/admin1 codes rather than GeoNames' hierarchy.zip — cities15000 already
// carries those codes, so no extra file or join is needed to get the same tree.
//
// A handful of synthetic "remote:*" nodes are added on top for region-wide remote
// eligibility (e.g. "Remote — United States"), since GeoNames only models real places.
//
// Usage: node scripts/import-geonames.ts

import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import readline from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const CACHE = "data/cache/geonames";
const OUT_DIR = "data/geo";
const BASE = "https://download.geonames.org/export/dump";

// GeoNames' continent codes have no dedicated download; this list is fixed and tiny.
const CONTINENTS: Record<string, string> = {
  AF: "Africa", AS: "Asia", EU: "Europe", NA: "North America",
  OC: "Oceania", SA: "South America", AN: "Antarctica",
};

// Country scope for pre-created "Remote — <Country>" nodes. This project's board tokens
// are, as of writing, overwhelmingly US companies. Anything else gets its remote node added
// later through the labeling tool's "add new location" escape hatch, per JOS-63.
const REMOTE_COUNTRIES = ["US"];

type Node = {
  id: string;
  type: "continent" | "country" | "admin1" | "city" | "remote";
  name: string;
  parentId: string | null;
  countryCode: string | null;
  admin1Code: string | null;
  population: number | null;
  aliases: string[];
};

async function download(file: string): Promise<string> {
  const dest = `${CACHE}/${file}`;
  await mkdir(CACHE, { recursive: true });
  const exists = await readFile(dest).then(() => true).catch(() => false);
  if (exists) return dest;
  console.log(`  downloading ${file}...`);
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${file}`);
  await pipeline(res.body as any, createWriteStream(dest));
  return dest;
}

async function unzip(zipPath: string, entry: string): Promise<string> {
  const dest = `${CACHE}/${entry}`;
  const exists = await readFile(dest).then(() => true).catch(() => false);
  if (!exists) await run("unzip", ["-o", zipPath, entry, "-d", CACHE]);
  return dest;
}

async function main() {
  console.log("Fetching GeoNames source files...");
  const citiesZip = await download("cities15000.zip");
  const citiesTxt = await unzip(citiesZip, "cities15000.txt");
  const admin1Path = await download("admin1CodesASCII.txt");
  const countryPath = await download("countryInfo.txt");
  const altZip = await download("alternateNamesV2.zip");
  const altTxt = await unzip(altZip, "alternateNamesV2.txt");

  const nodes = new Map<string, Node>();

  for (const [code, name] of Object.entries(CONTINENTS)) {
    nodes.set(`continent:${code}`, {
      id: `continent:${code}`, type: "continent", name, parentId: null,
      countryCode: null, admin1Code: null, population: null, aliases: [],
    });
  }

  // countryInfo.txt: tab-separated, comment lines start with #. Columns include
  // ISO, name, ..., continent (col 8), geonameid (col 16).
  const countryLines = (await readFile(countryPath, "utf8")).split("\n").filter((l) => l && !l.startsWith("#"));
  const countryGeonameId = new Map<string, string>(); // ISO -> geonameId, for admin1/city linking
  for (const line of countryLines) {
    const c = line.split("\t");
    const [iso, , , , name, , , , continent, , , , , , , , geonameId] = c;
    if (!iso || !geonameId) continue;
    countryGeonameId.set(iso, geonameId);
    nodes.set(`country:${iso}`, {
      id: `country:${iso}`, type: "country", name, parentId: `continent:${continent}`,
      countryCode: iso, admin1Code: null, population: null, aliases: [],
    });
  }

  // admin1CodesASCII.txt: "CC.ADM1<TAB>name<TAB>ascii name<TAB>geonameid"
  const admin1Lines = (await readFile(admin1Path, "utf8")).split("\n").filter(Boolean);
  const admin1ByCode = new Map<string, string>(); // "CC.ADM1" -> node id
  for (const line of admin1Lines) {
    const [code, name, , geonameId] = line.split("\t");
    if (!code || !geonameId) continue;
    const [cc] = code.split(".");
    const id = `geonames:${geonameId}`;
    admin1ByCode.set(code, id);
    nodes.set(id, {
      id, type: "admin1", name, parentId: `country:${cc}`,
      countryCode: cc, admin1Code: code, population: null, aliases: [],
    });
  }

  // cities15000.txt: geonameid, name, asciiname, alternatenames, lat, lon, feature class,
  // feature code, country code, cc2, admin1 code, admin2, admin3, admin4, population, ...
  const cityGeonameIds = new Set<string>();
  const cityLines = (await readFile(citiesTxt, "utf8")).split("\n").filter(Boolean);
  for (const line of cityLines) {
    const f = line.split("\t");
    const geonameId = f[0];
    const name = f[1];
    const countryCode = f[8];
    const admin1Code = f[10];
    const population = Number(f[14]) || null;
    if (!geonameId || !name || !countryCode) continue;
    const admin1Key = admin1Code ? `${countryCode}.${admin1Code}` : "";
    const parentId = admin1ByCode.get(admin1Key) ?? `country:${countryCode}`;
    const id = `geonames:${geonameId}`;
    cityGeonameIds.add(geonameId);
    nodes.set(id, {
      id, type: "city", name, parentId,
      countryCode, admin1Code: admin1Key || null, population, aliases: [],
    });
  }

  for (const cc of REMOTE_COUNTRIES) {
    const countryId = `country:${cc}`;
    if (!nodes.has(countryId)) throw new Error(`REMOTE_COUNTRIES has unknown country code ${cc}`);
    nodes.set(`remote:${cc}`, {
      id: `remote:${cc}`, type: "remote", name: `Remote — ${nodes.get(countryId)!.name}`,
      parentId: countryId, countryCode: cc, admin1Code: null, population: null, aliases: [],
    });
  }
  nodes.set("remote:global", {
    id: "remote:global", type: "remote", name: "Remote — Global", parentId: null,
    countryCode: null, admin1Code: null, population: null, aliases: [],
  });

  // alternateNamesV2.txt: alternateNameId, geonameid, isolanguage, alternate name,
  // isPreferredName, isShortName, isColloquial, isHistoric, from, to. English names and
  // abbreviations only (isolanguage 'en' or 'abbr') — see JOS-63 on alias scope.
  const geonameIdToNodeId = new Map<string, string>();
  for (const id of [...cityGeonameIds]) geonameIdToNodeId.set(id, `geonames:${id}`);
  for (const [code, id] of admin1ByCode) geonameIdToNodeId.set(id.slice("geonames:".length), id);
  for (const [iso, gid] of countryGeonameId) geonameIdToNodeId.set(gid, `country:${iso}`);

  console.log("  scanning alternate names (this is the large file)...");
  const rl = readline.createInterface({ input: createReadStream(altTxt), crlfDelay: Infinity });
  let aliasCount = 0;
  for await (const line of rl) {
    const f = line.split("\t");
    const geonameId = f[1];
    const lang = f[2];
    const altName = f[3];
    if (!geonameId || !altName || (lang !== "en" && lang !== "abbr")) continue;
    const nodeId = geonameIdToNodeId.get(geonameId);
    if (!nodeId) continue;
    const node = nodes.get(nodeId)!;
    if (!node.aliases.includes(altName) && altName !== node.name) {
      node.aliases.push(altName);
      aliasCount++;
    }
  }
  console.log(`  ${aliasCount} aliases attached`);

  await mkdir(OUT_DIR, { recursive: true });
  const out = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(`${OUT_DIR}/locations.json`, JSON.stringify(out, null, 2) + "\n");

  const counts = out.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nWrote ${out.length} nodes to ${OUT_DIR}/locations.json`);
  console.log(counts);
}

main();
