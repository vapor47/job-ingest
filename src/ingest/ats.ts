// ING-2: one poller per ATS behind `fetchBoard(token, ats) -> RawPosting[]`.
// A fourth ATS is one entry in POLLERS.
//
// None of these endpoints can search or filter: you poll the whole board and filter
// locally. Responses are cached to disk so a re-poll inside the TTL costs nothing.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { ATS_SOURCES, type Ats, type RawPosting } from "../schema/job-posting.ts";

const UA = "job-ingest/0.1 (job board poller)";
const CACHE_DIR = "data/cache";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type Poller = {
  url: (token: string) => string;
  jobs: (body: any) => any[];
  map: (job: any, token: string) => Omit<RawPosting, "fetchedAt">;
};

const POLLERS: Record<Ats, Poller> = {
  greenhouse: {
    // ?content=true is what carries the description; without it you get titles only.
    url: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`,
    jobs: (b) => b?.jobs ?? [],
    map: (j, token) => ({
      ats: "greenhouse",
      boardToken: token,
      externalId: String(j.id),
      url: j.absolute_url,
      title: j.title,
      company: j.company_name ?? null,
      location: j.location?.name ?? null,
      department: j.departments?.[0]?.name ?? null,
      employmentTypeRaw: null,
      publishedAt: j.first_published ?? j.updated_at ?? null,
      // `content` arrives entity-escaped, so it is HTML twice over: decode, then strip.
      description: htmlToText(decodeEntities(j.content ?? "")),
      raw: j,
    }),
  },

  lever: {
    url: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    jobs: (b) => (Array.isArray(b) ? b : []),
    map: (j, token) => ({
      ats: "lever",
      boardToken: token,
      externalId: String(j.id),
      url: j.hostedUrl,
      title: j.text,
      company: null,
      location: j.categories?.location ?? null,
      department: j.categories?.department ?? null,
      employmentTypeRaw: j.categories?.commitment ?? null,
      // Lever publishes no updated timestamp, only createdAt (epoch ms).
      publishedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      description: leverText(j),
      raw: j,
    }),
  },

  ashby: {
    url: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`,
    // isListed false means pulled from the public board; it is not open to applicants.
    jobs: (b) => (b?.jobs ?? []).filter((j: any) => j.isListed !== false),
    map: (j, token) => ({
      ats: "ashby",
      boardToken: token,
      externalId: String(j.id),
      url: j.jobUrl,
      title: j.title,
      company: null,
      location: j.location ?? null,
      department: j.department ?? null,
      employmentTypeRaw: j.employmentType ?? null,
      publishedAt: j.publishedAt ?? null,
      description: j.descriptionPlain ?? "",
      raw: j,
    }),
  },
};

/**
 * Lever splits a posting across fields. `description` is the intro only — Requirements
 * and Nice-to-have live in `lists`, which is where stack and comp language actually is.
 * Concatenating is not cosmetic: skip it and extraction loses most of what it reads.
 */
function leverText(j: any): string {
  return [
    j.descriptionPlain ?? "",
    ...(j.lists ?? []).map((l: any) => `${l.text ?? ""}\n${htmlToText(l.content ?? "")}`),
    j.additionalPlain ?? "",
  ]
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return NAMED[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

// ponytail: regex de-HTML, not a parser. ATS description fields are well-formed fragments,
// and only Greenhouse and Lever's list blocks need it. Swap in a parser if a board ever
// ships layout tables whose structure carries meaning.
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<\/(p|div|li|h[1-6]|tr)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries 429/5xx and transport errors; any other non-200 is the board's answer. */
async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(20_000),
    }).catch((e: Error) => e);

    const retryable = res instanceof Error || res.status === 429 || res.status >= 500;
    if (!retryable) {
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.json();
    }
    if (attempt >= 2) throw res instanceof Error ? res : new Error(`HTTP ${res.status} for ${url}`);
    await sleep(1000 * 2 ** attempt);
  }
}

/**
 * Every published posting on one board. An empty board is a valid result — 29 of the 301
 * seeded tokens are live with zero openings — so callers must not read `[]` as a failure.
 * A dead token throws (`HTTP 404`).
 *
 * The cache stores the untouched response, so re-mapping after a parser change is free.
 */
export async function fetchBoard(
  token: string,
  ats: Ats,
  { ttlMs = CACHE_TTL_MS }: { ttlMs?: number } = {},
): Promise<RawPosting[]> {
  const poller = POLLERS[ats];
  if (!poller) throw new Error(`unknown ats: ${ats}`);

  const safe = encodeURIComponent(token);
  const file = `${CACHE_DIR}/${ats}-${safe}.json`;
  const cached = await readFile(file, "utf8")
    .then((s) => JSON.parse(s) as { fetchedAt: string; body: unknown })
    .catch(() => null);

  let entry = cached;
  if (!entry || Date.now() - Date.parse(entry.fetchedAt) > ttlMs) {
    entry = { fetchedAt: new Date().toISOString(), body: await fetchJson(poller.url(safe)) };
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(entry));
  }

  return poller.jobs(entry.body).map((j) => ({ ...poller.map(j, token), fetchedAt: entry!.fetchedAt }));
}

export { ATS_SOURCES };
