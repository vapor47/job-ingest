import type { JobPosting } from "../../../src/schema/job-posting.ts";

// A pool.jsonl record: JobPosting's label fields plus the provenance/strata metadata
// scripts/build-eval-pool.ts writes alongside them, and `flags` (rubric escape hatch,
// not part of the JobPosting contract itself).
export type PoolRecord = JobPosting & {
  id: string;
  company: string | null;
  ats: string;
  boardToken: string;
  externalId: string;
  url: string;
  strata: { sizeBucket: string; jurisdiction: string; oversample: string[] };
  flags: string[];
  description: string;
};

export type LocationNode = {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  countryCode: string | null;
  admin1Code: string | null;
  population: number | null;
  aliases: string[];
};

// What GET /api/locations returns: a LocationNode plus its resolved "State, Country" label,
// so same-named places (there are many "San Francisco"s) are distinguishable in the dropdown.
export type LocationMatch = LocationNode & { context: string };

export type TitleNode = { id: string; name: string; aliases: string[] };
