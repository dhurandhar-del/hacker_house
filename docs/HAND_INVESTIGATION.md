# Hand investigation: HHG-003

Step 4 of the build plan, done before any agent code. The output is
[cases/HHG-003.json](../cases/HHG-003.json), the golden fixture the agent has to
reproduce, plus the list of detectors below — which is really what this exercise
was for.

## The alert

> Customer C08623: *"I never made this $49.00 purchase. Please check my card."*
> Transaction 3530164, card C08623-K2, opened 2016-12-10 15:01:21.

## What the graph said

Seventeen queries, in the order a human would actually ask them.

**The charge itself.** $49.00, product W, therefore card-present and carrying no
identity record — no device or proxy evidence exists for it at all. Billing region
330.0, country 87, risk score 0.40.

**Is this normal for the card?** Emphatically yes.

| Question | Answer as of the alert |
|---|---|
| Prior transactions in region 330.0 | 42, first on 2016-07-09, 5 in the same week |
| Prior charges between $48.50 and $49.50 | 53 |
| Card median / p95 amount | $68.01 / $425.66 — the charge is *below* median |
| Channel mix | 1,080 of 1,134 in person |
| Transactions before this one | 980, across 54 regions |

So the first read is: unremarkable. A card that runs ~5 transactions a day across
54 regions made another $49 in-person purchase somewhere it shops constantly.

**Then the prior cases turned it around.** This customer has six closed cases.
Five are confirmed fraud on this very card; four of those are `out_of_region_use`.
And every single time this cardholder reported unrecognized activity, the bank
confirmed fraud — **five denials, five confirmations**. A denial from this person
is not a weak signal.

**And a neighbour.** Transaction 3530056: $116.93, same region 330.0, 49 minutes
earlier, **risk 0.88** — the highest-scoring transaction on this card that week.

**But the fraud signature does not match.** All four prior `out_of_region_use`
frauds were card-present use in regions with *no* history (126.0, 387.0, 158.0,
272.0). Region 330.0 has five months of history. The fifth case was mixed-channel
account takeover, which does not describe one in-person charge either.

**And there is no ring.** Region 330.0 over 2016-12-08 to 12-12: 18 transactions
at risk ≥ 0.70 out of 608. The same five days a month earlier: 13 of 552. No
spike, no shared device, no common timing across the 15 other cards. R6 and R9 do
not apply, which also keeps exposure at $49 and rules out a SAR.

## The call

Genuinely conflicting evidence, which is the whole point of this case. Initial
assessment 0.55, verdict `uncertain`. The decisive unknown is not on the graph:
does the cardholder recognise the $116.93 charge 49 minutes earlier?

That is the evidence request. Assumed response, grounded in the 42 prior
transactions in that region: the cardholder confirms being in region 330.0 and
owning the $116.93 charge, but still does not recognise the $49.00. Probability
falls to 0.32. `VERIFY_WITH_CUSTOMER` becomes `WARN_CUSTOMER` under R7, the case
is escalated under R8, and **no block is recommended at any stage** — R1 bars it
before the evidence, R7 bars it after.

## What this tells us to build

The detectors that actually did work here, in the order they mattered:

1. **`region_novelty(card, addr1, as_of)`** — and it must be *as of the
   transaction date*, not over the whole file. Region 272.0 had no history when
   CC-4957 was opened in October; by December this card uses it routinely. A
   detector that ignores time will clear real fraud and flag real customers.
2. **`card_baseline(card)`** — percentile position of the amount, product and
   channel share. Absolute thresholds are useless when one card's median is $68
   and another's is $400.
3. **`amount_band_probe(card, amt)`** — how many prior charges sit in the same
   dollar band. This is the single strongest exonerating signal in this case.
4. **`card_window(card, ts, hours)`** — neighbours matter more than the flagged
   transaction. The 0.88 charge 49 minutes earlier is what made this uncertain
   rather than closed.
5. **`denial_track_record(customer)`** — how often this customer has disputed,
   and how often they were right. Not in the brief's suggested schema; derived
   from `ClosedCase.analyst_notes` plus outcome. Worth a likelihood ratio of its
   own.
6. **`fraud_signature_match(card, candidate)`** — does the new activity match the
   *pattern of this card's own past frauds*? Knowing the prior cases were all
   novel-region is what stopped this being called `out_of_region_use`.
7. **`region_cluster(addr1, window)` with a matched baseline** — a raw count of
   high-risk transactions means nothing without the same window a month earlier.
   18 of 608 looks alarming until you see 13 of 552.

Two design consequences for the probability ledger:

- **Exonerating evidence needs likelihood ratios below 1**, and they have to be
  strong enough to overcome a customer denial. Without that, every
  `customer_report` case resolves to fraud and the agent blocks half the pack.
- **Absence of evidence must be recorded, not skipped.** "No ring in region 330"
  and "signature does not match" are findings, and they belong in the evidence
  list with their queries attached. They are what makes a `legitimate` or
  `uncertain` verdict defensible rather than merely cautious.

## Reproduce it

```bash
python -m eval.validate cases/HHG-003.json   # shape, policy routing, graph IDs, exposure
python scripts/write_cases_to_graph.py       # writes the FraudCase vertex and its edges
```

The case is in the graph as `CASE-HHG-003`, wired to card C08623-K2, alert
HHG-003, transaction 3530164, and the six closed cases it cited. A later
investigation on that card walks one hop and finds it.
