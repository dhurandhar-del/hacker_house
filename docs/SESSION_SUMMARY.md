# Session summary — Sentinel build, 2026-09-20

Everything completed so far on the TigerGraph Agentic Fraud Investigation
challenge, what state each piece is in, and what is left.

**Where the build stands:** Steps 0–5 of [BUILD_PLAN.md](BUILD_PLAN.md) are done,
Step 6 is two-thirds done. The graph is loaded and verified on Savanna, sixteen
GSQL tools are installed and reachable over MCP, the calibration and policy
engines are written and tested, and one of twenty answer files is complete.

---

## 1. Planning documents

| Deliverable | State |
|---|---|
| [PRD.md](PRD.md) | Complete. Problem, six product principles, users, the investigation loop, architecture, graph model, intelligence layer, UI spec, deliverables, criterion-by-criterion scoring map, demo script, risks, milestones |
| [BUILD_PLAN.md](BUILD_PLAN.md) | Complete. Eleven steps, each with an exit test; steps 2, 3, 4, 5 and 6b/6c marked done with links to their write-ups |

## 2. TigerGraph Savanna — loaded and verified

Connected to the provided workspace (TigerGraph **4.2.5**), which was empty at
the start of the session. Graph **`GRAPH_GOA`** now holds the full dataset.

| Type | Loaded | Expected |
|---|---|---|
| Customer | 13,553 | ✓ |
| Card | 14,317 | ✓ |
| Transaction | 590,742 | ✓ |
| DeviceProfile | 9,704 | ✓ |
| BillingRegion / EmailDomain / ProductCode | 332 / 60 / 5 | ✓ |
| ClosedCase | 5,565 | ✓ |
| Alert (the 20 exam cases) | 20 | ✓ |
| MADE / NEXT / OF_PRODUCT | 590,742 / 576,425 / 590,742 | ✓ |
| FROM_DEVICE / BILLED_IN | 140,784 / 525,003 | ✓ |
| PURCHASER_EMAIL / RECIPIENT_EMAIL | 496,262 / 137,453 | ✓ |
| CC_INVOLVES / CC_ON_CARD / CC_CONNECTED_TO | 14,955 / 5,565 / 92 | ✓ |
| ALERT_ON_CARD / ALERT_ON_TXN | 20 / 20 | ✓ |

Every count is asserted against a figure computed from the staging files, not
eyeballed. Full load takes **1.3 minutes**.

**Built:**
- [graph/schema.gsql](../graph/schema.gsql) — 12 vertex types, 20 edge types
- [graph/loading_jobs.gsql](../graph/loading_jobs.gsql) — 13 loading jobs
- [scripts/prepare_data.py](../scripts/prepare_data.py) — 708 MB / 393 columns → 187 MB / 23 columns, all 590,742 rows kept, 5 integrity checks, exits non-zero on failure
- [scripts/load_to_tigergraph.py](../scripts/load_to_tigergraph.py) — schema, jobs, chunked upload, exact-count verification; `--schema-only`, `--data-only`, `--only <job>`, `--verify-only`, `--drop`
- [sentinel/config.py](../sentinel/config.py), `.env` (gitignored), `.env.example`
- [LOADING.md](LOADING.md) — the write-up

### Problems found and fixed during loading

**`card_id` had to be reverse-engineered.** It is not a column. The intuitive
rule (distinct `card1..card6` tuple per customer) produces the right *set* of IDs
but assigns **10 of the 20 exam transactions to the wrong card**. The real rule —
the `card6` value ranked lexicographically within the customer — was recovered by
testing candidate rules against the 14,975 `txn → card_id` pairs implied by the
closed cases and the case pack. It reproduces all 14,975 exactly. Since made-up
IDs score zero and `card_id` appears in nearly every answer field, this would
have been a silent, submission-wide failure.

**`proxy` and `Case` are reserved GSQL keywords** — renamed `proxy_flag` and
`FraudCase`. The parser error points at the following comma, not the word.

**`HEADER="true"` is ignored on the REST upload path**, so header rows were being
inserted as real vertices. Headers are now stripped client-side.

**My own verification was too weak.** The first edge check only asserted `> 0`
and printed "ALL CHECKS PASSED" while `MADE` was short by 119,000 rows. It now
asserts exact counts.

## 3. Hand investigation — HHG-003

Done against the live graph before writing any agent code, in 17 queries.
Write-up: [HAND_INVESTIGATION.md](HAND_INVESTIGATION.md).

