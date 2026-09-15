# Dev-split labeling review queue

Generated from `data/eval/pool.jsonl` vs run `job-posting-v1_claude-opus-5_ca21ea12` (dev split, n=58). Four issue buckets surfaced by the eval; each is a candidate for a human relabel pass, not a model/prompt bug. Re-run `scripts/metrics.ts` after any relabeling to see the delta.

Buckets 2, 3, and 4 below are resolved — by a rubric/prompt fix, a scoring fix, and a manual relabel pass respectively, none of which required editing `data/eval/pool.jsonl`. Tables are kept as the historical record of what was flagged. Bucket 1 is still open. Mark a bucket's status here (and remove it from `tools/eval-ui/src/review-queue.ts`'s live filter) as each is closed.

## 1. jobFunction stale (31 records)

`jobFunction: engineering` in truth, but every other field is null. Two possible causes, worth distinguishing per record: (a) the record was behaviorally treated as non-engineering during labeling — per the rubric's own instruction to blank non-eng records — but `jobFunction` itself was never corrected off the pre-classification heuristic, or (b) the record simply hasn't been fully labeled yet. Some titles here read as clearly real engineering roles ("Senior Android Engineer, In-Car Experience"), which points more toward (b) for those. Only records with a `non-eng` flag were caught as (a); the rest need a human look to tell which case applies.

| id | title | flagged |
|---|---|---|
| ashby:benchling:8f47c31f-4fd1-4108-92c0-98fc85feb7b0 | Enterprise Solutions Architect |  |
| ashby:corvus-robotics:a23176d1-2553-4c03-bf0d-897a40dd54d5 | QA Manager |  |
| ashby:cursor:c43bdded-80a1-4705-a0ec-8217d771528c | Data Analyst, User Operations |  |
| ashby:openai:0fc4742f-21f9-40a3-925e-adeb0a6920c1 | Training - Runtime Foundations Engineer | non-eng |
| ashby:openai:d333c117-9b74-488d-a985-7b78d1a19947 | Security Operations Manager, Paris | non-eng |
| ashby:snowflake:9d538c1b-16fa-4d21-8549-d1d1993aa201 | Senior AI/ML Architect, Applied Field Engineering |  |
| ashby:snowflake:da8298e6-c9e1-4d12-8af2-2405ba766602 | Solutions Engineer |  |
| ashby:snowflake:f54c4a92-d26a-481a-a694-d69dc1dcc514 | Sr. Technical Architect |  |
| ashby:vanta:2daebe8c-69af-44f3-a81f-38fb17da30a0 | Manager, Solutions Engineering - EMEA | non-eng |
| ashby:vapi:0d4f1420-2590-4a38-aac4-3efda12eadb0 | Member of Technical Staff, Agentic Developer Experience |  |
| greenhouse:anthropic:5383335008 | Applied AI Architect, Enterprise Tech |  |
| greenhouse:cloudflare:8082834 | Senior Customer Engineer, Named - Charlotte, NC |  |
| greenhouse:databricks:8397493002 | Sr. Solutions Architect - Public Sector (SLED)  |  |
| greenhouse:databricks:8441894002 | Delivery Solutions Architect |  |
| greenhouse:databricks:8524420002 | Sr Staff Product Operations Manager | non-eng |
| greenhouse:databricks:8657553002 | Infrastructure & Platform Senior Specialist Solutions Engineer |  |
| greenhouse:databricks:8687483002 | Delivery Solutions Architect - Oil & Gas | non-eng |
| greenhouse:databricks:8704938002 | Senior Solutions Architect (EDW Enterprise Data Warehouse Migrations) |  |
| greenhouse:databricks:8785045002 | Sr. Solutions Architect |  |
| greenhouse:elastic:8067193 | Senior Solution Architect - Enterprise  |  |
| greenhouse:gitlab:8742716002 | Customer Success Architect | non-eng |
| greenhouse:hightouch:5762547004 | Deployment Architect |  |
| greenhouse:mongodb:8050412 | Senior Solutions Architect (Pre-Sales) |  |
| greenhouse:mongodb:8163002 | Senior Engineering Manager, Storage Execution |  |
| greenhouse:nuro:6121565 | Senior/Staff Machine Learning Research Scientist: Generative Modeling for Planning |  |
| greenhouse:stripe:7737248 | Technical Support Engineer (EMEA), Metronome |  |
| greenhouse:stripe:7983856 | Product Manager, Treasury for Platforms | non-eng |
| greenhouse:stripe:8121659 | Account Executive, Platforms Hunter (Central Eastern Europe) | non-eng |
| greenhouse:waymo:7484282 | Senior Android Engineer, In-Car Experience |  |
| lever:zoox:d9496a78-88b3-4c62-bea2-0eb61288aa9c | Senior/Staff Technical Program Manager - Compute Hardware |  |
| lever:zoox:f93c451d-b9b0-4480-ad7e-4c4d410e4100 | Senior/Staff Technical Program Manager - Artificial Intelligence | non-eng |

