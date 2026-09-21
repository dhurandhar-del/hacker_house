# Sentinel — Build Status

Where the build stands, and what is left. Every "done" below is backed by a
command whose output is quoted; nothing is marked complete on the strength of a
file existing.

**As of 2026-09-21.** Branch `sentinel-v2`.

Companion to [EXECUTION_PLAN.md](EXECUTION_PLAN.md), which has the full task
breakdown. This document is the score against it.

---

## The one-line answer

**The submission exists.** Twenty answer files, all valid against the contract
*and* against the live graph, produced by one command, with every case written
back as a `FraudCase` vertex. GraphRAG is live and its footprint is visible in
the files. What remains is the console, the video and the write-ups.

```
$ python -m sentinel run --all
20/20 valid · block 10% · SAR 10% · changed 55% · 142,821 tokens · 348s
verdicts: {'uncertain': 9, 'fraud': 8, 'legitimate': 3}
```

No warnings. Block rate is a fifth of its 0.50 ceiling, SAR rate half of its
0.20 ceiling, no verdict covers more than 45% of the pack, and eleven of the
twenty changed their recommendation after the evidence round against a target
of six.

---

## Verified state

```
pytest tests/unit tests/integration -q      320 passed
pytest tests/live -m live -q                16 passed   (against the live workspace)
ruff check sentinel api tests               All checks passed!
ruff format --check sentinel api tests      all files already formatted
mypy --strict sentinel                      Success: no issues found in 69 source files
python -m sentinel validate                 20/20 valid (with graph checks)
python -m api.contract emit --check         up to date
```

---

## Milestones

| # | Milestone | Exit test | State |
|---|---|---|---|
| **M0** | Environment real | install, suite, lint, types | ✅ |
| **M1** | Domain ported | 40 v1 policy tests from the new home; live tool assertions | ✅ |
| **M2** | Tools agent-ready | ≥16 tool schemas; live sweep reproduces the hand investigation | ✅ 19 tools |
| **G1** | New GSQL queries | 10 new queries installed and callable | ✅ 26 live, all with source |
| **M3** | GraphRAG live | `PolicyDoc` > 0; 5,565 `ClosedCase.emb`; retrieval recall ≥ 4/6 | ✅ **5 of 6** |
| **M4** | One case end to end | valid file, non-zero tokens, ≥1 `document` evidence item | ✅ |
| **M5** | **20 answer files** ← the gate | all valid; block ≤ 0.50; ≥6 with initial ≠ final | ✅ **20/20, 11 changed** |
| **M6** | Console usable | live stream, reconnect replays | ⚠️ API in progress |
| **M7** | Permission boundary | 403 → approve → execute in the browser | ⚠️ service built, no UI |
| **M8** | Score raised | calibration review, ring discovery | ✅ review done; ring sweep built |
| **M9** | Shipped | video, blog, social | ⚠️ blog and social drafted; **no video** |

---

## Done, in detail

### The graph and its tools

