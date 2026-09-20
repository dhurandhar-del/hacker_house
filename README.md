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
| [Guide.md](Guide.md) | **The organiser's brief** — the spec this build answers to. Described [below](#guidemd--the-organisers-brief) |
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

## Guide.md — the organiser's brief

[Guide.md](Guide.md) is the specification this entire build answers to. It is the
document the organisers supplied, and it is the authority whenever anything in
this repo disagrees with it. Read it before reading the code.

It sets out how the application must behave, the resources available, the
vocabulary, the data, and the sequence of steps the agent has to perform.

| Section in Guide.md | What it gives you |
|---|---|
| **The task** | What the agent must produce for each of the 20 cases: a case record, a SAR when policy demands one, and a next-best-action recorded both **before and after** evidence is requested |
| **Your first two hours** | The recommended order of work — load the graph, connect MCP, then **investigate one case by hand before writing any agent code** |
| **Glossary** | Binding definitions: risk score, closed case, trigger, pattern, channel, exposure, case vs SAR, approval route, MCP, GraphRAG |
| **Files in this folder** | The four dataset files and what each contains |
| **The original columns** | Vesta's column groups. The `C`, `D`, `M`, `V` and numeric `id` families are real model features with **no published names**, to be cited honestly as such |
| **The columns we added** | `customer_id`, `ts`, `channel`, `risk_score` — with the warning that the score is an input, never an answer |
| **The five known fraud patterns** | Card testing, card-not-present, CNP from a new device, out-of-region use, account takeover. Explicitly **not** an exhaustive list; spotting an undocumented one is scored |
| **Regulatory references** | FinCEN, FATF, FFIEC and OFAC sources, including the SAR narrative standard the `sar.narrative` field is judged against |
| **Things to know** | The traps, stated plainly: half the cases are legitimate, an agent that blocks everything scores badly, devices and regions connect people |
| **Rules** | Including the disqualifying one: never use the public IEEE-CIS / Kaggle files to recover outcomes |
| **Suggested graph schema** | A starting point the organisers expect you to change; schema design is part of the engineering |
| **Fraud Policy** | Rules R1–R10, the 14 action identifiers, and the `auto` / `L1` / `L2` routing table. **Action names and routes in answer files must match these exactly** |
| **Answer Format** | The JSON contract for all 20 files, field by field, with a worked example. Missing fields score zero for that part |
| **The 20 cases** | The exam: case id, trigger, flagged transaction, card, customer and score |

### The sequence the agent must perform

As the brief defines it:

**trigger → investigate → gather evidence → assess uncertainty → gather more
evidence if needed → take one or more next actions → explain the decision →
update case memory**

### Where this repo implements it

| Brief requires | Implemented in |
|---|---|
| Load the graph, GSQL, graph algorithms | [graph/schema.gsql](graph/schema.gsql), [scripts/load_to_tigergraph.py](scripts/load_to_tigergraph.py) |
| Expose the graph to the agent via MCP | [graph/queries/sentinel_queries.gsql](graph/queries/sentinel_queries.gsql), [sentinel/tools.py](sentinel/tools.py), `.mcp.json` |
| Assess risk, honestly calibrated | [sentinel/ledger.py](sentinel/ledger.py), [eval/fit_elt.py](eval/fit_elt.py) |
| Fraud Policy R1–R10, actions, approval routes | [sentinel/policy.py](sentinel/policy.py), tested in [tests/test_policy.py](tests/test_policy.py) |
| Case memory written to the graph | [sentinel/memory.py](sentinel/memory.py) |
| Answer-file contract, every ID real | [eval/validate.py](eval/validate.py) |
| Investigate one case by hand first | [docs/HAND_INVESTIGATION.md](docs/HAND_INVESTIGATION.md), [cases/HHG-003.json](cases/HHG-003.json) |

Design and plan: [docs/PRD.md](docs/PRD.md) and
[docs/BUILD_PLAN.md](docs/BUILD_PLAN.md). Current state:
[docs/SESSION_SUMMARY.md](docs/SESSION_SUMMARY.md).

## The dataset

IEEE-CIS Fraud Detection (Vesta Corporation), repackaged by TigerGraph for
Hacker House Goa 2026: 590,742 transactions over six months from 13,553
customers, 144,432 identity records, 5,565 closed investigations, and 20 exam
alerts. Every transaction carries a risk score from the bank's model and there
is no fraud label.

| File | Size | In this repo | What it is |
|---|---|---|---|
| [Guide.md](Guide.md) | 39 KB | yes | **The organiser's brief.** Task, glossary, column reference, the five fraud patterns, regulatory sources, the Fraud Policy (R1-R10, action names, approval routes) and the answer-file contract. The authority for everything here |
| [case_pack.csv](case_pack.csv) | 4 KB | yes | The 20 exam alerts: case id, trigger type and text, flagged transaction, card, customer, risk score |
| [closed_cases_history.csv](closed_cases_history.csv) | 2.7 MB | yes | 5,565 finished investigations, July-October. 4,665 confirmed fraud, 900 cleared. The only place ground truth is written down, and the agent's starting memory |
| [identity.csv](identity.csv) | 27 MB | yes | 144,432 device and connection records, online transactions only, joined on `TransactionID` |
| `transactions.csv` | **708 MB** | **no** | 590,742 transactions, all 393 Vesta columns plus `customer_id`, `ts`, `channel`, `risk_score`. Too large for GitHub (see below) |

### Getting `transactions.csv`

GitHub rejects any file over 100 MB, so the 708 MB transaction file is not in
this repo. Download it from the organiser's dataset link and drop it in the
repository root; everything else is here. Then:

```bash
python scripts/prepare_data.py          # -> data/staging/*.csv, ~10 s
python scripts/load_to_tigergraph.py    # schema, jobs, load, verify
```

`prepare_data.py` reads all four files and regenerates every staging artefact,
so nothing derived needs to be version-controlled.

Roughly half the exam cases are legitimate, and an agent that blocks everything
scores badly. That constraint drives most of the design.
