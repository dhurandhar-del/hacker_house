# Sentinel — Step-by-Step Build Plan

Companion to [PRD.md](PRD.md). Ordered so that a **complete, submittable twenty-case answer set exists by the end of Step 7**. Everything after that raises the score; nothing after that is load-bearing.

Rule for the whole build: **never work on two layers at once**. Graph before tools, tools before agent, agent before UI. Each step below has an exit test. Do not move on until it passes.

---

## Step 0 — Repo and ground rules (30 min)

```bash
cd "C:/Users/Rishit Rastogi/Downloads/HACKER_HOUSE"
git init && git branch -M main
```

Layout:

```
sentinel/
  data/            # the four CSVs (gitignored), plus derived parquet
  graph/           # schema.gsql, loading/, queries/
  sentinel/
    tools/         # MCP client + one python wrapper per GSQL query
    ledger.py      # evidence likelihood table + log-odds accumulator
    policy.py      # R1-R10, action vocabulary, routing. No LLM.
    simulator.py   # grounded evidence-response simulator
    graph_rag.py   # vector retrieval over policy/patterns/regs/cases
    agent.py       # LangGraph state machine
    schema.py      # pydantic models of the answer format
    memory.py      # case write-back + retrieval
  api/             # FastAPI + SSE step stream + mock action APIs
  ui/              # Next.js analyst console
  cases/           # THE DELIVERABLE: HHG-001.json .. HHG-020.json
  exploration/     # optional: autonomous monitoring output, discovered rings
  eval/            # validator + calibration report
  docs/            # PRD.md, BUILD_PLAN.md
```

`.gitignore`: `data/*.csv`, `.env`, `__pycache__`, `node_modules`, `ui/.next`.

Two non-negotiables, written into the repo README on day one so nobody drifts:
1. **No answer field is ever produced by free-form LLM text.** IDs, amounts, actions, routes, and `sar.file` come from code. The LLM writes `summary`, `narrative`, `pattern_description`, and evidence `claim` strings only.
2. **Never open the public Kaggle IEEE-CIS files.** Explicit disqualification. Note it in the README so it is visibly deliberate.

**Exit test:** repo pushed, README states both rules.

---

## Step 1 — Know the data before you model it (1–2 h)

Do this in DuckDB, not TigerGraph. It is faster and you will use the same queries for the likelihood table later.

```bash
pip install duckdb pandas pyarrow
```

```python
import duckdb
con = duckdb.connect("data/sentinel.duckdb")
con.execute("CREATE VIEW txn AS SELECT * FROM read_csv_auto('data/transactions.csv', SAMPLE_SIZE=200000)")
con.execute("CREATE VIEW ident AS SELECT * FROM read_csv_auto('data/identity.csv')")
con.execute("CREATE VIEW cc AS SELECT * FROM read_csv_auto('data/closed_cases_history.csv')")
con.execute("CREATE VIEW pack AS SELECT * FROM read_csv_auto('data/case_pack.csv')")
```

Answer these eight questions and write the answers into `docs/DATA_NOTES.md`. They are what the rest of the build is parameterised on.

1. Cards per customer, transactions per card: distribution, and what "normal" activity volume looks like.
2. Channel split, and confirm `ProductCD = W` ⇔ no identity record ⇔ `in_person`.
3. Risk-score reliability: bucket `risk_score` in tenths, join to closed-case transactions, compute observed fraud rate per bucket. **This is your first ELT row and it tells you how much the score is worth.**
4. Amount distribution per card: compute median and p95 per card — this is `card_baseline`, precompute it as a parquet.
5. Device profiles: how many distinct `(DeviceInfo, id_30, id_31, id_33)` combinations, and the distribution of cards-per-profile. Find the tail: profiles touching many cards are your rings.
6. `id_15 = New` rate overall vs among confirmed-fraud transactions. First real LR.
7. Region novelty: for each card, the set of `addr1` values and how often a new one appears; and the `addr2 != 87` rate.
8. The `undocumented` closed cases: read all their `analyst_notes`. Cluster them. **This is where the sixth pattern is hiding.**

Also pull the twenty exam cases' flagged transactions and eyeball them next to their cards' baselines. You will already have opinions about half of them.

**Exit test:** `docs/DATA_NOTES.md` exists with numbers, and a risk-score reliability table you can read.

---

## Step 2 — TigerGraph up and schema created (1 h) — **DONE**

