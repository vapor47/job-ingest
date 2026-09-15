// Snapshot of data/eval/labeling-review-queue.md's still-open buckets, as id lists for the UI's
// queue filter. Static rather than derived live: the original bucket also depended on a specific
// predictions run (data/eval/predictions/*_ca21ea12_*), which isn't loaded into this app.
// Buckets 2 (employmentType unsupported), 3 (locationGeo format), and 4 (stack under-labeled) are
// resolved (see labeling-review-queue.md) and removed from here — drop a bucket's entry the same
// way once it's resolved, rather than leaving a closed bucket selectable in the filter.
export type QueueKey = "all" | "jobFunctionStale";

export const REVIEW_QUEUES: Record<Exclude<QueueKey, "all">, { label: string; ids: string[] }> = {
  jobFunctionStale: {
    label: "jobFunction stale",
    ids: [
      "ashby:benchling:8f47c31f-4fd1-4108-92c0-98fc85feb7b0",
      "ashby:corvus-robotics:a23176d1-2553-4c03-bf0d-897a40dd54d5",
      "ashby:cursor:c43bdded-80a1-4705-a0ec-8217d771528c",
      "ashby:openai:0fc4742f-21f9-40a3-925e-adeb0a6920c1",
      "ashby:openai:d333c117-9b74-488d-a985-7b78d1a19947",
      "ashby:snowflake:9d538c1b-16fa-4d21-8549-d1d1993aa201",
      "ashby:snowflake:da8298e6-c9e1-4d12-8af2-2405ba766602",
      "ashby:snowflake:f54c4a92-d26a-481a-a694-d69dc1dcc514",
      "ashby:vanta:2daebe8c-69af-44f3-a81f-38fb17da30a0",
      "ashby:vapi:0d4f1420-2590-4a38-aac4-3efda12eadb0",
      "greenhouse:anthropic:5383335008",
      "greenhouse:cloudflare:8082834",
      "greenhouse:databricks:8397493002",
      "greenhouse:databricks:8441894002",
      "greenhouse:databricks:8524420002",
      "greenhouse:databricks:8657553002",
      "greenhouse:databricks:8687483002",
      "greenhouse:databricks:8704938002",
      "greenhouse:databricks:8785045002",
      "greenhouse:elastic:8067193",
      "greenhouse:gitlab:8742716002",
      "greenhouse:hightouch:5762547004",
      "greenhouse:mongodb:8050412",
      "greenhouse:mongodb:8163002",
      "greenhouse:nuro:6121565",
      "greenhouse:stripe:7737248",
      "greenhouse:stripe:7983856",
      "greenhouse:stripe:8121659",
      "greenhouse:waymo:7484282",
      "lever:zoox:d9496a78-88b3-4c62-bea2-0eb61288aa9c",
      "lever:zoox:f93c451d-b9b0-4480-ad7e-4c4d410e4100",
    ],
  },
};
