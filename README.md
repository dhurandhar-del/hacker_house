# Sentinel — Agentic Fraud Investigation on TigerGraph

An AI agent that investigates fraud alerts against a TigerGraph knowledge graph,
accumulates evidence into a calibrated probability ledger, decides under a
deterministic policy engine when it has enough to act, requests more evidence when
it does not, and produces a case file, a next-best-action pair, and a suspicious
activity report when policy requires one.

Built for the TigerGraph Agentic Fraud Investigation challenge, Hacker House Goa.

## Where things are

| Path | What |
|---|---|
| [docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md) | Everything built so far, and what is left |
| [docs/PRD.md](docs/PRD.md) | The product: problem, principles, architecture, graph model, intelligence layer, UI, scoring map |
| [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) | Eleven build steps, each with an exit test |
| [docs/LOADING.md](docs/LOADING.md) | How the data gets into TigerGraph, and what had to be derived |
| [docs/HAND_INVESTIGATION.md](docs/HAND_INVESTIGATION.md) | HHG-003 worked by hand, and the detector list it produced |
| [docs/TOOLS_AND_MCP.md](docs/TOOLS_AND_MCP.md) | The 16 GSQL queries and the MCP wiring |
| [docs/CALIBRATION.md](docs/CALIBRATION.md) | How fraud_probability is fitted, and the selection-bias trap |
| [graph/schema.gsql](graph/schema.gsql) | 12 vertex types, 20 edge types |
| [graph/loading_jobs.gsql](graph/loading_jobs.gsql) | 13 loading jobs |
| [graph/queries/sentinel_queries.gsql](graph/queries/sentinel_queries.gsql) | The agent's 16 graph tools |
| [sentinel/tools.py](sentinel/tools.py) | Python wrappers + QueryLog that builds evidence citations |
| [scripts/prepare_data.py](scripts/prepare_data.py) | Raw CSVs -> narrow staging files, with integrity checks |
| [scripts/load_to_tigergraph.py](scripts/load_to_tigergraph.py) | Schema, jobs, chunked upload, verification |
| [eval/validate.py](eval/validate.py) | Format, policy-routing and graph-ID validation of answer files |
| [sentinel/ledger.py](sentinel/ledger.py) | Log-odds evidence ledger with group caps |
| [sentinel/policy.py](sentinel/policy.py) | Rules R1-R10 as tested code, no LLM |
| [tests/test_policy.py](tests/test_policy.py) | 40 tests, one per rule plus negatives |
| [sentinel/memory.py](sentinel/memory.py) | Writing finished cases back into the graph |
| `cases/` | The deliverable: one answer JSON per exam case (1 of 20 done) |

## Setup

```bash
pip install pyTigerGraph duckdb python-dotenv pandas
cp .env.example .env        # then fill in TG_HOST, TG_SECRET, TG_GRAPH
python scripts/prepare_data.py
python scripts/load_to_tigergraph.py
```

Full detail, including the three TigerGraph 4.2.5 quirks that cost time, is in
[docs/LOADING.md](docs/LOADING.md).

## Two rules this repo holds to

**1. No answer field is produced by free-form LLM text.** Transaction IDs, card IDs,
amounts, exposure, action names, approval routes and the SAR filing decision all come
from code — a GSQL query or the policy engine. The LLM writes prose: the case summary,
the SAR narrative, the pattern description, and the evidence claim strings. Every ID
in an answer file is checked to exist in the graph before the file is written.

**2. The public IEEE-CIS / Kaggle files are never opened.** IDs, times and amounts in
this dataset were transformed specifically so outcomes cannot be looked up there.
Using them is explicit disqualification.

## Data

IEEE-CIS Fraud Detection (Vesta Corporation), as repackaged by TigerGraph for
Hacker House Goa 2026: 590,742 transactions over six months from 13,553 customers,
144,432 identity records, 5,565 closed investigations, and 20 exam alerts. Every
transaction carries a risk score from the bank's model and no fraud label.

The raw CSVs are gitignored. Roughly half the exam cases are legitimate, and an agent
that blocks everything scores badly — that constraint drives most of the design.
