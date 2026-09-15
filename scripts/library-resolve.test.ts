import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveLocationNode, formatLocation, normalizeLocation,
  resolveSimpleNode, normalizeSimple, resolveLibraryFields, type LocationNode,
} from "./library-resolve.ts";

const nodes: LocationNode[] = [
  { id: "country:US", type: "country", name: "United States", parentId: "continent:NA", countryCode: "US", admin1Code: null, population: null, aliases: [] },
  { id: "country:KR", type: "country", name: "South Korea", parentId: "continent:AS", countryCode: "KR", admin1Code: null, population: null, aliases: [] },
  { id: "geonames:mv", type: "city", name: "Mountain View", parentId: "geonames:ca", countryCode: "US", admin1Code: "US.CA", population: 82739, aliases: [] },
  { id: "city:seoul", type: "city", name: "Seoul", parentId: "country:KR", countryCode: "KR", admin1Code: null, population: 9776000, aliases: [] },
  { id: "remote:US", type: "remote", name: "Remote - United States", parentId: "country:US", countryCode: "US", admin1Code: null, population: null, aliases: ["Remote — United States"] },
];
const byId = new Map(nodes.map((n) => [n.id, n]));

test("resolveLocationNode matches a bare city name exactly", () => {
  assert.equal(resolveLocationNode(nodes, "Seoul")?.id, "city:seoul");
});

test("resolveLocationNode retries on the part before the comma", () => {
  assert.equal(resolveLocationNode(nodes, "Mountain View, CA")?.id, "geonames:mv");
});

test("resolveLocationNode returns null with no match", () => {
  assert.equal(resolveLocationNode(nodes, "Atlantis"), null);
});

test("formatLocation renders US cities as City, ST", () => {
  assert.equal(formatLocation(nodes[2], byId), "Mountain View, CA");
});

test("formatLocation renders non-US cities as City, Country", () => {
  assert.equal(formatLocation(nodes[3], byId), "Seoul, South Korea");
});

test("formatLocation collapses a remote node to its parent's plain name", () => {
  assert.equal(formatLocation(nodes[4], byId), "United States");
});

test("normalizeLocation makes a bare truth-style name and a formatted prediction agree", () => {
  const libs = { locations: nodes, locationsById: byId, titles: [], stack: [] };
  assert.equal(normalizeLocation(libs, "Mountain View"), normalizeLocation(libs, "Mountain View, CA"));
});

test("normalizeLocation leaves an unmatched value unchanged", () => {
  const libs = { locations: nodes, locationsById: byId, titles: [], stack: [] };
  assert.equal(normalizeLocation(libs, "Nowhereville"), "Nowhereville");
});

test("resolveSimpleNode matches case-insensitively on name or alias", () => {
  const titles = [{ id: "backend-engineer", name: "Backend Engineer", aliases: ["SWE, Backend"] }];
  assert.equal(resolveSimpleNode(titles, "backend engineer")?.id, "backend-engineer");
  assert.equal(resolveSimpleNode(titles, "SWE, Backend")?.id, "backend-engineer");
  assert.equal(resolveSimpleNode(titles, "Frontend Engineer"), null);
});

test("normalizeSimple falls back to the original value with no match", () => {
  const titles = [{ id: "backend-engineer", name: "Backend Engineer", aliases: [] }];
  assert.equal(normalizeSimple(titles, "backend engineer"), "Backend Engineer");
  assert.equal(normalizeSimple(titles, "Made Up Title"), "Made Up Title");
});

test("resolveLibraryFields normalizes matches and reports the rest as candidates", () => {
  const libs = { locations: nodes, locationsById: byId, titles: [], stack: [] };
  const out = { titleCanonical: "Made Up Title", locationGeo: ["Mountain View, CA", "Nowhereville"], stack: null };
  const candidates: { id: string; field: string; value: string }[] = [];
  resolveLibraryFields("posting-1", out, libs, candidates);
  assert.deepEqual(out.locationGeo, ["Mountain View, CA", "Nowhereville"]);
  assert.deepEqual(candidates, [
    { id: "posting-1", field: "titleCanonical", value: "Made Up Title" },
    { id: "posting-1", field: "locationGeo", value: "Nowhereville" },
  ]);
});
