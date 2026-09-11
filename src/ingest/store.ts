// ING-3: persists postings across polls with first_seen/last_seen/removed_at,
// deduplicating reposts so the eval split isn't stuffed with near-identical reqs.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { Ats, RawPosting } from "../schema/job-posting.ts";

const STORE_PATH = "data/store.json";
const DAY_MS = 24 * 60 * 60 * 1000;

export type StoredPosting = RawPosting & {
  dedupKey: string;
  firstSeen: string;
  lastSeen: string;
  removedAt: string | null;
};

type Store = Record<string, StoredPosting>;

/**
 * Greenhouse's requisition_id survives a repost under a new `id`; Lever and Ashby expose
 * no such field, so a content hash is the only way to catch their reposts. Scoped to the
 * board token — the same hash on a different company's board is coincidence, not a repost.
 */
function dedupKey(p: RawPosting): string {
  if (p.requisitionId) return `${p.ats}:${p.boardToken}:req:${p.requisitionId}`;
  const content = `${p.title}|${p.location ?? ""}|${p.description}`.trim().toLowerCase();
  const hash = createHash("sha1").update(content).digest("hex");
  return `${p.ats}:${p.boardToken}:hash:${hash}`;
}

async function load(path: string): Promise<Store> {
  return readFile(path, "utf8")
    .then((s) => JSON.parse(s) as Store)
    .catch(() => ({}));
}

async function save(path: string, store: Store): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2));
}

/**
 * Merges one board's current postings into the store. A new dedup key is inserted with
 * firstSeen = lastSeen = now. A key seen before gets lastSeen bumped and removedAt cleared
 * (a pulled posting can reappear). A key that belongs to this board but wasn't in this
 * poll's results gets removedAt stamped, once — later polls don't keep bumping it.
 */
export async function syncBoard(
  ats: Ats,
  boardToken: string,
  postings: RawPosting[],
  { path = STORE_PATH, now = new Date().toISOString() }: { path?: string; now?: string } = {},
): Promise<StoredPosting[]> {
  const store = await load(path);
  const seenKeys = new Set<string>();

  for (const p of postings) {
    const key = dedupKey(p);
    seenKeys.add(key);
    const existing = store[key];
    store[key] = { ...p, dedupKey: key, firstSeen: existing?.firstSeen ?? now, lastSeen: now, removedAt: null };
  }

  for (const record of Object.values(store)) {
    if (record.ats === ats && record.boardToken === boardToken && !seenKeys.has(record.dedupKey) && !record.removedAt) {
      record.removedAt = now;
    }
  }

  await save(path, store);
  return Object.values(store).filter((r) => r.ats === ats && r.boardToken === boardToken);
}

export function ageDays(record: StoredPosting, now: number = Date.now()): number {
  return Math.floor((now - Date.parse(record.firstSeen)) / DAY_MS);
}

export async function loadStore(path: string = STORE_PATH): Promise<StoredPosting[]> {
  return Object.values(await load(path));
}