A customer disputes a $49.00 card-present charge. The graph says it is
unremarkable for this card — 42 prior transactions in that billing region, 53
prior charges in the same dollar band, below the card's median, typical product
and channel, model score only 0.40. Against that: the cardholder has denied
activity five times before and been right **five out of five**, and a $116.93
charge 49 minutes earlier in the same region scored 0.88. But the card's own
fraud signature does not match (all four prior `out_of_region_use` frauds were in
regions with no history), and there is no ring (18 high-risk of 608 that week vs
13 of 552 a month earlier).

Verdict `uncertain`, escalated, **no block at any stage**.

**Produced:**
- [cases/HHG-003.json](../cases/HHG-003.json) — the golden fixture, 11 evidence items each with its query and entity IDs
- [eval/validate.py](../eval/validate.py) — validates shape, policy enums, the **routing table**, `sar.file` ↔ `FILE_REPORT` consistency, R10, exposure = sum of affected amounts, and **every ID against the graph**
- [sentinel/memory.py](../sentinel/memory.py) + [scripts/write_cases_to_graph.py](../scripts/write_cases_to_graph.py) — the case is live as `CASE-HHG-003`, wired to its card, alert, transaction and six cited closed cases. Retrieval from the card was verified working.

**Design consequence found here:** region novelty must be evaluated *as of the
transaction date*. Region 272.0 had no history when case CC-4957 was opened in
October; by December the same card uses it routinely. A detector that scans the
whole file will clear real fraud and flag real customers.

## 4. Tool layer — 16 GSQL queries over MCP

All 16 parsed clean on the first attempt, compiled in 4 minutes, all callable.
Write-up: [TOOLS_AND_MCP.md](TOOLS_AND_MCP.md).

`txn_detail` · `card_baseline` · `card_window` · `card_testing_probe` ·
`region_novelty` · `amount_band_probe` · `device_novelty` · `device_neighbors` ·
`region_cluster` · `email_cluster` · `ring_expand` · `recurring_charge_probe` ·
`velocity_probe` · `customer_case_history` · `similar_prior_cases` ·
`case_memory_for_card`

**Built:**
- [graph/queries/sentinel_queries.gsql](../graph/queries/sentinel_queries.gsql)
- [scripts/install_queries.py](../scripts/install_queries.py)
- [sentinel/tools.py](../sentinel/tools.py) — wrappers plus the `QueryLog` that builds every evidence `ref` string and supplies the `tool_calls` count the answer format requires
- [scripts/test_tools.py](../scripts/test_tools.py) — **26 assertions, all passing**, re-checking every number from the hand investigation
- [scripts/setup_mcp.py](../scripts/setup_mcp.py) + `.mcp.json` — token minting and verification

**MCP verified end to end.** `tigergraph-mcp` 1.0.3 over stdio, 69 tools exposed,
and `region_novelty` called *through MCP* returns the hand-verified 42. Confirmed
to work the way Claude Code launches it — no environment injected, credentials
discovered from `.env`.

### The bug the exit test caught

`ring_expand` reported **25 "connected cards"** for a case whose flagged
transaction is in person and has no device record at all. A `DeviceProfile` is
`DeviceInfo | OS | browser | screen` — a fingerprint **class**, not a device
identity:

| cards per profile | profiles | card-links |
|---|---|---|
| 1 | 4,913 | 4,913 |
| 2–5 | 3,040 | 8,723 |
| 6–20 | 1,227 | 12,256 |
| 21–100 | 408 | 16,455 |
| **> 100** | **116** | **24,653** |

116 profiles (1.2%) carry 24,653 of the links; `Windows | Windows 10 | chrome
63.0 | 1920x1080` alone spans 842 cards. Left unfixed this fabricates a
shared-origin link on nearly any card ever used online — which under R6 triggers
`CREATE_CASE` + `FILE_REPORT` + `MONITOR_CONNECTED_CARDS`. A false SAR, on a
majority of cases. `ring_expand` now gates on `max_device_cards` and reports
`devices_total` against `devices_specific_enough`.

One of the two disagreements was a *test* bug, not a tool bug: `card_window(±72h)`
correctly returns 43, where my hand query had used a 7-day calendar span.

## 5. Calibration and policy

Write-up: [CALIBRATION.md](CALIBRATION.md).

### The finding that reshaped the step

The first likelihood table said a high model score and a new device were evidence
**against** fraud (`risk_85_100` LR 0.12, `device_new` 0.19). The cause is in the
labels:

| outcome | trigger | n | mean risk | % ≥ 0.7 |
|---|---|---|---|---|
| cleared | model score | **900 — all** | 0.881 | **100%** |
| confirmed fraud | customer report | **4,656 — all** | 0.475 | 26% |

Not one cleared customer report, not one confirmed model-score alert, in four
months. The classes are perfectly separated by **trigger pathway**, so fitting
across them measures how the alert arrived, not whether it was fraud. The cleared
notes confirm it — 716 "confirmed travel", 158 "confirmed new phone".

