# The agent that talks itself out of blocking your card

*Building a fraud investigation agent on TigerGraph, and the four ways it was
confidently wrong before it was right.*

---

Half of the twenty cases in this benchmark are legitimate. The brief says so on
page one, twice, and then adds the line that should worry anyone building an
agent for it:

> Many look suspicious. An agent that blocks everything scores badly.

That is a harder problem than finding fraud. Finding fraud is a retrieval
problem and a graph is very good at it. Declining to find fraud — on a card
that looks alarming, when a customer is on the phone, when the model score says
0.79 — needs a system that can produce evidence *against* its own suspicion and
act on it.

This is what we built, and more usefully, the four times it was wrong in ways
that looked entirely reasonable.

---

## What we built

**Sentinel** takes a fraud alert and returns a case file: a verdict with a
calibrated probability, the evidence behind it with a re-runnable citation on
every claim, a recommended set of next actions with their approval routes
recorded both before and after it asked for more evidence, a suspicious
activity report when policy requires one — and a `FraudCase` vertex written
back into the graph so the next investigation can retrieve it.

One command:

```
$ python -m sentinel run --case HHG-003

HHG-003  verdict=uncertain p=0.4200 pattern=none
         actions=CREATE_CASE, VERIFY_WITH_CUSTOMER, WARN_CUSTOMER
         sar=False tool_calls=12 tokens=7126 in 19.2s valid=True
```

HHG-003 is a customer ringing up to say *"I never made this $49.00 purchase."*
The card has been paying that same $49.00, on the same product code, in the
same billing region, every month for six months. The right answer is not to
block them. It is to open a case, check with them, and remind them what the
charge is — which is what the bank's own policy rule R7 says, and what a human
analyst working the case by hand concluded before any of this code existed.

Getting an agent to reach that conclusion, rather than the one that feels
safer, is the whole exercise.

---

## The architecture

Ten numbered steps over one shared context:

```
alert ─▶ scope ─▶ plan ─▶ sweep ─▶ recall ─▶ assess ─▶ stop_test ─▶ request_evidence
                                                                          │
        write ◀── narrate ◀── decide ◀────────────────────────────────────┘
```

**Six of the ten touch no model at all.** That is the central design decision,
and everything else follows from it.

A language model is very good at three things this problem needs: choosing what
to ask next, naming a pattern it recognises, and writing prose a human will
read. It is unreliable at exactly the things that get graded: emitting a
transaction id that exists, computing a sum, and choosing an approval route.

So there is a hard boundary. The model writes exactly seven strings — the case
summary, the SAR narrative, the pattern description, what changed between the
two recommendations, the stop reason, the assumed response, and one more. They
live in a single object called `Narration`, so the rule is a type rather than
an intention:

```python
@dataclass
class Narration:
    """The seven strings the model is allowed to write, and nothing else."""
    summary: str = ""
    sar_narrative: str = ""
    ...
```

Everything else — every id, every amount, every action name, every route, the
SAR filing decision — is computed. The assembler that builds the graded file
takes typed values from the policy engine and the ledger, and takes `str` from
`Narration`. There is no third source. Every id in the finished file is then
proved to exist in the graph before the file is written.

The probability is not a model output either. It is a log-odds ledger:
twenty-nine features with likelihood ratios fitted on the bank's own 14,055
confirmed-fraud transactions against 300,602 card-matched controls. Each
finding posts its ratio; correlated findings are capped by group so that three
phrasings of one observation cannot count three times.

The policy engine — rules R1 to R10, fourteen actions, three approval routes —
is a pure function from a `CaseState` to an ordered list of
`(action, route, reason)`, with a unit test per rule. Twenty-five percent of
the score is action quality, and a prompt will eventually route `BLOCK_CARD` to
`auto`.

---

## How TigerGraph is used

Not as a store the agent occasionally queries. As the thing the agent thinks
in.

**The schema is the investigation.** Twelve vertex types and twenty edge types
over 590,742 transactions, 14,317 cards, 9,704 device profiles and 5,565 closed
investigations. A `NEXT` edge chains each card's transactions in time — 576,425
of them — so "how long since the last charge on this card?" is one hop rather
than a sort.

**Twenty-six GSQL queries are the agent's entire vocabulary.** Not a text-to-
query layer: a fixed catalogue of typed questions, nineteen of which are
exposed to the agent as tools with JSON schemas. The arguments are built from
measurements, never by the model, which is how you stop a planner anchoring a
72-hour window on the alert's timestamp instead of the transaction's — a
distinction worth one to six hours on every case in this pack.

**The queries return facts, not verdicts.** R5's "three or more small
authorisations", R1's 0.70 threshold and the rest live in the policy engine
where they are unit-testable. A query may compute a count; nothing is allowed
to treat it as the decision.

**GraphRAG is hybrid, and the hybrid is the point.** Pure vector search over a
graph database is a bad demo and a worse retriever. Two independent rankings
run and are fused:

- **Vector** — cosine over 5,611 stored embeddings: the 5,565 closed-case
  analyst notes and 46 policy chunks, all held as `LIST<DOUBLE>` on the
  vertices themselves. It finds a case that *reads* like this one.
