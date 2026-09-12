// One-off analysis script (JOS-63 follow-up): polls every board in data/board-tokens.json and
// tallies which countries our actual postings' `location` strings resolve to, so the location
// taxonomy's country allowlist is grounded in the real corpus instead of a guess. Not part of
// the regular pipeline — run once, read the printed tally, decide the allowlist, done.
//
// Usage: node scripts/analyze-board-countries.ts

import { readFile } from "node:fs/promises";
import { fetchBoard } from "../src/ingest/ats.ts";
import type { Ats } from "../src/schema/job-posting.ts";

const CONCURRENCY = 8;
const MIN_CITY_POPULATION = 50_000; // avoid small-town name collisions in free-text matching

const US_STATE_ABBR = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC", "PR",
];
const CA_PROVINCE_ABBR = ["ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"];

// Full state/province names, not just abbreviations — otherwise "Florida" or "Santa Clara, CA"
// (the full word, not the postal code) falls through to matching a same-named small foreign
// town (there's a "Florida" and a "Santa Clara" in Cuba) instead of the intended US location.
const US_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina",
  "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island",
  "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
];
const CA_PROVINCE_NAMES = [
  "Ontario", "Quebec", "British Columbia", "Alberta", "Manitoba", "Saskatchewan",
  "Nova Scotia", "New Brunswick", "Newfoundland and Labrador", "Prince Edward Island",
  "Yukon", "Northwest Territories", "Nunavut",
];
const COUNTRY_ALIASES: Record<string, string> = {
  US: "US", USA: "US", "U.S.": "US", "U.S.A.": "US", "UNITED STATES": "US",
  UK: "GB", "U.K.": "GB", "UNITED KINGDOM": "GB",
  UAE: "AE",
};

// Generic single-word admin1/city names collide with everyday English (many countries name a
// province "Central" or "Eastern") and were inflating unrelated countries — e.g. "Innovation
// Centre" in a location string was matching Cameroon's "Centre" province. Excluded from the
// dictionary entirely rather than guessed at.
const AMBIGUOUS_NAME_STOPLIST = new Set([
  "CENTRAL", "EAST", "WEST", "NORTH", "SOUTH", "EASTERN", "WESTERN", "NORTHERN", "SOUTHERN",
  "NORTH EAST", "NORTHEAST", "NORTH WEST", "NORTHWEST", "SOUTH EAST", "SOUTHEAST",
  "SOUTH WEST", "SOUTHWEST", "SOUTH-WEST", "SOUTH-EAST", "NORTH-WEST", "NORTH-EAST",
  "FAR NORTH", "CAPITAL", "CAPITAL REGION", "FEDERAL", "REGION", "PROVINCE",
  "STATE", "TERRITORY", "ISLAND", "ISLANDS", "VALLEY", "COAST", "CENTER", "CENTRE", "BAY",
  "GREATER", "SOUTHERN PENINSULA",
]);

type LocationNode = {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  countryCode: string | null;
  population: number | null;
  aliases: string[];
};

async function buildMatcher() {
  const nodes: LocationNode[] = JSON.parse(await readFile("data/geo/locations.json", "utf8"));
  const dict = new Map<string, string>(); // uppercased name -> ISO country code

  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) dict.set(alias, code);
  for (const abbr of US_STATE_ABBR) dict.set(abbr, "US");
  for (const abbr of CA_PROVINCE_ABBR) dict.set(abbr, "CA");
  for (const name of US_STATE_NAMES) dict.set(name.toUpperCase(), "US");
  for (const name of CA_PROVINCE_NAMES) dict.set(name.toUpperCase(), "CA");

  // Name collisions are real (GeoNames has a "San Francisco" in the Philippines too, a
  // "Manchester" parish in Jamaica alongside Manchester, England, and South Africa's
  // alternate-names table lists "USA" as an alias by mistake) — arbitrary file order is not a
  // safe tiebreaker. Rank by trust tier (hardcoded alias > country > admin1/city together), and
  // within that shared tier let population settle it — admin1s have no population figure here
  // so they default to 0, meaning any real, populous city of the same name wins the collision.
  const tier = new Map<string, number>(); // key -> tier of current owner
  const pop = new Map<string, number>(); // key -> population of current owner (city tier only)
  for (const key of dict.keys()) tier.set(key, 3); // COUNTRY_ALIASES / state / province abbrs

  const addName = (name: string, code: string, entryTier: number, population = 0) => {
    const key = name.toUpperCase();
    if (AMBIGUOUS_NAME_STOPLIST.has(key)) return;
    const currentTier = tier.get(key);
    if (currentTier === undefined || entryTier > currentTier ||
        (entryTier === currentTier && population > (pop.get(key) ?? 0))) {
      dict.set(key, code);
      tier.set(key, entryTier);
      pop.set(key, population);
    }
  };

  for (const n of nodes) {
    if (n.type === "country") {
      const code = n.id.replace("country:", "");
      addName(n.name, code, 2);
      for (const alias of n.aliases) addName(alias, code, 2);
    } else if (n.type === "admin1" && n.countryCode) {
      addName(n.name, n.countryCode, 0);
      for (const alias of n.aliases) addName(alias, n.countryCode, 0);
    } else if (n.type === "city" && n.countryCode && (n.population ?? 0) >= MIN_CITY_POPULATION) {
      addName(n.name, n.countryCode, 0, n.population ?? 0);
      for (const alias of n.aliases) addName(alias, n.countryCode, 0, n.population ?? 0);
    }
  }

  // Longest name first, so "San Francisco" (city) is tried before any short accidental substring.
  const keys = [...dict.keys()].sort((a, b) => b.length - a.length);
  const patterns = keys.map((k) => ({ key: k, re: new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") }));

  return function resolveCountry(segment: string): string | null {
    for (const { key, re } of patterns) {
      if (re.test(segment)) return dict.get(key)!;
    }
    return null;
  };
}

async function main() {
  const resolveCountry = await buildMatcher();
  const { tokens } = JSON.parse(await readFile("data/board-tokens.json", "utf8")) as {
    tokens: { company: string; token: string; ats: Ats }[];
  };

  const countryCounts = new Map<string, number>();
  let remoteGeneric = 0;
  let unmatched = 0;
  const unmatchedSamples = new Set<string>();
  let cursor = 0;
  let polled = 0;

  async function worker() {
    while (cursor < tokens.length) {
      const t = tokens[cursor++];
      let postings;
      try {
        postings = await fetchBoard(t.token, t.ats);
      } catch {
        continue;
      }
      for (const p of postings) {
        for (const segment of (p.location ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
          const code = resolveCountry(segment);
          if (code) {
            countryCounts.set(code, (countryCounts.get(code) ?? 0) + 1);
          } else if (/remote|anywhere|emea|apac|timezone/i.test(segment)) {
            remoteGeneric++;
          } else {
            unmatched++;
            if (unmatchedSamples.size < 30) unmatchedSamples.add(segment);
          }
        }
      }
      polled++;
      process.stdout.write(`\r  ${polled}/${tokens.length} boards polled`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n\n");

  const sorted = [...countryCounts.entries()].sort((a, b) => b[1] - a[1]);
  console.log("Country tally (postings with a location string resolving to that country):");
  for (const [code, count] of sorted) console.log(`  ${code}: ${count}`);
  console.log(`\nGeneric remote (no specific country in the string): ${remoteGeneric}`);
  console.log(`Unmatched (couldn't resolve to a country): ${unmatched}`);
  console.log(`\nSample unmatched strings:`);
  for (const s of unmatchedSamples) console.log(`  "${s}"`);
}

main();