**The fix** separates the two questions: evidence LRs are fitted case-control
matched on card (14,055 fraud transactions vs 300,602 other transactions on the
same 1,441 cards), and trigger base rates become an explicit, stated prior. The
risk-score buckets now form a monotone reliability curve — the sanity check the
first fit failed:

| bucket | <0.30 | 0.30–0.50 | 0.50–0.70 | 0.70–0.85 | ≥0.85 |
|---|---|---|---|---|---|
| LR | **0.37** | 2.48 | 5.45 | 8.22 | **18.76** |

**Built:**
- [eval/fit_elt.py](../eval/fit_elt.py) → `sentinel/elt.json`, 29 features with LRs, group tags and shrinkage for thin support
- [sentinel/ledger.py](../sentinel/ledger.py) — log-odds accumulator; caps correlated evidence by group, posts `lr_absent` so absence counts as evidence, counts independent *groups* not postings for the §6 stopping test
- [sentinel/policy.py](../sentinel/policy.py) — R1–R10 as a pure function; gates applied twice, routes always recomputed from the table
- [tests/test_policy.py](../tests/test_policy.py) — **40 tests, all green**

Test coverage includes: `BLOCK_CARD` routes L1 at $2,500.00 and L2 at $2,500.01;
R1 bars any block on a single signal below 0.70 before the customer answers; R7
is a **bar not a preference** (never blocks, even after a denial); R10 makes
`BLOCK_ALL_CARDS` unreachable with one compromised card; `sar.file` ↔
`FILE_REPORT` swept across 40 probability/exposure/shared-origin combinations; a
report always has a case ordered before it; `CLOSE_NO_FRAUD` never coexists with
enforcement.

### Cross-check

HHG-003 was scored **0.55 → 0.32** by hand before any of this existed. The fitted
ledger returns **0.51 → 0.38** and the policy engine independently reproduces the
same action set, with no block at any stage. Two methods sharing no machinery
agreeing within 0.06 is the strongest available evidence that neither is badly
wrong.

---

## What exists now

```
graph/     schema.gsql, loading_jobs.gsql, queries/sentinel_queries.gsql
scripts/   prepare_data, load_to_tigergraph, install_queries, setup_mcp,
           test_tools, write_cases_to_graph
sentinel/  config, tools, ledger, policy, memory, elt.json
eval/      validate, fit_elt
tests/     test_policy  (40 tests)
cases/     HHG-003.json (1 of 20)
docs/      PRD, BUILD_PLAN, LOADING, HAND_INVESTIGATION, TOOLS_AND_MCP,
           CALIBRATION, SESSION_SUMMARY
```

About 3,100 lines of Python plus the GSQL. Everything in place is verified
against something: staging counts, the hand investigation, or a unit test.

## What is left

| Step | Work |
|---|---|
| 6d | GraphRAG — embed the policy, the five patterns, the closed-case narratives and the FinCEN/FFIEC documents; hybrid retrieval (vector **plus** structural filters) |
| 6e | The grounded evidence simulator — four branches including the "no reply in 24h" R4 path |
| 7 | The LangGraph agent, then **all 20 answer files** in chronological order so memory compounds within the run. This is the submission gate |
| 8 | Analyst console — case queue, investigation timeline, probability trajectory, approval inbox, graph canvas, SAR view |
| 9 | Calibration review of all 20, ring discovery, autonomous monitoring |
| 10 | Repo polish, 3–5 minute demo video, technical blog post, social post tagging @TigerGraphDB |

## Housekeeping

- `git init` was run and files staged; **nothing has been committed yet**. No
  secrets or large CSVs are staged, and `.env` is correctly ignored.
- The Savanna API token in `.env` **expires 2026-09-27**. Re-mint with
  `python scripts/setup_mcp.py --refresh`.
- The raw CSVs are gitignored; `scripts/prepare_data.py` regenerates all staging
  from them in about 10 seconds.
- The public IEEE-CIS / Kaggle files have not been opened at any point, and the
  repo README records that rule.

## Open questions carried forward

1. Roughly half the exam pack is meant to be legitimate. The trigger prior (0.75
   for customer reports, 0.25 for score triggers) is a shrunk judgement call and
   should be reviewed once all 20 cases have been scored — if the verdict mix
   comes out lopsided, the prior is the thing to revisit, not the prompt.
2. Do the 9 `undocumented` closed cases share a signature? If they cluster, that
   cluster is a sixth pattern and naming it is scored under R9.
3. `in_person_elsewhere_same_day` fitted at LR 0.52 — mild evidence *against*
   fraud, where intuition says impossible travel. Kept as fitted rather than
   overridden; worth revisiting with per-card velocity normalisation.
