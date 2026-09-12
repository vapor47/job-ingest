import { pgTable, serial, text, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod";

export const SENIORITY = ["intern", "junior", "mid", "senior", "staff", "principal"] as const;
export const LOCATION_POLICY = ["onsite", "hybrid", "remote"] as const;
export const EMPLOYMENT_TYPE = ["full_time", "part_time", "contract", "internship"] as const;

// Canonical stack vocabulary. Aliases fold onto one token; the schema only accepts canonical tokens.
export const STACK_ALIASES: Record<string, string> = {
  javascript: "JavaScript", js: "JavaScript", es6: "JavaScript",
  typescript: "TypeScript", ts: "TypeScript",
  python: "Python", py: "Python",
  golang: "Go", go: "Go",
  postgres: "PostgreSQL", postgresql: "PostgreSQL", psql: "PostgreSQL",
  react: "React", reactjs: "React",
  "node.js": "Node.js", nodejs: "Node.js", node: "Node.js",
  aws: "AWS",
  kubernetes: "Kubernetes", k8s: "Kubernetes",
  docker: "Docker",
  java: "Java",
  rust: "Rust",
  ruby: "Ruby",
  "c++": "C++", cpp: "C++",
  "c#": "C#", csharp: "C#",
};

export const STACK_VOCAB = [...new Set(Object.values(STACK_ALIASES))] as [string, ...string[]];

/** Maps a raw stack token to its canonical form, or null if not in the vocabulary. */
export function canonicalizeStack(raw: string): string | null {
  return STACK_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export const jobPostings = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  titleCanonical: text("title_canonical"),
  seniority: text("seniority", { enum: SENIORITY }),
  locationPolicy: text("location_policy", { enum: LOCATION_POLICY }),
  locationGeo: jsonb("location_geo").$type<string[] | null>(),
  compMin: integer("comp_min"),
  compMax: integer("comp_max"),
  compCurrency: text("comp_currency"),
  sponsorship: boolean("sponsorship"),
  stack: jsonb("stack").$type<string[] | null>(),
  employmentType: text("employment_type", { enum: EMPLOYMENT_TYPE }),
});

// Every extracted field is nullable: null means "the posting does not say", not a failure.
// `title` is copied verbatim from the source, not extracted, so it stays required.
//
// `titleCanonical` (JOS-64) is a human-assigned role bucket, not a deterministic mapping like
// `canonicalizeStack` below — the vocabulary is a growable library (data/titles/canonical-titles.json)
// that labelers add to on the fly, the same "add if not found" pattern as locationGeo, so it's a
// bare nullable string here rather than a fixed z.enum.
export const jobPostingSchema = z.object({
  title: z.string().min(1),
  titleCanonical: z.string().nullable(),
  seniority: z.enum(SENIORITY).nullable(),
  locationPolicy: z.enum(LOCATION_POLICY).nullable(),
  locationGeo: z.array(z.string()).nullable(),
  compMin: z.number().nullable(),
  compMax: z.number().nullable(),
  compCurrency: z.string().nullable(),
  sponsorship: z.boolean().nullable(),
  stack: z.array(z.enum(STACK_VOCAB)).nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPE).nullable(),
});

export type JobPosting = z.infer<typeof jobPostingSchema>;

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
