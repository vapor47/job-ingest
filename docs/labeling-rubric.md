# Labeling rubric

Ground-truth rules for hand-labeling postings against the `jobPostingSchema` contract in
`src/schema/job-posting.ts`. Field names below are the schema keys (camelCase).

Every rule here exists to make two labelers — or the same labeler on hour 1 and hour 4 —
produce the same record. Ambiguity in this doc shows up later as measurement noise and
gets mistaken for model error.

## Global rules

1. **Label from the posting text only.** No company knowledge, no web lookup, no inference
   from the employer's reputation.
2. **`null` means "the posting does not say".** It is a correct answer, not a failure, and
   it is the single most common right answer. Never guess a value to avoid a null.
3. **Never infer one field from another.** A React role does not imply `JavaScript`. An
   office address does not imply `onsite`.
4. **When rules collide**, the field's tie-break rule wins. If still tied, record `null`.
5. **Label the requisition as written**, even where it is plainly boilerplate or wrong.
6. **If a case is not covered here, add a rule to this doc** before labeling it. Do not
   decide it ad hoc — that is exactly the drift this rubric exists to prevent.

## Nulls: correct, missed, and invented

`null` is the right **label** whenever the posting does not state a value — that rule does not
bend, and the labeler never infers to avoid one. But a null in the *output* is not
automatically acceptable, and the eval must tell these cases apart per field:

| Ground truth | Extracted | Meaning | Target |
|---|---|---|---|
| value | value | correct | maximize |
| value | `null` | **missed** — the posting said it, extraction did not find it | drive to zero |
| `null` | value | **invented** — extraction made it up | drive to zero |
| `null` | `null` | correct null — the posting is silent | not a defect |

Only the middle two are model errors, and both are derivable at eval time without any extra
labeling work.

Correct nulls are a **coverage ceiling** set by the source. If 40% of postings never state
seniority, no prompt can push seniority coverage past 60% without fabricating. Raising that
ceiling is a source-side change — ATS metadata, a second field, a different board — never a
prompt change. Reporting the ceiling alongside accuracy is what keeps the two from being
confused.

So *"no critical field left null"* is a target against **missed** nulls and against the
coverage ceiling. It is never a licence for the model to guess.

**Critical fields** are the ones a real filter reads, where a null costs the user a usable
result: `seniority`, `locationPolicy`, `compMin`/`compMax`. This set is defined
by EVAL-5 (JOS-56) and drives its decision-usable rate — keep the two in sync.

`sponsorship` is dropped from the schema for now — it was almost never stated on postings,
so the field wasn't earning its keep pre-MVP. Revisit post-MVP if a source with better
sponsorship coverage shows up.

### Labeler flags

When you hesitate on a field — the rubric does not cleanly decide it, or the posting is
genuinely ambiguous — record a flag on that record naming the field and the reason. An
early-stage startup posting with no level word is the canonical case: levels often genuinely
aren't set yet at that stage, so the default-to-`mid` rule may not apply — use judgment and
**flag it** either way. Most records get no flags.

Flags are not labels. They do two jobs:

- mark rubric gaps to fix before the next labeling pass
- identify postings where a model disagreement may be legitimate rather than wrong

## Resolved cases

| Case | Answer |
|---|---|
| Is "Software Engineer II" mid or junior? | `mid`. Numeric ladders map I→`junior`, II→`mid`, III+→`senior`. |
| "Senior / Staff Engineer" | `["senior", "staff"]`. Every named level is recorded — collapsing to one would wrongly exclude the posting from a level-specific search. |
| "$180,000 - $220,000 + equity" | `compMax` = `220000`. Base cash only; equity, bonus and signing are excluded. |
| Posting lists 4 offices | All four, in `locationGeo`. It is an array field for this reason. |
| Hourly contract rate | Annualize at 2080 hours. `employmentType` = `contract` marks it as derived. |
| Requires in-office presence, cadence unstated | `["in_person"]`. Candidates search remote vs. in-person first; that's a real answer, not a null. |
| "Remote or onsite in SF" | `["remote", "onsite"]`. Array field for the same reason as `seniority`. |
| Bare "Software Engineer", no level word | `["mid"]`. See `seniority`'s tie-break for the early-stage-startup exception. |
| US posting, no currency stated but comp given | `USD`. Canada → `CAD`. See `compCurrency`'s tie-break. |

## Per-field rules

### `title` (string, required)

- **Rule:** Copy the board's public title verbatim. No cleanup, no case normalization, no
  stripping of req IDs or location suffixes. This field is copied, not extracted.
- **Tie-break:** If the ATS exposes more than one title field, use the one rendered on the
  public board.

### `titleCanonical` (string, nullable, growable library)

- **Rule:** Assign the role to its canonical bucket (e.g. "Machine Learning Engineer") from the
  library at `data/titles/canonical-titles.json`, searchable in the labeling tool's title field.
  If an existing entry fits, use it — do not create a near-duplicate ("ML Engineer" vs "Machine
  Learning Engineer"). Only add a new entry when the role genuinely isn't covered.
- **Vocabulary lock:** A new canonical title is not added silently. Flag the record naming the
  proposed title and let a human confirm it's genuinely new (vs. an existing entry it should map
  to instead) before it's added to the library. This is forward guidance for any automated
  extraction — the human labeling flow's existing "add new" UI click already satisfies it.
- **Tie-break:** The bucket is level-agnostic — never fold seniority into it; that is
  `seniority`'s job. A title naming multiple disciplines ("Software Engineer, Data & Infra")
  picks the primary/first-listed one. If the title is too vague to bucket (e.g. a bare
  "Member of Technical Staff" with no domain), `null` and flag it.

### `jobFunction` (enum, nullable, growable)

