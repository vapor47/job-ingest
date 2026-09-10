// ING-1: seed board tokens by slug-guess and probe.
// Two stages, both cached to disk so a re-run does not re-crawl:
//   1. YC directory  -> data/yc-companies.json
//   2. probe          -> data/board-tokens.json
// Usage: node scripts/seed-tokens.ts [--target 300] [--refresh-yc]

import { readFile, writeFile } from "node:fs/promises";

const TARGET = Number(process.argv.includes("--target") ? process.argv[process.argv.indexOf("--target") + 1] : 300);
const CONCURRENCY = 6;
const YC_CACHE = "data/yc-companies.json";
const OUT = "data/board-tokens.json";

const BAY_AREA = [
  "san francisco", "palo alto", "mountain view", "menlo park", "redwood city",
  "sunnyvale", "santa clara", "san jose", "oakland", "berkeley", "san mateo",
  "burlingame", "cupertino", "fremont", "emeryville", "south san francisco",
  "foster city", "los altos", "belmont", "san carlos", "millbrae", "alameda",
  "bay area", "silicon valley",
];

const ATS = {
  greenhouse: (t: string) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
  ashby: (t: string) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
  lever: (t: string) => `https://api.lever.co/v0/postings/${t}?mode=json`,
} as const;

type Ats = keyof typeof ATS;
type Company = { name: string; slug?: string; teamSize?: number; source: "yc" | "curated" };
type Hit = {
  company: string;
  token: string;
  ats: Ats;
  matchKind: string;
  boardName: string | null;
  openJobs: number;
  teamSize: number | null;
  source: string;
};

const stats = {
  probed: 0,
  requests: 0,
  transportErrors: 0,
  byAts: {} as Record<string, number>,
  errorReasons: {} as Record<string, number>,
};

/**
 * Candidate tokens for a company, most-likely first. `kind` is provenance.
 *
 * Only near-verbatim guesses are used. A 200 proves the board exists, not that it
 * belongs to this company: dropping a word ("Rosebud AI" -> "rosebud") matched a hotel
 * group's board, and Ashby and Lever expose no owner name to catch that with. A
 * hyphenated variant scored zero hits across ~640 companies, so it only costs requests.
 */
function slugCandidates(c: Company): { token: string; kind: string }[] {
  const cands = [
    { token: c.slug, kind: "yc-slug" },
    { token: c.name.toLowerCase().replace(/[^a-z0-9]+/g, ""), kind: "exact" },
  ];
  const seen = new Set<string>();
  return cands.filter(
    (c): c is { token: string; kind: string } =>
      !!c.token && c.token.length > 1 && !seen.has(c.token) && seen.add(c.token),
  );
}

async function fetchStatus(url: string): Promise<{ status: number; body: unknown } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      stats.requests++;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12_000),
        headers: { "user-agent": "job-ingest/0.1 (board token seeding)" },
      });
      if (res.status === 429 || res.status >= 500) {
        stats.errorReasons[`http_${res.status}`] = (stats.errorReasons[`http_${res.status}`] ?? 0) + 1;
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return { status: res.status, body: null };
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch (e) {
      const reason = (e as Error)?.name ?? "unknown";
      stats.errorReasons[reason] = (stats.errorReasons[reason] ?? 0) + 1;
      await sleep(500);
    }
  }
  // Retries exhausted: a transport failure is NOT evidence the board is absent.
  stats.transportErrors++;
  return null;
}

function countJobs(body: unknown): number {
  if (Array.isArray(body)) return body.length;
  const jobs = (body as { jobs?: unknown[] })?.jobs;
  return Array.isArray(jobs) ? jobs.length : 0;
}

async function probeCompany(c: Company): Promise<Hit | null> {
  stats.probed++;
  for (const { token, kind } of slugCandidates(c)) {
    for (const ats of Object.keys(ATS) as Ats[]) {
      const res = await fetchStatus(ATS[ats](token));
      if (res?.status === 200) {
        stats.byAts[ats] = (stats.byAts[ats] ?? 0) + 1;
        return {
          company: c.name,
          token,
          ats,
          matchKind: kind,
          boardName: ats === "greenhouse" ? await greenhouseBoardName(token) : null,
          openJobs: countJobs(res.body),
          teamSize: c.teamSize ?? null,
          source: c.source,
        };
      }
    }
  }
  return null;
}