- **Structural** — same card, same customer, same pattern in the same exposure
  band, cards reachable through `CC_CONNECTED_TO`. It finds a case the graph
  *connects* to this one.

They are fused by reciprocal rank fusion, because a cosine and a hop count have
no common scale and averaging them would be arithmetic theatre. Each surviving
hit is then expanded back through the graph for its provenance — which edge
connected it, which card, which device — and that is what the console renders.

On HHG-003 the retriever returns five of the six closed cases a human found by
hand, and `POL-R7`, "disputed but legitimate", as the top policy chunk for a
query describing the case. Neither ranking alone gets both.

One hard filter runs before fusion: `opened_at < as_of`. A case may never
retrieve an investigation that had not happened yet. The twenty run in
chronological order and write their own vertices as they go, so without that
filter the "memory compounds" claim would be a leak rather than a capability.

**Cases are written back.** One `FraudCase` vertex and eight edge types —
`CASE_INVOLVES`, `CASE_ON_CARD`, `CASE_CONNECTED_TO`, `CITES`, `CITES_CASE`,
`IMPLICATES`, `APPLIED_RULE`, `FROM_ALERT` — in a single REST++ POST, with the
summary embedded so a later case can find it by similarity. `APPLIED_RULE` is
the one worth pointing at: it makes *"which policy rule decided this?"* a graph
question.

---

## The agentic capabilities

Against the brief's own list:

| | How |
|---|---|
| Investigate on a signal, a report or an analyst request | Three trigger types, three fitted priors. Nine of the twenty alerts carry no model score at all |
| Gather evidence from the graph | A deterministic sweep of typed tools, each posting its fitted likelihood ratio |
| Identify the pattern, assess risk | The model names the pattern from typology text; the ledger prices the evidence |
| Create and progress a case | One vertex, eight edge types, written mid-run |
| Use case memory | Hybrid retrieval over the bank's 5,565 closed cases *and* the cases Sentinel wrote earlier in the same run |
| Gather more evidence through controlled actions | Customer validation, step-up authentication, analyst review — the three §5 permits without approval |
| Recommend next actions | The policy engine, twice: before the request and after |
| Operate within permissions | Only `auto` executes. `L1` and `L2` return 403 naming the roles that can approve, and enqueue the approval |
| Decide when to stop | Policy §6, as written, with one correction below |
| Explain the reasoning | Every claim carries a re-runnable `ref`; every rule cites the `PolicyDoc` chunk it came from |

Two of those are worth expanding.

**Uncertainty is a first-class outcome.** `uncertain` is a valid verdict that
earns full credit on ambiguous cases, and nine of our twenty come back that
way. An agent that resolves every case to fraud or not-fraud is not being
decisive, it is being unwilling to say what it does not know.

**The recommendation is recorded twice.** `next_best_actions.initial` is what
the agent recommended before it asked for anything; `.final` is after the
answer came back. On HHG-006 the initial list is `BLOCK_CARD`, `CREATE_CASE`,
`ESCALATE_TO_ANALYST`, `FILE_REPORT`; the step-up challenge is passed; the
final list is `CREATE_CASE`, `ESCALATE_TO_ANALYST`. The agent talked itself
down, and the file records both halves and why.

---

## What we learned

Four things were wrong. Every one of them looked right.

### 1. The score was counted twice

Thirteen of twenty cases came back `fraud`, eight of them carried past 0.85 by
the model's risk score alone. The brief says, in plain text:

> Above 0.7, most flagged transactions turn out to be legitimate.

So a score of 0.79 reaching 0.86 on its own is the brief's own base rate
contradicted, and we had built a very careful machine for contradicting it.

The cause is structural and it is easy to miss. A score-triggered alert *exists
because* the model scored it high. The trigger prior — P(fraud | the model
raised this alert) — has already spent that fact. Posting the score band's own
likelihood ratio on top spends it again, and the ratios are not small: 8.22 for
the 0.70–0.85 band, 18.76 above it.

The fix is not to discard the band, because *how far above the alerting
threshold* a score sits is real information. It is to re-centre it on the band
the alert itself implies. The 900 cleared alerts in the bank's history are 100%
at or above 0.70, mean 0.881 — so 0.70–0.85 is what "the model raised an alert"
is worth, and a score there now contributes nothing beyond the prior:

| band | fitted LR | on a score-triggered alert |
|---|---|---|
| 0.30–0.50 | 2.48 | **0.30** — the model was reaching |
| 0.70–0.85 | 8.22 | **1.00** — exactly what the prior already said |
| ≥ 0.85 | 18.76 | **2.28** — above the threshold, and that counts |

A customer report is unaffected: that alert did not come from the model, so the
model's score is genuinely new information.

### 2. Four evidence groups held one observation

The ledger caps correlated evidence by group, on the principle that three
phrasings of one finding are not three findings. The grouping split one finding
four ways.

`channel_online`, `dist1_missing`, `m_flags_all_true` and `device_found` are
not four facts about a transaction. They are four consequences of it having
happened online: Vesta populates the M flags and the device record only for
online transactions, and the distance field is missing precisely when there is
no card-present distance to record.