- **Rule:** `engineering` if the role is a software/infrastructure/data engineering role. Every
  other function is `null` for now — EVAL-1's first labeling pass is scoped to engineering
  roles only (see JOS-52 follow-up). `null` means "not in scope yet", not "confirmed
  non-engineering"; more values get added here as later passes bring other functions in.
  Pool records are pre-classified by a department/title heuristic (`build-eval-pool.ts`) —
  check it while labeling and correct it if wrong, the same as any other pre-filled field.
- **Tie-break:** If the heuristic and your own read of the title/description disagree, trust
  your read. **Only label the rest of the fields below for records where this is
  `engineering`** — leave every other field `null` on non-engineering records for this pass,
  even where the posting states values that would otherwise be labelable.

### `seniority` (enum[], nullable)

- **Rule:** Take the level(s) from the **title**. If the title carries no level word, fall to an
  explicit level statement in the body. If neither states a level, `null`. It is an array
  because a posting can name more than one level — a single value would wrongly exclude the
  posting from a level-specific search (e.g. a Staff-only search should still see "Senior/Staff").

  | Signal | Value |
  |---|---|
  | Intern, Internship, Co-op | `["intern"]` |
  | I, Associate, Entry, Junior, New Grad | `["junior"]` |
  | II, Mid, Mid-level | `["mid"]` |
  | III, Senior, Sr., Lead | `["senior"]` |
  | Staff, Senior Staff | `["staff"]` |
  | Principal, Distinguished, Fellow | `["principal"]` |

- **Tie-break:** A named range or pair lists every level it spans, in ladder order
  ("Senior/Staff" → `["senior", "staff"]`, "Software Engineer I-V" → `["junior", "mid",
  "senior", "staff", "principal"]`). An unbounded posting ("All Levels", "Software Engineer,
  any level") lists every value in `SENIORITY`. A bare "Software Engineer" with no modifier
  defaults to `["mid"]` — that's the modal level for an unqualified title. **Exception:**
  early-stage startups often haven't set levels at all yet, so the default may not hold there;
  use judgment and flag it rather than applying the default blindly. Management titles
  (Manager, Director, VP) are `null` — the IC ladder does not apply to them.

### `locationPolicy` (enum[]: remote | in_person | hybrid | onsite, nullable)

- **Rule:** Candidates mostly search remote vs. in-person first — hybrid and onsite are
  subcategories of in-person, not the primary axis. `["remote"]` if the role may be performed
  fully remotely. `["in_person"]` if the posting clearly requires some in-office presence but
  doesn't say whether it's every day or some days. `["hybrid"]` only when a partial cadence is
  stated. `["onsite"]` only when full-time presence is stated. It is an array field: a posting
  offering a genuine choice ("Remote or onsite in SF") records `["remote", "onsite"]` — picking
  one would wrongly exclude it from whichever the candidate didn't search for.
- **Tie-break:** A city name alone is a location, not a policy — `null`. Vague flexibility
  language ("remote-friendly", "flexible") with no stated cadence is `null`. "Remote (US)"
  is `["remote"]` with the region recorded in `locationGeo`, not `hybrid`. Never pick `hybrid`
  or `onsite` on a guess when only `in_person` is actually supported by the text.

### `locationGeo` (string[], nullable)

- **Rule:** Record every place the role may be based, normalized to `City, ST` for the US
  and `City, Country` elsewhere. For remote roles, record the stated eligibility region
  ("United States", "EU").
- **Tie-break:** Named offices are all recorded, however many. "Any of our global offices"
  with no names is `null`. Remote with no stated region is `null`.

### `compMin`, `compMax`, `compCurrency` (nullable)

- **Rule:** Annual **base salary cash only**, as stated. Equity, bonus, signing and benefits
  are excluded. A single stated number sets `compMin` = `compMax`. Hourly × 2080,
  monthly × 12. `compCurrency` is the ISO 4217 code.
- **Tie-break:** Multiple ranges (by level or location) record the overall span — lowest min,
  highest max. A bare `$` is `USD` unless the posting points elsewhere (CAD, AUD). If comp is
  stated but currency isn't, infer it from `locationGeo`: a US location is `USD`, a Canada
  location is `CAD`. Only fall back to `null` when the location itself doesn't pin a currency
  (e.g. remote with no region, or a currency-ambiguous country). These three fields still move
  together in the sense that never a min without a currency where one can be inferred, and if
  no comp is stated at all, all three are `null`.

### `stack` (string[], nullable, growable library)

- **Rule:** Only technologies **named in the posting**, mapped to an entry in the growable
  library at `data/stack/canonical-stack.json`, searchable in the labeling tool's stack field.
  If an existing entry fits (check aliases too — "k8s" is "Kubernetes"), use it; only add a new
  entry when the technology genuinely isn't covered yet. Never infer an implied technology.
- **Tie-break:** "Nice to have" and "bonus" technologies count — they are named. Technologies
  appearing only in the company blurb do not; read the requirements and responsibilities
  sections. `null` means the posting names no technologies at all; `[]` no longer applies now
  that the library is open-ended — a named technology always gets added rather than dropped.

### `employmentType` (enum, nullable)

- **Rule:** Defaults to `full_time` — this is the one field where silence is *not* `null`, because
  an unstated employment type on a standard corporate posting means full-time, not "unknown."
  `internship` requires an explicit statement — it's a title/description signal that's almost
  always present when it applies, so don't default into it. `contract` and `part_time` are set
  from an explicit statement, a clear derivation from the description (e.g. a stated contract
  length, "20 hrs/week"), or an hourly pay rate — see the "Hourly contract rate" resolved case.
  Absent any of those signals, `full_time` stands.
- **Tie-break:** Precedence when several apply: `internship` > `contract` > `part_time` >
  `full_time`. "Contract-to-hire" is `contract`.