> Built against Savanna, not Docker: graph `GRAPH_GOA` on
> the Savanna workspace host in `.env`, TigerGraph 4.2.5. Schema is
> [graph/schema.gsql](../graph/schema.gsql) (12 vertex types, 20 edge types),
> created by `python scripts/load_to_tigergraph.py --schema-only`.
> Note `proxy` and `Case` are reserved GSQL keywords -- see
> [LOADING.md](LOADING.md). The original Docker instructions below stay as the
> offline fallback for demo day.

Community Edition in Docker is the right default — the demo must not depend on a cloud workspace waking up.

```bash
# after downloading the CE image from https://dl.tigergraph.com
docker load -i tigergraph-community-*.tar.gz
docker run -d -p 14022:22 -p 9000:9000 -p 14240:14240 --name tigergraph \
  --ulimit nofile=1000000:1000000 -v "$PWD/data":/home/tigergraph/mydata -t tigergraph/community:latest
docker exec -it tigergraph /bin/bash -c "gadmin start all"
```

Also create a Savanna workspace with auto-start/auto-stop enabled and load the same schema there — the brief asks for it, and it is your backup. Keep a single `TG_HOST` env var so you can switch.

`graph/schema.gsql` — create the vertices and edges from PRD §6.1/6.2. Sketch:

```gsql
CREATE GRAPH Sentinel()
USE GRAPH Sentinel
CREATE SCHEMA_CHANGE JOB init FOR GRAPH Sentinel {
  ADD VERTEX Customer(PRIMARY_ID customer_id STRING, n_cards INT, first_seen DATETIME, last_seen DATETIME);
  ADD VERTEX Card(PRIMARY_ID card_id STRING, customer_id STRING, network STRING, card_type STRING,
                  home_region STRING, median_amt DOUBLE, p95_amt DOUBLE, n_txns INT, top_products STRING);
  ADD VERTEX Transaction(PRIMARY_ID txn_id STRING, ts DATETIME, amt DOUBLE, product STRING,
                  channel STRING, risk_score DOUBLE, addr1 STRING, addr2 STRING, dist1 DOUBLE,
                  p_email STRING, r_email STRING, c_feats STRING, d_feats STRING, m_feats STRING, v_feats STRING);
  ADD VERTEX DeviceProfile(PRIMARY_ID device_key STRING, label STRING, device_type STRING, os STRING,
                  browser STRING, screen STRING, n_cards INT);
  ADD VERTEX BillingRegion(PRIMARY_ID region STRING, country STRING, n_cards INT);
  ADD VERTEX EmailDomain(PRIMARY_ID domain STRING);
  ADD VERTEX ProductCode(PRIMARY_ID product STRING, channel_class STRING);
  ADD VERTEX ClosedCase(PRIMARY_ID case_id STRING, outcome STRING, pattern STRING, opened_at DATETIME,
                  closed_at DATETIME, exposure DOUBLE, n_txns INT, actions STRING, report_filed STRING,
                  notes STRING, emb LIST<DOUBLE>);
  ADD VERTEX Case(PRIMARY_ID case_id STRING, source_case STRING, status STRING, verdict STRING,
                  probability DOUBLE, pattern STRING, exposure DOUBLE, summary STRING,
                  created_at DATETIME, emb LIST<DOUBLE>);
  ADD VERTEX PolicyDoc(PRIMARY_ID doc_id STRING, source STRING, section STRING, text STRING, emb LIST<DOUBLE>);

  ADD DIRECTED EDGE OWNS(FROM Customer, TO Card) WITH REVERSE_EDGE="OWNED_BY";
  ADD DIRECTED EDGE MADE(FROM Card, TO Transaction) WITH REVERSE_EDGE="MADE_BY";
  ADD DIRECTED EDGE NEXT(FROM Transaction, TO Transaction, gap_seconds INT) WITH REVERSE_EDGE="PREV";
  ADD DIRECTED EDGE FROM_DEVICE(FROM Transaction, TO DeviceProfile) WITH REVERSE_EDGE="DEVICE_USED_BY";
  ADD DIRECTED EDGE BILLED_IN(FROM Transaction, TO BillingRegion) WITH REVERSE_EDGE="REGION_OF";
  ADD DIRECTED EDGE PURCHASER_EMAIL(FROM Transaction, TO EmailDomain) WITH REVERSE_EDGE="P_EMAIL_OF";
  ADD DIRECTED EDGE RECIPIENT_EMAIL(FROM Transaction, TO EmailDomain) WITH REVERSE_EDGE="R_EMAIL_OF";
  ADD DIRECTED EDGE OF_PRODUCT(FROM Transaction, TO ProductCode) WITH REVERSE_EDGE="PRODUCT_OF";
  ADD DIRECTED EDGE CC_INVOLVES(FROM ClosedCase, TO Transaction) WITH REVERSE_EDGE="TXN_IN_CC";
  ADD DIRECTED EDGE CC_ON_CARD(FROM ClosedCase, TO Card) WITH REVERSE_EDGE="CARD_IN_CC";
  ADD DIRECTED EDGE CC_CONNECTED_TO(FROM ClosedCase, TO Card) WITH REVERSE_EDGE="CC_CONNECTS";
  ADD DIRECTED EDGE CASE_INVOLVES(FROM Case, TO Transaction) WITH REVERSE_EDGE="TXN_IN_CASE";
  ADD DIRECTED EDGE CASE_ON_CARD(FROM Case, TO Card) WITH REVERSE_EDGE="CARD_IN_CASE";
  ADD DIRECTED EDGE CASE_CONNECTED_TO(FROM Case, TO Card) WITH REVERSE_EDGE="CASE_CONNECTS";
  ADD DIRECTED EDGE CITES(FROM Case, TO ClosedCase) WITH REVERSE_EDGE="CITED_BY";
  ADD DIRECTED EDGE IMPLICATES(FROM Case, TO DeviceProfile) WITH REVERSE_EDGE="IMPLICATED_IN";
  ADD DIRECTED EDGE APPLIED_RULE(FROM Case, TO PolicyDoc) WITH REVERSE_EDGE="RULE_APPLIED_IN";
}
RUN SCHEMA_CHANGE JOB init
```