| | |
|---|---|
| `GRAPH_GOA` on Savanna 4.2.5 | 590,742 transactions · 14,317 cards · 5,565 closed cases · 9,704 device profiles · 20 alerts · 46 policy chunks · 20 Sentinel cases |
| GSQL queries installed | **26**, every one with source in `graph/queries/`. Two `_zz_` orphans with no source were dropped |
| Tools exposed to the agent | **19** (the console's read queries are deliberately withheld) |
| TigerGraph MCP | `tigergraph-mcp` 1.0.3 over stdio, **69 tools**, verified returning the hand-checked 42 prior transactions in region 330.0 |

### GraphRAG

| | |
|---|---|
| `PolicyDoc` | **46 chunks**, parsed out of Guide.md rather than transcribed — 10 rules, 9 policy sections, 5 patterns, 16 glossary terms, 6 guidance notes |
| `ClosedCase.emb` | **5,565 of 5,565**, `text-embedding-3-large` at 256 dimensions, about $0.01 |
| Retrieval | Cosine over 5,611 vectors fused with a structural ranking by RRF, hard-filtered on `opened_at < as_of` |
| Recall | **5 of HHG-003's 6 hand-found closed cases** in the top 10, against a target of 4 |
| Visible footprint | `source: "document"` evidence on every case, each citing a `PolicyDoc` the graph identity checker proves exists |

### The backend

44 modules under `backend/sentinel/`, plus `backend/api/`.

| Package | What it does |
|---|---|
| `graph/` | Async repository over REST++, cold-start detection, token re-mint, batched upsert, `FakeGraphRepository`, and the normaliser |
| `tools/` | 19 typed tools, one `QueryLog` per investigation, `EvidenceRef` as the single place a citation is built |
| `evidence/` | The fitted table, the log-odds ledger, `FeatureExtractor` over 29 features |
| `policy/` | `PolicyEngine`, `RoutingTable`, `SarPolicy`, `StoppingPolicy`, six gate classes |
| `rag/` | `CorpusBuilder`, `EmbeddingService`, `VectorIndex`, `GraphRagRetriever` |
| `memory/` | `CaseMemoryStore` — one vertex, eight edge types, one POST |
| `agents/` | The ten-step orchestrator, four LLM agents, episode scoper, state builder, assembler |
| `exploration/` | Two-hop ring discovery; output to `exploration/`, never to `cases/` |
| `runner.py`, `cli.py` | The run harness and the composition root |

### Nine defects found and fixed

Four were in the v1 base, five were found by running the machine and auditing
its output. Each has a regression test.

**In the base**

1. **The ledger's group cap** clamped the increment by remaining room, so
   exonerating evidence arriving after incriminating evidence in the same group
   was over-suppressed — damaging exactly the legitimate half of the benchmark.
2. **`independent_signals` was never wired** to `ledger.independent_support()`,
   so R1 stripped `BLOCK_CARD` from every case under p = 0.70.
3. **`elt.json` had no `analyst_request` prior**, so HHG-014 ran at 0.5 silently.
4. **The validator conflated a failed lookup with a missing vertex.**

**Found by running it**

5. **The planner dropped the exonerating detectors.** Free to choose it picked
   6 of 11 and the five it dropped were the amount band, the amount
   distribution and the recurring probe: p = 0.74 instead of 0.36 on identical
   facts.
6. **The planner's schema was inexpressible.** A free-form `args` dict cannot
   satisfy OpenAI strict mode.
7. **Truncation was retried as a schema violation**, four times, burning 19k
   tokens. Now detected by `finish_reason`.
8. **`R2` could not fire on the eight cases where the cardholder denied
   outright.** `TriggerContext.customer_already_denied` was computed and read by
   nothing.
9. **`import sentinel` from the repository root resolved to the superseded v1
   package**, so `python -m sentinel` ran the wrong code.

**Found by auditing the output**

10. **One `CostMeter` served the whole batch.** `answer.tokens` climbed from
    7,541 on the first case to 122,847 on the twentieth — the batch total — and
    the per-run token ceiling tripped two thirds of the way through.
11. **`initial` was evaluated at the post-request probability.** HHG-006's
    requested step-up moved the number 0.8111 → 0.5883 and the *pre*-request
    recommendation was computed at 0.5883, so the two phases could not disagree.
12. **The agent was nondeterministic.** Four identical runs returned 0.3569,
    0.3577 and 0.5025. See [CALIBRATION.md](../CALIBRATION.md).
13. **The risk score was counted twice** on the alerts the score raised.
14. **Four evidence groups held one observation** — being online — contributing
    an identical +1.84 log-odds to every fraud verdict.
15. **The simulator invented a failed step-up** on the seven alerts with no
    identity record, worth +1.1 log-odds each.
16. **The simulator let a cardholder confirm a charge they had just reported**,
    producing `CREATE_CASE` and `CLOSE_NO_FRAUD` in the same file.
17. **One abbreviation cost a whole answer file.** `count_sentences` read "U.S.
    dollars" as two sentences and the resulting `ValidationError` escaped the
    orchestrator's except clauses.
18. **A narrower group cap inverted a posting's sign**: +0.4 applied as −0.5.
19. **`scripts/setup_mcp.py --refresh` deleted a live `OPENAI_API_KEY`.**

### The model

`gpt-5.4-mini`, `text-embedding-3-large` at 256 dimensions. Both verified live.

**The finding that shaped the prompts:** asked cold with the HHG-003 facts, the
model named the pattern `card_testing` — twice — and its own explanation gave
it away: *"the same $49.00 amount has repeated many times."* That is a
recurring charge, which R7 says must never be blocked. The pattern definitions
are now carried verbatim in the prompt, and the policy path has no model in it.

---

## Remaining

| id | Work | Why it matters |
|---|---|---|
| **S1–S9** | The FastAPI service — app factory, controllers, SSE endpoint | The console needs it. Schemas, services, handlers, store and SSE are built; controllers and the app factory are in progress |
| **F3–F12** | The console: queue, case detail, live stream, action panel, approvals | **Required by the brief** |
| **Z5** | Demo video, 3–5 minutes | **Required. Cannot be produced from here** — it needs a screen recording |
| **Z2** | Run the ring sweep and commit `exploration/` | Built and typed; not yet run against the live graph |

### What cannot be finished from a terminal

The **demo video** is a required submission artefact and needs someone to
record a screen. Everything it should show is built or nearly so; the runbook
in [EXECUTION_PLAN.md §10](EXECUTION_PLAN.md#10-demo-day-runbook) lists the five
beats in order.

---

## Next three things

1. **Finish the API and the console.** Everything below the controllers exists.
2. **Record the video** once the console renders a live run.
3. **Publish the blog** ([BLOG.md](../BLOG.md)) and the social post
   ([SOCIAL.md](../SOCIAL.md)), then fill the two URLs in.
