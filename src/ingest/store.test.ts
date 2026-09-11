import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBoard, ageDays, loadStore, type StoredPosting } from "./store.ts";
import type { RawPosting } from "../schema/job-posting.ts";

function posting(overrides: Partial<RawPosting>): RawPosting {
  return {
    ats: "greenhouse",
    boardToken: "acme",
    externalId: "1",
    requisitionId: null,
    url: "https://example.com/1",
    title: "Software Engineer",
    company: "Acme",
    location: "Remote",
    department: null,
    employmentTypeRaw: null,
    publishedAt: null,
    description: "Build things.",
    fetchedAt: "2026-09-01T00:00:00.000Z",
    raw: {},
    ...overrides,
  };
}

async function withTempStore(fn: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "job-ingest-store-"));
  const path = join(dir, "store.json");
  try {
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a new posting gets firstSeen = lastSeen = now", () =>
  withTempStore(async (path) => {
    const [record] = await syncBoard("greenhouse", "acme", [posting({})], { path, now: "2026-09-01T00:00:00.000Z" });
    assert.equal(record.firstSeen, "2026-09-01T00:00:00.000Z");
    assert.equal(record.lastSeen, "2026-09-01T00:00:00.000Z");
    assert.equal(record.removedAt, null);
  }));

test("a repost pair sharing requisitionId collapses to one record", () =>
  withTempStore(async (path) => {
    await syncBoard("greenhouse", "acme", [posting({ externalId: "1", requisitionId: "req-1" })], {
      path,
      now: "2026-09-01T00:00:00.000Z",
    });
    const records = await syncBoard(
      "greenhouse",
      "acme",
      [posting({ externalId: "2", requisitionId: "req-1" })],
      { path, now: "2026-09-05T00:00:00.000Z" },
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].firstSeen, "2026-09-01T00:00:00.000Z");
    assert.equal(records[0].lastSeen, "2026-09-05T00:00:00.000Z");
    assert.equal(records[0].externalId, "2");
  }));

test("a repost with no requisitionId collapses via the content hash", () =>
  withTempStore(async (path) => {
    await syncBoard("lever", "acme", [posting({ ats: "lever", externalId: "a", requisitionId: null })], {
      path,
      now: "2026-09-01T00:00:00.000Z",
    });
    const records = await syncBoard(
      "lever",
      "acme",
      [posting({ ats: "lever", externalId: "b", requisitionId: null })],
      { path, now: "2026-09-05T00:00:00.000Z" },
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].firstSeen, "2026-09-01T00:00:00.000Z");
  }));

test("a posting absent from a later poll is marked removed, once", () =>
  withTempStore(async (path) => {
    await syncBoard("greenhouse", "acme", [posting({ requisitionId: "req-1" })], {
      path,
      now: "2026-09-01T00:00:00.000Z",
    });
    let [record] = await syncBoard("greenhouse", "acme", [], { path, now: "2026-09-02T00:00:00.000Z" });
    assert.equal(record.removedAt, "2026-09-02T00:00:00.000Z");

    [record] = await syncBoard("greenhouse", "acme", [], { path, now: "2026-09-03T00:00:00.000Z" });
    assert.equal(record.removedAt, "2026-09-02T00:00:00.000Z", "removedAt does not keep advancing");
  }));

test("a removed posting reappearing clears removedAt", () =>
  withTempStore(async (path) => {
    await syncBoard("greenhouse", "acme", [posting({ requisitionId: "req-1" })], {
      path,
      now: "2026-09-01T00:00:00.000Z",
    });
    await syncBoard("greenhouse", "acme", [], { path, now: "2026-09-02T00:00:00.000Z" });
    const [record] = await syncBoard("greenhouse", "acme", [posting({ requisitionId: "req-1" })], {
      path,
      now: "2026-09-03T00:00:00.000Z",
    });
    assert.equal(record.removedAt, null);
  }));

test("syncBoard only touches records for the polled board", () =>
  withTempStore(async (path) => {
    await syncBoard("greenhouse", "acme", [posting({ boardToken: "acme", requisitionId: "req-1" })], {
      path,
      now: "2026-09-01T00:00:00.000Z",
    });
    await syncBoard("greenhouse", "other", [posting({ boardToken: "other", requisitionId: "req-2" })], {
      path,
      now: "2026-09-01T00:00:00.000Z",
    });
    await syncBoard("greenhouse", "acme", [], { path, now: "2026-09-02T00:00:00.000Z" });

    const all = await loadStore(path);
    const other = all.find((r) => r.boardToken === "other")!;
    assert.equal(other.removedAt, null, "a different board's records must not be marked removed");
  }));

test("ageDays is queryable per posting", () =>
  withTempStore(async (path) => {
    const [record] = await syncBoard("greenhouse", "acme", [posting({})], { path, now: "2026-09-01T00:00:00.000Z" });
    const now = Date.parse("2026-09-08T00:00:00.000Z");
    assert.equal(ageDays(record, now), 7);
  }));