**Exit test:** `ls` in GraphStudio / `gsql -g Sentinel "ls"` shows every vertex and edge.

---

## Step 3 — Load the data (2–3 h, mostly waiting) — **DONE in 1.3 min**

> `python scripts/prepare_data.py` then `python scripts/load_to_tigergraph.py`.
> All 590,742 transactions, 14,317 cards, 9,704 device profiles, 5,565 closed
> cases and 20 alerts are loaded and verified against exact expected counts.
> The `card_id` rule had to be recovered empirically -- see
> [LOADING.md](LOADING.md). Details below describe what those scripts do.

**Pre-process first, load second.** Write `graph/loading/prepare.py` using DuckDB to emit narrow CSVs — this is where the column projection from PRD §6.3 happens, and it turns a 708 MB monster into four small files.

Emit:
- `customers.csv` — customer_id, n_cards, first_seen, last_seen
- `cards.csv` — card_id, customer_id, network, type, home_region (modal addr1), median_amt, p95_amt, n_txns, top_products
- `transactions_narrow.csv` — the projected columns, plus `device_key` computed as a stable hash of the four identity fields and `v_feats` as a JSON string of the retained V-subset
- `devices.csv`, `regions.csv`, `emails.csv`, `products.csv`
- `next_edges.csv` — computed with a window function over `(card_id, ts)`; do **not** try to build `NEXT` inside GSQL
- `closed_cases.csv` + `cc_edges.csv` — exploded from the pipe-separated `txn_ids`

Then a GSQL loading job per file (`USING SEPARATOR=",", HEADER="true", EOL="\n"`), run largest last. Watch for: `addr1` arrives as `444.0` — normalise to a consistent string form **everywhere** (it appears in trigger text as `444.0`), and keep timestamps in `YYYY-MM-DD HH:MM:SS`.

Load order: Customer, Card, DeviceProfile, BillingRegion, EmailDomain, ProductCode → Transaction → all edges → ClosedCase + its edges.

**Exit test — run all of these and sanity-check the numbers:**
```gsql
SELECT count(*) FROM Transaction     -- expect 590,742
SELECT count(*) FROM ClosedCase      -- expect 5,565
SELECT count(*) FROM DeviceProfile   -- compare to the DuckDB count from Step 1
```
And: pick `HHG-001`'s flagged transaction `3514030`, traverse to its card `C12382-K1`, to its customer, to its region. If that path works, the graph is real.

---

## Step 4 — Investigate one case by hand (2 h). Do not skip this. — **DONE**

> Done for HHG-003 against the live graph. Write-up and the detector list it
> produced: [HAND_INVESTIGATION.md](HAND_INVESTIGATION.md). The fixture is
> [cases/HHG-003.json](../cases/HHG-003.json), it passes `python -m eval.validate`
> including graph ID existence, and it is written into TigerGraph as
> `CASE-HHG-003`. Verdict `uncertain` at 0.32, no block, escalated under R8.