## 2. employmentType unsupported (20 records)

**Status: resolved 2026-09-15.** The rubric and extraction prompt now default `employmentType` to `full_time` when unstated (`docs/labeling-rubric.md`, `scripts/extract.ts`) — `internship`/`contract`/`part_time` still require an explicit statement, description-level derivation, or an hourly rate. Truth's `full_time` entries below were correct under the new rule all along; no relabeling needed.

Truth states an `employmentType` (almost always `full_time`) with no explicit statement found anywhere in the posting text — contradicts the rubric's own rule ("From an explicit statement only. Silence is null"). Looks like the labeler defaulted to `full_time` for standard corporate postings. Either relabel to `null` per the existing rule, or change the rubric to allow a `full_time` default and update the extraction prompt to match.

| id | title | truth value |
|---|---|---|
| ashby:aiprise:3763c791-a387-4078-9ca4-00cbfbf9b1a6 | Software Engineer I (Bangalore, India) | full_time |
| ashby:harvey:e2976ecf-f785-4524-8545-bbd519ffdaae | Engineering Manager, Enterprise | full_time |
| ashby:middesk:aed2c535-cd58-4920-9618-a0cbbb62851e | Software Engineer, Infrastructure  | full_time |
| ashby:openai:04435c05-7a05-4802-894d-c173327fbac8 | Applied AI Engineer | full_time |
| ashby:snowflake:97813cac-e55c-4631-94fe-5eda15c7eaed | Senior Forward Deployed Engineer | full_time |
| ashby:supabase:06752423-eebb-472c-95b5-c7ff2559fd60 | Software Engineer - Branching | full_time |
| ashby:vanta:87d75493-1d6e-490e-b5ac-d807f5fb5621 | Staff Software Engineer, Foundations Data Platform | full_time |
| greenhouse:anthropic:5182605008 | Data Scientist, Product | full_time |
| greenhouse:anthropic:5231496008 | Staff + Sr. Software Engineer, Cloud Inference | full_time |
| greenhouse:brex:8605070002 |  Senior Software Engineer, Data Enablement Platform | full_time |
| greenhouse:databricks:8220814002 | Sr Software Engineer, Agentic Applications | full_time |
| greenhouse:databricks:8635188002 | Staff Software Engineer, AI Native Web Platform | full_time |
| greenhouse:databricks:8656900002 | Senior Applied ML Engineer - ML4Sys  | full_time |
| greenhouse:databricks:8788266002 | Solutions Architect - Hunter (Communications, Media, Entertainment and Games) | full_time |
| greenhouse:grafanalabs:6112827004 | Staff Software Engineer - Databases, Tempo | Sweden | Remote | full_time |
| greenhouse:mongodb:7742875 | Senior Python Engineer | full_time |
| greenhouse:sigmacomputing:7767727003 | Senior AI/ML Engineer | full_time |
| greenhouse:twilio:8007449 | Senior/Staff Applied Research Software Engineer | full_time |
| greenhouse:vercel:5474915004 | Software Engineer, AI SDK | full_time |
| greenhouse:vercel:5732855004 | Site Engineer | full_time |

## 3. locationGeo format inconsistent (25 records)

**Status: resolved 2026-09-15.** `scripts/metrics.ts` now resolves both truth and prediction through the location library at scoring time (`scripts/library-resolve.ts`, commit 5eb7e11), so a bare truth value like "San Francisco" and a formatted prediction like "San Francisco, CA" match. No relabeling of truth needed; a genuine (non-format) mismatch on any of these records would still score as a miss.

Truth uses a bare city name (e.g. "San Francisco") instead of the rubric's own documented format `City, ST` / `City, Country`. The extraction prompt correctly follows the documented format, so these records score 0 precision/recall even when the model is substantively correct.

