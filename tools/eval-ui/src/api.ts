import type { PoolRecord, LocationNode } from "./types.ts";

export async function getPool(): Promise<PoolRecord[]> {
  const res = await fetch("/api/pool");
  return res.json();
}

export async function saveRecord(index: number, record: PoolRecord): Promise<void> {
  await fetch(`/api/pool/${index}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
}

export async function searchLocations(q: string): Promise<LocationNode[]> {
  if (!q.trim()) return [];
  const res = await fetch(`/api/locations?q=${encodeURIComponent(q)}`);
  return res.json();
}

export async function addLocation(name: string): Promise<LocationNode> {
  const res = await fetch("/api/locations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}
