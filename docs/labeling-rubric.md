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
result: `seniority`, `locationPolicy`, `sponsorship`, `compMin`/`compMax`. This set is defined
by EVAL-5 (JOS-56) and drives its decision-usable rate — keep the two in sync.

### Labeler flags

When you hesitate on a field — the rubric does not cleanly decide it, or the posting is
genuinely ambiguous — record a flag on that record naming the field and the reason. A bare
"Software Engineer" with no level word is the canonical case: label it `null` per the rule,
**and flag it**. Most records get no flags.

Flags are not labels. They do two jobs:

- mark rubric gaps to fix before the next labeling pass
- identify postings where a model disagreement may be legitimate rather than wrong

## The six resolved cases

| Case | Answer |
|---|---|
| Is "Software Engineer II" mid or junior? | `mid`. Numeric ladders map I→`junior`, II→`mid`, III+→`senior`. |
| "Senior / Staff Engineer" | `senior`. A range records its **lower** bound — that is the minimum bar the posting accepts. |
| "$180,000 - $220,000 + equity" | `compMax` = `220000`. Base cash only; equity, bonus and signing are excluded. |
| Posting lists 4 offices | All four, in `locationGeo`. It is an array field for this reason. |
| Nothing said about sponsorship | `null`. Silence is never `false`. |
| Hourly contract rate | Annualize at 2080 hours. `employmentType` = `contract` marks it as derived. |

## Per-field rules

### `title` (string, required)

- **Rule:** Copy the board's public title verbatim. No cleanup, no case normalization, no
  stripping of req IDs or location suffixes. This field is copied, not extracted.
- **Tie-break:** If the ATS exposes more than one title field, use the one rendered on the
  public board.

### `seniority` (enum, nullable)

- **Rule:** Take the level from the **title**. If the title carries no level word, fall to an
  explicit level statement in the body. If neither states a level, `null`.

  | Signal | Value |
  |---|---|
  | Intern, Internship, Co-op | `intern` |
  | I, Associate, Entry, Junior, New Grad | `junior` |
  | II, Mid, Mid-level | `mid` |
  | III, Senior, Sr., Lead | `senior` |
  | Staff, Senior Staff | `staff` |
  | Principal, Distinguished, Fellow | `principal` |

- **Tie-break:** A range records its lower bound ("Senior / Staff" → `senior`). A bare
  "Software Engineer" with no modifier is `null`, not `mid` — and gets a labeler flag, since
  seniority is a critical field and this is the largest single source of null seniority.
  Management titles (Manager, Director, VP) are `null` — the IC ladder does not apply to them.

### `locationPolicy` (enum: onsite | hybrid | remote, nullable)

- **Rule:** `remote` if the role may be performed fully remotely. `hybrid` if the posting
  states any required in-office cadence. `onsite` if it requires full-time presence.
- **Tie-break:** A city name alone is a location, not a policy — `null`. Vague flexibility
  language ("remote-friendly", "flexible") with no stated cadence is `null`. "Remote (US)"
  is `remote` with the region recorded in `locationGeo`, not `hybrid`.

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
  highest max. A bare `$` is `USD` unless the posting points elsewhere (CAD, AUD). These
  three fields move together: never a min without a currency, and if no comp is stated all
  three are `null`.

### `sponsorship` (boolean, nullable)

- **Rule:** `true` only where the employer states it sponsors or provides visa sponsorship.
  `false` only where it states it will not.
- **Tie-break:** "Must be authorized to work in the US" on its own is `null` — it states a
  requirement, not a sponsorship position. "...without requiring sponsorship now or in the
  future" is `false`.

### `stack` (string[], nullable)

- **Rule:** Only technologies **named in the posting**, mapped to the canonical vocabulary in
  `src/schema/job-posting.ts`. Never infer an implied technology.
- **Tie-break:** "Nice to have" and "bonus" technologies count — they are named. Technologies
  appearing only in the company blurb do not; read the requirements and responsibilities
  sections. Out-of-vocabulary technologies are dropped. `null` means the posting names no
  technologies at all; `[]` means it names some, none of them in the vocabulary.

### `employmentType` (enum, nullable)

- **Rule:** From an explicit statement only. Silence is `null`.
- **Tie-break:** Precedence when several apply: `internship` > `contract` > `part_time` >
  `full_time`. "Contract-to-hire" is `contract`.