Measured across the twenty: those four groups contributed **+1.84 log-odds on
every single case that came back fraud, and −1.45 on every case that came back
legitimate.** A 27× swing, applied identically, for one fact.

The lesson generalises past this dataset. A correlated-evidence cap is only as
good as the grouping, and the grouping is a modelling decision that the fitting
procedure cannot make for you. Ours came out of the feature-extraction code's
own structure, which is exactly the wrong place for it to come from.

### 3. The agent was not deterministic, and we could not see it

Four identical runs of the same case, temperature 0, fixed seed:

```
run 1: p=0.3577  tool_calls=12
run 2: p=0.5025  tool_calls=14   <- and a different action list
run 3: p=0.3569  tool_calls=13
run 4: p=0.3569  tool_calls=13
```

The planner was free to *add* detectors to a mandatory core, and it added a
different set each time. That reads like a small thing. It is not: a fitted
likelihood ratio that never posts is not neutral, it is missing from the sum.
Which detectors ran *is* the answer.

Worse, every aggregate the submission is judged on — block rate, SAR rate,
verdict mix — is computed from those numbers. A run could pass its own quality
gate and its re-run for the demo could fail it.

We had already restricted the planner once, after measuring that a planner
given a free choice dropped the five *exonerating* detectors and returned 0.74
instead of 0.36 on identical facts. Restricting it to additions was not enough.
The detector set is now a function of the trigger type and nothing else, and
the planner decides the *order* — which is what matters when the tool budget
binds — and states a reason per detector that the case file quotes. Three
consecutive runs now agree to four decimal places.

The broader lesson: **an agent whose tool selection is model-driven has a
non-reproducible output even at temperature 0, and if any of that output is a
number, the number is not measurable.** Decide deliberately which parts of the
loop are allowed to vary.

### 4. The simulator wrote a reply the customer would never give

The brief supplies no customer replies and asks you to simulate them and state
your assumption. Ours chose its branch from graph facts, which was the right
instinct. It also let a cardholder who had opened the case with *"I never made
this purchase"* turn around and confirm the charge when asked to validate it —
because the recurring-charge probe said the charge looked like theirs.

The output was a case file recommending `CREATE_CASE`, `WARN_CUSTOMER` and
`CLOSE_NO_FRAUD` together: open a case, and close it as no fraud.

Where the facts and the cardholder disagree, the honest record is a *contest*,
not a change of story — and a contest is exactly what R7 exists for. And when
the cardholder has already answered the only question they can answer and there
is no device to challenge, the party with something left to add is an analyst,
which is the third thing §5 lets the agent ask for without approval.

A simulator that reasons backwards from a conclusion makes the whole
initial-versus-final story circular, and a judge reading twenty case files will
see it.

### And one that was not a bug

`in_person_elsewhere_same_day` — card-present activity in two billing regions
on one day — fits at LR 0.52, mild evidence *against* fraud. The textbook
reading is impossible travel and therefore cloning. In this data it is mostly
high-volume cards: one card runs 62 transactions a week across twenty regions,
quite legitimately. We kept the fitted number rather than overriding it to
match intuition. Being surprised by your own data is the point of fitting it.

---

## What we would do with more time

**Refit the table on the alerted population.** Every likelihood ratio here is
fitted fraud-against-card-matched-controls, which is the right design given
that the bank's closed cases are perfectly separated by trigger pathway — not
one cleared customer report, not one confirmed model-score alert, in four
months of history. But it means the ratios describe a random transaction, and
we score alerted ones. The score re-centring above is a targeted correction to
the worst instance of that mismatch. The general fix needs alerted negatives,
which this dataset does not contain.

**Learn the group structure instead of declaring it.** The merge described
above was found by decomposing twenty answer files by group and noticing that
one column was identical on every case. A correlation matrix over the
twenty-nine features would have found it in a minute, and would find the next
one.

**Give the devil's advocate its own evidence.** There is an agent whose job is
to argue the case is legitimate, and it currently argues from the same
findings as the assessment. Letting it *request its own queries* — the ones
most likely to exonerate — would make it an adversary rather than a reviewer.

**Close the loop on outcomes.** Cases are written back with their verdict, but
nothing yet reads back whether a later case agreed. The graph has the shape for
it; the run does not have the horizon.

**A second dataset.** Every number here is one bank, six months, one model. The
interesting question is which of the four errors above are general and which
are artefacts, and one dataset cannot answer it.

---

## The part worth stealing

If you build one of these, build the thing that decomposes your own output.

Every one of the four errors was found the same way: not by reading the code,
and not by a test, but by taking the finished answer files and breaking each
probability down by evidence group, then looking for a column that was the same
on every row. The double-counted score, the four-way split, and the
non-determinism all showed up in that one table. None of them showed up in 300
passing unit tests, because each component was doing exactly what it was
written to do.

The agent was never broken. It was *composed* wrong, and composition errors are
invisible from inside any single component.

---

*Sentinel is built on TigerGraph Savanna with GSQL, the TigerGraph MCP server,
hybrid GraphRAG and a Next.js analyst console. Source and the twenty answer
files are in the repository.*