The README says to do it, and it is the single highest-leverage hour in the build. Pick **HHG-003** (a customer report, $49, card `C08623-K2`).

By hand, in GSQL and DuckDB:
- Pull the flagged transaction and the card's full history.
- Is $49 in line with this card's baseline? Same product code as usual?
- Is there a recurring charge for $49 on this card? (If there is, this is an R7 case and blocking is the wrong answer.)
- Online? New device? Proxy?
- Any other card on that device this month?
- Search `closed_cases_history.csv` notes for the nearest three cases.
- Now write `cases/HHG-003.json` by hand, in full, against the answer format.

That hand-written file is your **golden fixture**. The agent's job is to reproduce its shape, and your validator tests against it.

**Exit test:** `cases/HHG-003.json` exists, is schema-valid, and you can defend every field out loud.

---

## Step 5 — Tools layer: GSQL queries + MCP (4–6 h) — **DONE**

> 16 queries installed on GRAPH_GOA, wrapped in [sentinel/tools.py](../sentinel/tools.py)
> with the QueryLog that produces evidence `ref` strings, and exposed through
> tigergraph-mcp. `scripts/test_tools.py` passes 26 assertions against the hand
> investigation. Write-up, including the device-specificity bug the exit test
> caught: [TOOLS_AND_MCP.md](TOOLS_AND_MCP.md).

Write the sixteen queries from PRD §7.1 as installed GSQL queries in `graph/queries/`. Two worked shapes:

```gsql
CREATE QUERY card_window(STRING card_id, DATETIME center, INT hours) FOR GRAPH Sentinel {
  SetAccum<VERTEX<Transaction>> @@hits;
  Start = {Card.*};
  C = SELECT c FROM Start:c WHERE c.card_id == card_id;
  T = SELECT t FROM C:c -(MADE:e)- Transaction:t
      WHERE datetime_diff(t.ts, center) <= hours*3600
        AND datetime_diff(t.ts, center) >= -hours*3600
      ORDER BY t.ts ASC;
  PRINT T;
}

CREATE QUERY device_neighbors(STRING device_key, INT days, DATETIME center) FOR GRAPH Sentinel {
  D = {DeviceProfile.*};
  Dev = SELECT d FROM D:d WHERE d.device_key == device_key;
  Txns = SELECT t FROM Dev:d -(DEVICE_USED_BY:e)- Transaction:t
         WHERE abs(datetime_diff(t.ts, center)) <= days*86400;
  Cards = SELECT c FROM Txns:t -(MADE_BY:e)- Card:c ACCUM c.@n += 1;
  PRINT Cards, Txns;
}
```

