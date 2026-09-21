# Sentinel — Build Status

Where the build actually stands, and everything left. Every "done" below is
backed by a command whose output is quoted; nothing is marked complete on the
strength of a file existing.

**As of 2026-09-21.** Branch `sentinel-v2`, 4 commits ahead of `main`.

Companion to [EXECUTION_PLAN.md](EXECUTION_PLAN.md), which has the full task
breakdown. This document is the score against it.

---

## The one-line answer

The **machine works end to end**. HHG-003 runs against the live graph and the
live model and produces a valid answer file. What remains is running it on the
other nineteen cases, GraphRAG, the API, the console, and the submission
artefacts.

```
verdict=uncertain  p=0.3569  pattern=none
tool_calls=14  tokens=19242  latency=22.4s  valid=True
final actions: CREATE_CASE, WARN_CUSTOMER, MONITOR_CARD
```

That number is the case's own corroboration: the hand investigation scored it
**0.55 → 0.32**, v1's ledger **0.51 → 0.38**, and the agent now returns
**0.357**. Three methods sharing no machinery.

---

## Verified state

```
ruff check sentinel tests                All checks passed!
mypy --strict sentinel                   Success: no issues found in 59 source files
pytest tests/unit tests/integration -q   300 passed
pytest tests/live -m live -q             16 passed   (against the real workspace)
```

**44 modules, 9,780 lines** in `backend/sentinel/`, plus the frontend design
system and 28 installed GSQL queries.

---

## Milestones

| # | Milestone | Exit test | State |
|---|---|---|---|
| **M0** | Environment real | install, suite, lint, types | ✅ |
| **M1** | Domain ported | 40 v1 policy tests from the new home; live tool assertions; HHG-003 validates offline | ✅ |
| **M2** | Tools agent-ready | ≥16 tool schemas; live sweep reproduces the hand investigation | ✅ 19 tools |
| **G1** | New GSQL queries | 10 new queries installed and callable | ✅ 28 live |
| **M3** | GraphRAG live | `PolicyDoc` > 0; 5,565 `ClosedCase.emb`; retrieval recall ≥ 4/6 | ❌ **not started** |
| **M4** | One case end to end | valid file, non-zero tokens, ≥1 `document` evidence item | ⚠️ **all but the document item** — that needs M3 |
| **M5** | **20 answer files** ← the gate | all valid; block rate ≤ 0.50; ≥6 with initial ≠ final | ❌ 1 of 20 |
| **M6** | Console usable | live stream, reconnect replays | ❌ design system only |
| **M7** | Permission boundary | 403 → approve → execute in the browser | ❌ |
| **M8** | Score raised | calibration review, ring discovery | ❌ |
| **M9** | Shipped | video, blog, social | ❌ |

---

## Done, in detail

### The graph and its tools