/** Greenhouse is the only one of the three that names the board's owner. */
async function greenhouseBoardName(token: string): Promise<string | null> {
  const res = await fetchStatus(`https://boards-api.greenhouse.io/v1/boards/${token}`);
  return (res?.body as { name?: string })?.name ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadYc(): Promise<Company[]> {
  if (!process.argv.includes("--refresh-yc")) {
    const cached = await readFile(YC_CACHE, "utf8").catch(() => null);
    if (cached) return JSON.parse(cached);
  }
  console.log("Fetching YC directory...");

  // A page that fails silently drops companies from the candidate pool, so retry
  // and count the ones that never came back rather than treating them as empty.
  const failedPages: number[] = [];
  async function page(n: number): Promise<any[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetchStatus(`https://api.ycombinator.com/v0.1/companies?page=${n}`);
      const companies = (res?.body as { companies?: unknown[] })?.companies;
      if (Array.isArray(companies)) return companies;
      await sleep(500 * (attempt + 1));
    }
    failedPages.push(n);
    return [];
  }

  const first = await fetchStatus("https://api.ycombinator.com/v0.1/companies?page=1");
  const pages = (first?.body as { totalPages: number }).totalPages;
  const all = [...((first?.body as { companies: any[] }).companies ?? [])];
  for (let p = 2; p <= pages; p += CONCURRENCY) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pages - p + 1) }, (_, i) => page(p + i)),
    );
    for (const b of batch) all.push(...b);
    process.stdout.write(`\r  page ${Math.min(p + CONCURRENCY - 1, pages)}/${pages}`);
  }
  console.log(`\n  ${all.length} companies`);
  if (failedPages.length) console.log(`  WARNING: ${failedPages.length} pages failed after retries: ${failedPages.join(", ")}`);

  const bay = all
    .filter((c: any) => c.status === "Active" && (c.teamSize ?? 0) >= 10)
    .filter((c: any) =>
      [...(c.locations ?? []), ...(c.regions ?? [])].some((l: string) =>
        BAY_AREA.some((b) => l.toLowerCase().includes(b)),
      ),
    )
    .map((c: any): Company => ({ name: c.name, slug: c.slug, teamSize: c.teamSize, source: "yc" }));

  await writeFile(YC_CACHE, JSON.stringify(bay, null, 2));
  console.log(`  ${bay.length} Bay Area, active, team >= 10`);
  return bay;
}

async function loadCurated(): Promise<Company[]> {
  const txt = await readFile("data/bay-area-companies.txt", "utf8");
  return txt
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((name): Company => ({ name, source: "curated" }));
}

async function main() {
  // Curated first: known-good names verify the probe before the long YC tail.
  const companies = [...(await loadCurated()), ...(await loadYc())];
  const seen = new Set<string>();
  const queue = companies.filter((c) => !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()));
  console.log(`Probing up to ${queue.length} companies for ${TARGET} tokens...\n`);

  // Snapshot before any concurrency starts; a per-call diff races across workers.
  const directoryRequests = stats.requests;

  const hits: Hit[] = [];
  const tokensSeen = new Set<string>();
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length && hits.length < TARGET) {
      const c = queue[cursor++];
      const hit = await probeCompany(c);
      if (hit && !tokensSeen.has(`${hit.ats}:${hit.token}`)) {
        tokensSeen.add(`${hit.ats}:${hit.token}`);
        hits.push(hit);
        process.stdout.write(`\r  ${hits.length}/${TARGET} confirmed (${stats.probed} probed, ${stats.requests} requests)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const bySource = (s: string) => {
    const probed = queue.slice(0, cursor).filter((c) => c.source === s).length;
    const found = hits.filter((h) => h.source === s).length;
    return { probed, found, hitRate: probed ? +(found / probed).toFixed(3) : 0 };
  };

  const report = {
    generatedAt: new Date().toISOString(),
    hitRate: {
      overall: +(hits.length / stats.probed).toFixed(3),
      curated: bySource("curated"),
      yc: bySource("yc"),
      byAts: stats.byAts,
      byMatchKind: hits.reduce<Record<string, number>>((a, h) => ((a[h.matchKind] = (a[h.matchKind] ?? 0) + 1), a), {}),
      companiesProbed: stats.probed,
      probeRequests: stats.requests - directoryRequests,
      transportErrors: stats.transportErrors,
      errorReasons: stats.errorReasons,
    },
    tokens: hits.sort((a, b) => a.company.localeCompare(b.company)),
  };
  await writeFile(OUT, JSON.stringify(report, null, 2));

  console.log(`\n\nConfirmed ${hits.length} tokens -> ${OUT}`);
  console.table(report.hitRate.byAts);
  console.log(
    `hit rate: overall ${report.hitRate.overall} | curated ${bySource("curated").hitRate} | yc ${bySource("yc").hitRate}`,
  );
  if (stats.transportErrors) console.log(`WARNING: ${stats.transportErrors} transport errors — those companies are unproven, not rejected.`);
}

main();