Then expose them through **TigerGraph MCP** (https://github.com/tigergraph/tigergraph-mcp) and wrap each in a thin Python function in `sentinel/tools/` that (a) calls it, (b) appends `{tool, args, ref_string}` to the run's `QueryLog`, and (c) returns a typed result. The `ref_string` — e.g. `query:device_neighbors(device_key=D000731, days=30)` — is what lands in the answer file's `evidence[].ref`. Build it once, here, and explainability is free everywhere else.

For `ring_expand`, install TigerGraph's Louvain and WCC from the GDS library over a projection of cards connected by shared device / region / recipient email inside a 30-day window.

**Exit test:** a Python script calls all sixteen tools for `HHG-003` and prints results that match what you found by hand in Step 4.

---

## Step 6 — The reasoning core (4–6 h). Build in this order. — **6b/6c DONE**

> Evidence likelihood table fitted ([eval/fit_elt.py](../eval/fit_elt.py) ->
> `sentinel/elt.json`), ledger and policy engine written, 40 tests green.
> The comparison class had to be redesigned: see [CALIBRATION.md](CALIBRATION.md).
> Still to do: 6d GraphRAG, 6e the evidence simulator. 6a is covered by
> [eval/validate.py](../eval/validate.py) rather than a separate pydantic module.

### 6a. `schema.py` — pydantic models of the answer format, first

Model the top level, `case`, `evidence_requests`, `next_best_actions`, `sar`. Enums for `status`, `verdict`, `pattern`, `action`, `route`, `source`. Add validators:
- `sar.file == ("FILE_REPORT" in final actions)`
- verdict `legitimate` → `affected_txn_ids == []`, `exposure_usd == 0`, `sar.file == False`
- `pattern == "undocumented"` → `pattern_description` non-empty
- `exposure_usd` equals the summed absolute amounts of `affected_txn_ids`, recomputed from the graph
- every ID exists in the graph

Validate the hand-written `HHG-003.json` against it. Fix whichever is wrong.

### 6b. `ledger.py` — the evidence likelihood table

Offline fit (`eval/fit_elt.py`): for each feature, count occurrences among confirmed-fraud case transactions vs cleared-case and background transactions, compute LR with Wilson-interval shrinkage toward 1, write `sentinel/elt.json`. Online:

```python
class Ledger:
    def __init__(self, prior_odds): self.log_odds = log(prior_odds); self.trail = []
    def post(self, feature, present, evidence_claim, ref, entity_ids, group=None):
        lr = ELT.lookup(feature, present, group_cap=self.group_used(group))
        before = self.p
        self.log_odds += log(lr)
        self.trail.append(Step(feature, lr, before, self.p, evidence_claim, ref, entity_ids))
    @property
    def p(self): return 1/(1+exp(-self.log_odds))
```

The `trail` is simultaneously the probability trajectory, the UI timeline, and the `evidence` list. One data structure, three deliverables.

### 6c. `policy.py` — the rule engine

Transcribe the action table, the routing table, and R1–R10 into code. Then write `tests/test_policy.py` with **one test per rule**, including the negative cases:
- R1: single signal, p = 0.65 → asserts no `BLOCK_CARD` in initial actions
- R2: customer denies, exposure $1,200 → `BLOCK_CARD` + `CREATE_CASE` + `FILE_REPORT`
- R5: testing sequence, cleared purchase $150 → `BLOCK_CARD` present
- R7: recurring match disputed → `CREATE_CASE` + `VERIFY_WITH_CUSTOMER` + `WARN_CUSTOMER`, and **no block**
- R8: uncertain, exposure $700 → `ESCALATE_TO_ANALYST`
- R10: one card compromised → `BLOCK_ALL_CARDS` absent
- routing: `BLOCK_CARD` at $2,400 → `L1`; at $2,600 → `L2`

These tests are worth more to the score than any prompt you will write.

### 6d. `graph_rag.py`

Chunk and embed: the fraud policy (by rule), the five pattern descriptions, the README's data notes, the FinCEN SAR narrative guidance and the FFIEC red-flag appendix (download the PDFs listed in the README), and all 5,565 closed-case narratives. Store as `emb` attributes; retrieve with TigerGraph vector search, cosine kNN as fallback. **Retrieval is hybrid**: vector similarity *plus* structural filters (same pattern, similar exposure band, overlapping device or region) — a graph database should not be doing pure vector search.

### 6e. `simulator.py`

Implement the four branches from PRD §7.4 as pure functions over ledger state. Return `(assumed_response, basis, feature_updates)`.

**Exit test:** `pytest` green, and the policy engine reproduces the action list of your hand-written HHG-003.

---

## Step 7 — The agent, and all twenty answers (4–6 h)

`agent.py` as a LangGraph state machine. Nodes:

| Node | Does | LLM? |
|---|---|---|
| `scope` | Parse trigger, set prior odds, resolve card/customer/txn, fetch baseline | No |
| `plan` | Choose which detectors to run given trigger type and early findings | Yes (tool selection) |
| `sweep` | Run detectors; post each result to the ledger | No |
| `recall` | Hybrid retrieval of prior cases; post base-rate evidence | No |
| `assess` | Synthesise findings into claims; name the pattern; write summary | Yes |
| `stop_test` | Policy §6 check | No |
| `request_evidence` | Pick request type, call simulator, post response to ledger | Mixed |
| `decide` | Policy engine → initial and final actions | No |
| `narrate` | SAR narrative when `sar.file`, plus `what_changed`, `stop_reason` | Yes |
| `write` | Validate, emit JSON, `write_case` into the graph, embed | No |

Loop guards: max 25 tool calls, max one evidence-request round (the format has exactly `initial` and `final`), hard timeout. Record `tool_calls`, `tokens`, `latency_s` honestly — they are fields in the answer file.

**Order the run so memory shows.** Process the twenty cases in chronological `opened_at` order, writing each `Case` back before the next starts. Then a later case can and will cite an earlier Sentinel case in `similar_prior_cases`. Say this in the demo; it is the difference between claiming memory and demonstrating it.

```bash
python -m sentinel run --all --order chronological --out cases/
python -m eval.validate cases/        # schema + ID existence + consistency
python -m eval.report cases/          # verdict mix, block rate, probability histogram
```

**Exit test — the submission gate:**
- Twenty files present, all schema-valid, zero unknown IDs.
- Verdict mix is not lopsided. If 18 of 20 are `fraud`, the agent is over-blocking; go back to the ledger priors, not to the prompt.
- At least a few cases have a genuine `initial` ≠ `final`.
- `probability` histogram is spread, not piled at 0.85.

**At this point you have a submittable entry. Commit and tag it `v1-submittable`.** Everything below is upside.

---

## Step 8 — Analyst console (5–7 h)

FastAPI backend: `GET /cases`, `GET /cases/{id}`, `POST /investigate/{id}` streaming agent steps over SSE, `POST /actions/execute` (auto only — returns 403 with the required route for L1/L2), `GET /approvals`, `POST /approvals/{id}/approve`, `GET /graph/{case_id}` returning the focused subgraph.

Next.js frontend, the three panes from PRD §8. Build in this order, because each stage is independently demoable:
1. Case list + case detail rendering the JSON that already exists. (Demoable immediately.)
2. Live investigation: SSE steps into the timeline, probability sparkline animating.
3. Action panel with route badges, execute vs "requires approval", and the initial/final diff.
4. Approval inbox with role switcher (analyst / team lead / fraud manager) — this is how you *show* the permission boundary rather than assert it.
5. Graph canvas (React Flow) from `/graph/{case_id}`.
6. SAR tab and memory tab.

Mock action APIs (`block_card`, `send_message`, `step_up`, `file_report`) log to an audit table that the UI shows — "actions may be simulated" per the brief, but the audit trail should look real.

**Exit test:** you can run a case end to end in the browser, get blocked on an L2 action, switch role, approve it, and watch the case close.

---

## Step 9 — The upside work (4–6 h)

In priority order — do as many as the clock allows:

1. **Calibration review.** Read all twenty outputs yourself. For each, ask: would I defend this to a fraud manager? Adjust ELT weights where the answer is no. This is the highest-value hour remaining and it is pure judgement, not code.
2. **Ring discovery + autonomous mode.** Run Louvain over the Nov–Dec window, find components, and have the agent self-trigger on the top alerts outside the twenty. Output to `exploration/`. Innovation points, explicitly invited by the README.
3. **Undocumented pattern write-up.** If the `undocumented` closed cases cluster (Step 1, question 8), name the pattern, document its signature in `docs/PATTERNS.md`, and add a detector for it.
4. **Counterfactual panel.** For each case, show what would flip the verdict ("if the customer confirms, this becomes `CLOSE_NO_FRAUD`"). Cheap to compute from the ledger, and it reads as very sophisticated.

---

## Step 10 — Ship (3–4 h)

1. **Repo polish.** README: one-paragraph pitch, architecture diagram, setup in under ten minutes, schema diagram, how to run the twenty cases, how to run the tests. A judge who cannot start it in ten minutes stops reading.
2. **Demo video, 3–5 min.** Script in PRD §11. Record locally against Docker, not Savanna. Rehearse twice; record on the third take. No dead air while a query runs — pre-warm every case you will show.
3. **Blog post.** Cover the required six sections. Make the *technical* argument the centrepiece: the likelihood-ratio ledger fitted on closed cases, policy-as-code as a permission boundary, and memory as graph edges rather than a vector blob. Include the Act II case — the 0.90 score the graph exonerated — with real numbers. That is the story people remember.
4. **Social post.** X or LinkedIn, tag `@TigerGraphDB`, link the blog, embed a fifteen-second clip of Act II.
5. **Final check against the brief:** twenty JSON files ✓, cases written to graph ✓, SARs where policy requires ✓, initial and final next-best-actions with routes ✓, working agent ✓, repo ✓, video ✓, blog ✓, social ✓.

---

## The three things that decide whether this wins

1. **Getting the legitimate cases right.** Half the pack is legitimate and most teams will block them. Every hour spent on the recurring-charge probe, the trip-not-clone region check, and honest low probabilities is worth more than an hour on the fraud path.
2. **The policy engine being code.** Judges score action quality and route correctness at 25%. A deterministic, tested engine cannot get a route wrong. A prompt will, on case 14, at the worst moment.
3. **Showing memory compound inside the run.** Anyone can retrieve closed cases. Running the twenty in chronological order so case 19 cites a case *your agent wrote* on case 6 is a thirty-second demo beat that proves the whole architecture.
