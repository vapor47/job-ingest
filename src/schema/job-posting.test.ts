import { test } from "node:test";
import assert from "node:assert/strict";
import { jobPostingSchema, canonicalizeStack } from "./job-posting.ts";

const valid = {
  title: "Senior Backend Engineer",
  titleCanonical: "Backend Engineer",
  jobFunction: "engineering",
  seniority: "senior",
  locationPolicy: "remote",
  locationGeo: ["US"],
  compMin: 180000,
  compMax: 220000,
  compCurrency: "USD",
  sponsorship: false,
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
  assert.throws(() => jobPostingSchema.parse({ ...valid, seniority: "wizard" }));
  assert.throws(() => jobPostingSchema.parse({ ...valid, locationPolicy: "moon" }));
  assert.throws(() => jobPostingSchema.parse({ ...valid, stack: ["Cobol"] }));
});

test("rejects a missing title", () => {
  assert.throws(() => jobPostingSchema.parse({ ...valid, title: "" }));
});

test("canonicalizeStack folds aliases onto one token", () => {
  assert.equal(canonicalizeStack("JS"), "JavaScript");
  assert.equal(canonicalizeStack("es6"), "JavaScript");
  assert.equal(canonicalizeStack("JavaScript"), "JavaScript");
  assert.equal(canonicalizeStack("cobol"), null);
});
