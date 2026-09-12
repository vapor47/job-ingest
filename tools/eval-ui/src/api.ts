import type { PoolRecord, LocationMatch, AddLocationResult, TitleNode, StackNode } from "./types.ts";

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

export async function searchLocations(q: string): Promise<LocationMatch[]> {
  if (!q.trim()) return [];
  const res = await fetch(`/api/locations?q=${encodeURIComponent(q)}`);
  return res.json();
}

export async function addLocation(name: string): Promise<AddLocationResult> {
  const res = await fetch("/api/locations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function searchTitles(q: string): Promise<TitleNode[]> {
  if (!q.trim()) return [];
  const res = await fetch(`/api/titles?q=${encodeURIComponent(q)}`);
  return res.json();
}

export async function addTitle(name: string): Promise<TitleNode> {
  const res = await fetch("/api/titles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function searchStack(q: string): Promise<StackNode[]> {
  if (!q.trim()) return [];
  const res = await fetch(`/api/stack?q=${encodeURIComponent(q)}`);
  return res.json();
}

export async function addStack(name: string): Promise<StackNode> {
  const res = await fetch("/api/stack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}