| | |
|---|---|
| `GRAPH_GOA` on Savanna 4.2.5 | 590,742 transactions · 14,317 cards · 5,565 closed cases · 9,704 device profiles · 20 alerts |
| GSQL queries installed | **28** — the 16 from v1 plus 10 new |
| Tools exposed to the agent | **19** (the console's read queries are deliberately withheld) |

The three fitted features that had no tool in v1 now have one:

- `txn_sequence_context` reads the **576,425 `NEXT` edges** no v1 query ever traversed. On HHG-003's flagged transaction: `seconds_since_prev = 2920` — 48.7 minutes, inside the one-hour burst band.
- `card_amount_stats` returns raw sums so the caller can see the sample size. C08623-K2: n=980, mean **$128.84**, σ **$161.99** — so the disputed $49.00 sits *below* the card's own mean.
- `product_novelty` closes `product_novel_for_card` (LR 2.297).

### The backend

| Package | What it does |
|---|---|
| `graph/` | Async repository over REST++, cold-start detection (~45s wake), token re-mint, `FakeGraphRepository`, and the normalizer that turns `-1.797e308` and `1970-01-01` into `None` |
| `tools/` | 19 typed tools, one `QueryLog` per investigation, `EvidenceRef` as the single place a citation is built |
| `evidence/` | The ledger with the group-cap fix, and `FeatureExtractor` mapping graph facts to the 29 fitted features |
| `policy/` | `PolicyEngine`, `RoutingTable`, `SarPolicy`, `StoppingPolicy`, six gate classes |
| `domain/` | The answer contract with ten validators; `Alert` reading `risk_score = -1` as absent |
| `validation/` | Pure validator plus graph identity checker |
| `llm/` | Structured output, truncation handling, `CostMeter` filling `answer.tokens` |
| `agents/` | The nine-step orchestrator, four LLM agents, episode scoper, state builder, assembler |
| `simulation/` | The evidence simulator |

### Four defects in the v1 base, fixed

1. **The ledger's group cap** clamped the increment by remaining room, so exonerating evidence arriving *after* incriminating evidence in the same group was over-suppressed — damaging exactly the legitimate half of the benchmark. Now clamps the group total symmetrically.
2. **`independent_signals` was never wired** to `ledger.independent_support()`. Left at its default of 1, R1 strips `BLOCK_CARD` from every case under p=0.70.
3. **`elt.json` had no `analyst_request` prior**, so HHG-014 silently ran at 0.5. Now explicit, and an unknown trigger raises.
4. **The validator conflated a failed lookup with a missing vertex**, so one auth hiccup read as an invalid submission.

### Three defects found by running it

- **The planner dropped the exonerating detectors.** Free to choose, it picked 6 of 11 and the five it dropped were the amount band, the amount distribution and the recurring probe. Same facts, **p = 0.74 instead of 0.36**, while its own summary said the evidence did not fit a fraud pattern. The core sweep is now mandatory and the planner only adds to it.
- **The planner's schema was inexpressible.** A free-form `args` dict cannot satisfy OpenAI strict mode. Removed — the sweep builds every argument from measurements anyway, so a planner cannot anchor a window on the alert's clock instead of the transaction's.
- **Truncation was retried as a schema violation**, four times, burning 19k tokens. Now detected by `finish_reason` and retried with a doubled budget.

### The model

`gpt-5.4-mini`, `text-embedding-3-large` at 256 dimensions. Both verified live.

**The finding that shaped the prompts:** asked cold with the HHG-003 facts,
the model named the pattern `card_testing` — twice — and its own explanation
gave it away: *"the same $49.00 amount has repeated many times... across
multiple months."* That is a recurring charge, which R7 says must never be
blocked; card testing reaches `BLOCK_CARD`. The pattern definitions are now
carried verbatim in the prompt, and the policy path has no model in it.

### The frontend

Design system only: tokens with **computed** contrast ratios, 11 primitives, the
generated contract (14 actions, routing table, 15 SSE event types), and a
showcase page. No feature screens.

---

## Remaining

### Blocking the submission

| id | Work | Est. | Why it matters |
|---|---|---|---|
| **A10** | `WriteStep` + `CaseMemoryStore` — write the answer file and the `FraudCase` vertex | 2 h | The brief requires cases written to the graph; nothing writes yet |
| **A14** | **Run all 20 cases chronologically** | 3 h | This *is* the submission (M5) |
| **P14** | Case write-back with `emb`, so a later case can retrieve an earlier one | 1 h | Proves memory compounds inside the run |
| **Z1** | Calibration review of all 20 | 2.5 h | Highest-value hour left; pure judgement |

### Required components still missing

| id | Work | Est. | Note |
|---|---|---|---|
| **G2–G4** | GraphRAG: corpus, embeddings, hybrid retriever | 6 h | **Required by the brief.** `PolicyDoc` is 0 rows, so no evidence item can carry `source: "document"` |
| **S1–S9** | The FastAPI service: SSE, actions, approvals, audit, benchmark report | 14 h | The console needs it |
| **F3–F12** | The console: queue, case detail, live stream, action panel, approvals, graph canvas | 16 h | **Required by the brief** |
| **G5** | `pip install tigergraph-mcp`, repoint `.mcp.json` | 0.5 h | Required component; currently `ENOENT` |

### Score and ship

| id | Work | Est. |
|---|---|---|
| Z2 | Ring discovery over `ring_expand_2hop` | 2 h |
| Z3 | Autonomous monitoring → `exploration/` | 1.5 h |
| Z4 | Repo polish, README, ten-minute setup | 1.5 h |
| Z5 | Demo video, 3–5 min, from a replayed journal | 2.5 h |
| Z6 | Technical blog post, six required sections | 2 h |
| Z7 | Social post tagging @TigerGraphDB | 0.3 h |

**Roughly 55 person-hours remain**, against about 98 originally estimated.

---

## If time runs short

Cut in this order, from [EXECUTION_PLAN.md §11](EXECUTION_PLAN.md#11-cut-list):
benchmark screen → autonomous monitoring → graph canvas → closed-case
embeddings (keep the policy corpus) → ring discovery → the defence agent →
the canvas/memory endpoints → the approvals inbox.

**Never cut:** the 20 answer files and their validation, the policy engine and
its tests, case write-back, honest instrumentation, the rule that no answer
field comes from free-form model text, and the rule that the public IEEE-CIS
files are never opened.

---

## Next three things

1. **`WriteStep` + `CaseMemoryStore`** — the last link before a batch run.
2. **Run all 20** — that is M5, the submission gate. Tag `v1-submittable`.
3. **GraphRAG** — a required component, and the thing that makes
   `source: "document"` evidence reachable.

The API and the console can start in parallel at any point: they code against
the SSE event contract and the endpoint table, both of which are already
written down.
