import { test } from "node:test";
import assert from "node:assert/strict";
import { jobPostingSchema } from "./job-posting.ts";

const valid = {
  title: "Senior Backend Engineer",
  titleCanonical: "Backend Engineer",
  jobFunction: "engineering",
  seniority: ["senior"],
  locationPolicy: ["remote"],
  locationGeo: ["US"],
  compMin: 180000,
  compMax: 220000,
  compCurrency: "USD",
  stack: ["TypeScript", "PostgreSQL"],
  employmentType: "full_time",
};

test("accepts a fully populated record", () => {
  assert.deepEqual(jobPostingSchema.parse(valid), valid);
});

test("accepts nulls for every extracted field except title", () => {
  const allNull = { ...valid };
  for (const key of Object.keys(allNull) as (keyof typeof allNull)[]) {
    if (key !== "title") (allNull as any)[key] = null;
  }
  assert.doesNotThrow(() => jobPostingSchema.parse(allNull));
});

test("rejects an unknown enum value", () => {
  assert.throws(() => jobPostingSchema.parse({ ...valid, seniority: ["wizard"] }));
  assert.throws(() => jobPostingSchema.parse({ ...valid, locationPolicy: ["moon"] }));
});

test("accepts locationPolicy naming more than one option, e.g. remote or a listed office", () => {
  assert.doesNotThrow(() => jobPostingSchema.parse({ ...valid, locationPolicy: ["remote", "onsite"] }));
});

test("rejects a missing title", () => {
  assert.throws(() => jobPostingSchema.parse({ ...valid, title: "" }));
});

test("accepts any stack entry, growable library is not schema-enforced", () => {
  assert.doesNotThrow(() => jobPostingSchema.parse({ ...valid, stack: ["Cobol"] }));
});