| id | title | truth value |
|---|---|---|
| ashby:aiprise:3763c791-a387-4078-9ca4-00cbfbf9b1a6 | Software Engineer I (Bangalore, India) | ["Bengaluru"] |
| ashby:harvey:e2976ecf-f785-4524-8545-bbd519ffdaae | Engineering Manager, Enterprise | ["Toronto"] |
| ashby:middesk:aed2c535-cd58-4920-9618-a0cbbb62851e | Software Engineer, Infrastructure  | ["San Francisco"] |
| ashby:openai:04435c05-7a05-4802-894d-c173327fbac8 | Applied AI Engineer | ["Seoul"] |
| ashby:openai:577e6673-0a4a-491b-9a0d-facbdd3bdf3c | Applied AI Engineer, Codex Core Agent | ["San Francisco","London","New York City","Seattle"] |
| ashby:skydio:617d889f-1dcc-422e-a186-a04d495ae739 | Senior Software Engineer, Developer Productivity | ["San Mateo"] |
| ashby:snowflake:97813cac-e55c-4631-94fe-5eda15c7eaed | Senior Forward Deployed Engineer | ["San Francisco Bay Area","Menlo Park","Bellevue"] |
| ashby:supabase:06752423-eebb-472c-95b5-c7ff2559fd60 | Software Engineer - Branching | ["Remote — Global"] |
| ashby:vanta:87d75493-1d6e-490e-b5ac-d807f5fb5621 | Staff Software Engineer, Foundations Data Platform | ["Remote - United States"] |
| greenhouse:anthropic:5182605008 | Data Scientist, Product | ["New York City","San Francisco","Seattle"] |
| greenhouse:anthropic:5231496008 | Staff + Sr. Software Engineer, Cloud Inference | ["San Francisco"] |
| greenhouse:brex:8605070002 |  Senior Software Engineer, Data Enablement Platform | ["San Francisco"] |
| greenhouse:chime:8573625002 | Software Engineer, Infrastructure | ["Chicago","New York City","San Francisco"] |
| greenhouse:databricks:8220814002 | Sr Software Engineer, Agentic Applications | ["Mountain View"] |
| greenhouse:databricks:8635188002 | Staff Software Engineer, AI Native Web Platform | ["Mountain View"] |
| greenhouse:databricks:8656900002 | Senior Applied ML Engineer - ML4Sys  | ["San Francisco"] |
| greenhouse:databricks:8788266002 | Solutions Architect - Hunter (Communications, Media, Entertainment and Games) | ["United States"] |
| greenhouse:gitlab:8688078002 | Intermediate Software Engineer, Security Factory: Vulnerability Management  | ["Remote — United Kingdom","Remote — Canada"] |
| greenhouse:mongodb:7742875 | Senior Python Engineer | ["United States"] |
| greenhouse:nuro:8161813 | Senior/Staff Systems Engineer, Platform Systems | ["Mountain View"] |
| greenhouse:samsara:7431070 | Staff Machine Learning Engineer - Edge AI | ["Remote — Canada"] |
| greenhouse:sigmacomputing:7767727003 | Senior AI/ML Engineer | ["San Francisco"] |
| greenhouse:twilio:8007449 | Senior/Staff Applied Research Software Engineer | ["Remote — India"] |
| greenhouse:vercel:5474915004 | Software Engineer, AI SDK | ["San Francisco","New York City"] |
| greenhouse:vercel:5732855004 | Site Engineer | ["Remote — United States"] |

## 4. stack likely under-labeled (9 records)

**Status: resolved 2026-09-15.** Manually relabeled.

Model predicted 3+ named technologies beyond what truth captured. Spot-checked examples confirmed the extras are real, named techs in the posting text (e.g. an explicit "Our stack" section) that truth simply missed — not model hallucination. Worth a second pass against the source text; not all flagged records will turn out under-labeled, this is a candidate list based on prediction-vs-truth delta size, not a confirmed diagnosis per record.

| id | title | truth stack | model's extra items |
|---|---|---|---|
| ashby:linear:069c4628-88d7-4e4d-b393-c996fc7f3076 | Senior / Staff Product Engineer | ["React","TypeScript"] | ["Node","GraphQL","PostgreSQL","MobX","styled-components","Temporal","Redis","Google Cloud","Kubernetes","GitHub","Slack","Notion","WebSocket"] |
| ashby:snowflake:97813cac-e55c-4631-94fe-5eda15c7eaed | Senior Forward Deployed Engineer | ["SQL"] | ["Snowflake","Spark","Python","Go","Java","C++","AWS","Azure","GCP"] |
| ashby:supabase:06752423-eebb-472c-95b5-c7ff2559fd60 | Software Engineer - Branching | ["Go","TypeScript","AWS"] | ["Postgres","EKS","ECS","Terraform","Pulumi","JSON","TOML","Git"] |
| ashby:vanta:87d75493-1d6e-490e-b5ac-d807f5fb5621 | Staff Software Engineer, Foundations Data Platform | ["TypeScript","Node.js","Kafka","PostgreSQL","MongoDB","AWS"] | ["Postgres","S3","Redis","Node"] |
| greenhouse:chime:8573625002 | Software Engineer, Infrastructure | ["DynamoDB","RDS","Terraform","Kubernetes","AWS","Python"] | ["Airflow","Flink","chalk.ai"] |
| greenhouse:databricks:8220814002 | Sr Software Engineer, Agentic Applications | ["HTML","CSS","JavaScript"] | ["React","Angular","Vue.js","Ember","SQL"] |
| greenhouse:grafanalabs:6112827004 | Staff Software Engineer - Databases, Tempo | Sweden | Remote | ["Go","OpenTelemetry","SQL"] | ["Rust","C","C++","Parquet","Kubernetes","Grafana","Prometheus","Loki","Tempo","TraceQL"] |
| greenhouse:mongodb:7742875 | Senior Python Engineer | ["Python","AI/ML"] | ["MongoDB","PyMongo","Django","PyMongoArrow","LangChain","GitHub"] |
| greenhouse:vercel:5732855004 | Site Engineer | ["Next.js","SEO","Tailwind CSS"] | ["React","JavaScript","Vercel"] |

