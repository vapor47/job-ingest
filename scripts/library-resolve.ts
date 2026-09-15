// Shared by extract.ts (normalizes model output) and metrics.ts (normalizes both truth and
// prediction before scoring) — titleCanonical/locationGeo/stack are growable-library fields
// (data/titles, data/geo, data/stack), and free text on either side of a comparison can name the
// same real thing without matching as a string. Resolving both sides through this same code is
// what makes them comparable without hand-editing ground truth into a specific format.

import { readFile } from "node:fs/promises";

export type LocationNode = {
  id: string; type: string; name: string; parentId: string | null;
  countryCode: string | null; admin1Code: string | null; population: number | null; aliases: string[];
};
export type LibNode = { id: string; name: string; aliases: string[] };
export type Libraries = { locations: LocationNode[]; locationsById: Map<string, LocationNode>; titles: LibNode[]; stack: LibNode[] };

export async function loadLibraries(): Promise<Libraries> {
  const locations: LocationNode[] = JSON.parse(await readFile("data/geo/locations.json", "utf8"));
  return {
    locations,
    locationsById: new Map(locations.map((n) => [n.id, n])),
    titles: JSON.parse(await readFile("data/titles/canonical-titles.json", "utf8")),
    stack: JSON.parse(await readFile("data/stack/canonical-stack.json", "utf8")),
  };
}

// Exact match only (name or alias, case-insensitive) — unlike api-plugin.ts's dropdown search,
// this pick is never reviewed by a human before landing in a score or a prediction, so a loose
// substring match is a silent wrong answer rather than a suggestion (e.g. "EU" would
// substring-match "Ceuta"). A miss just falls through to the new-node candidate list (or, in
// metrics, stays as the original string), which is the safe failure.
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

// Resolves one location string to its canonical library form, or returns it unchanged if there's
// no match (still comparable as a string — just not library-normalized).
export function normalizeLocation(libs: Libraries, value: string): string {
  const match = resolveLocationNode(libs.locations, value);
  return match ? formatLocation(match, libs.locationsById) : value;
}

export function resolveSimpleNode(nodes: LibNode[], value: string): LibNode | null {
  const needle = value.trim().toLowerCase();
  return nodes.find((n) => n.name.toLowerCase() === needle || n.aliases.some((a) => a.toLowerCase() === needle)) ?? null;
}

export function normalizeSimple(nodes: LibNode[], value: string): string {
  return resolveSimpleNode(nodes, value)?.name ?? value;
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
