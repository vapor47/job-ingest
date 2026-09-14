import { pgTable, serial, text, integer, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod";

export const SENIORITY = ["intern", "junior", "mid", "senior", "staff", "principal"] as const;
// "in_person" covers a posting that clearly requires some in-office presence without stating
// whether it's every day or some days — candidates mostly filter on remote vs. in-person first,
// so this is a real answer, not a fallback to null, when hybrid vs. onsite can't be determined.
export const LOCATION_POLICY = ["remote", "in_person", "hybrid", "onsite"] as const;
export const EMPLOYMENT_TYPE = ["full_time", "part_time", "contract", "internship"] as const;

// Job-function bucket. Only "engineering" exists today — EVAL-1's first labeling pass is
// scoped to engineering roles (see JOS-52 follow-up). Other functions (sales, marketing, ...)
// get added here as later passes bring them into scope; null means "not yet classified into
// scope", not "confirmed non-engineering".
export const JOB_FUNCTION = ["engineering"] as const;

export const jobPostings = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  titleCanonical: text("title_canonical"),
  jobFunction: text("job_function", { enum: JOB_FUNCTION }),
  // Array, not a single enum: a posting can name more than one level ("Senior/Staff"), and
  // collapsing that to one value would wrongly exclude it from a level-specific search.
  seniority: jsonb("seniority").$type<string[] | null>(),
  // Also an array: a posting can offer a genuine choice ("Remote or onsite in SF"), and picking
  // one would wrongly exclude it from whichever the candidate didn't search for.
  locationPolicy: jsonb("location_policy").$type<string[] | null>(),
  locationGeo: jsonb("location_geo").$type<string[] | null>(),
  compMin: integer("comp_min"),
  compMax: integer("comp_max"),
  compCurrency: text("comp_currency"),
  stack: jsonb("stack").$type<string[] | null>(),
  employmentType: text("employment_type", { enum: EMPLOYMENT_TYPE }),
});

// Every extracted field is nullable: null means "the posting does not say", not a failure.
// `title` is copied verbatim from the source, not extracted, so it stays required.
//
// `titleCanonical`, `locationGeo`, and `stack` are all human-assigned, growable-library fields —
// each has a JSON library (data/titles/canonical-titles.json, data/geo/locations.json,
// data/stack/canonical-stack.json) that labelers add to on the fly via the eval UI's "add if
// not found" escape hatch, so each is a bare nullable string (or array of them) rather than a
// fixed z.enum.
export const jobPostingSchema = z.object({
  title: z.string().min(1),
  titleCanonical: z.string().nullable(),
  jobFunction: z.enum(JOB_FUNCTION).nullable(),
  seniority: z.array(z.enum(SENIORITY)).nullable(),
  locationPolicy: z.array(z.enum(LOCATION_POLICY)).nullable(),
  locationGeo: z.array(z.string()).nullable(),
  compMin: z.number().nullable(),
  compMax: z.number().nullable(),
  compCurrency: z.string().nullable(),
  stack: z.array(z.string()).nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPE).nullable(),
});

export type JobPosting = z.infer<typeof jobPostingSchema>;

// Bumped whenever a field is added, removed, or its meaning changes — extraction runs stamp
// this alongside (prompt hash, model id) so a prediction can always be traced back to the
// contract it was extracted against (EVAL-3 acceptance).
export const SCHEMA_VERSION = "job-posting-v1";

export const ATS_SOURCES = ["greenhouse", "lever", "ashby"] as const;
export type Ats = (typeof ATS_SOURCES)[number];

// What a poller returns: the posting as the board published it, normalized only enough
// that the three ATSes are interchangeable downstream. Nothing here is extracted or
// inferred — `description` is the text an extractor reads, `raw` is the untouched payload
// so a later pass can mine structured fields (Lever salaryRange, Ashby compensation)
// without re-polling.
export const rawPostingSchema = z.object({
  ats: z.enum(ATS_SOURCES),
  boardToken: z.string().min(1),
  externalId: z.string().min(1),
  requisitionId: z.string().nullable(), // stable across a repost; only Greenhouse exposes one
  url: z.url(),
  title: z.string().min(1),
  company: z.string().nullable(), // only Greenhouse names the board's owner
  location: z.string().nullable(),
  department: z.string().nullable(),
  employmentTypeRaw: z.string().nullable(), // board's own wording, not the schema enum
  publishedAt: z.string().nullable(), // ISO 8601
  description: z.string(),
  fetchedAt: z.string(),
  raw: z.unknown(),
});

export type RawPosting = z.infer<typeof rawPostingSchema>;
