# Social post

For X or LinkedIn. Tag **@TigerGraphDB**. Post after the blog is live and swap
`<BLOG_URL>` and `<DEMO_URL>` for the real links.

---

## LinkedIn

> Half the fraud cases in the TigerGraph Hacker House benchmark are legitimate,
> and the brief warns you outright: *"an agent that blocks everything scores
> badly."*
>
> Finding fraud is a retrieval problem, and a graph is very good at it.
> Declining to find fraud — on a card that looks alarming, when a customer is
> on the phone, when the model score says 0.79 — needs a system that can build
> a case *against* its own suspicion.
>
> So we built Sentinel: ten steps, six of which never touch a language model.
> The model picks what to ask, names the pattern and writes the prose. Every
> id, every amount, every action and every approval route is computed — from
> 26 GSQL queries over 590,742 transactions, a log-odds ledger fitted on the
> bank's own 14,055 confirmed-fraud cases, and a policy engine with a unit test
> per rule.
>
> GraphRAG is hybrid on purpose. Pure vector search over a graph database is a
> bad demo and a worse retriever, so a cosine ranking over 5,611 embeddings
> stored on the vertices themselves is fused with a structural one — same card,
> same customer, same pattern — by reciprocal rank fusion, because a cosine and
> a hop count have no common scale.
>
> The interesting part was being wrong. Four times, each one plausible:
>
> → The model's risk score was counted twice, once in the prior that existed
> *because* the score fired and once as a feature. Eight of twenty cases were
> carried past 0.85 by it.
> → Four evidence groups turned out to hold one observation — being online —
> contributing an identical +1.84 log-odds to every fraud verdict.
> → At temperature 0 with a fixed seed, four identical runs returned three
> different probabilities, because the planner chose a different detector set
> each time. A likelihood ratio that never posts is not neutral; it is missing.
> → The evidence simulator let a cardholder who had just reported a charge turn
> around and confirm it, producing a case file that said "open a case" and
> "close as no fraud" in the same breath.
>
> None of them showed up in 300 passing tests, because every component was
> doing exactly what it was written to do. All four showed up the moment we
> decomposed the twenty finished answer files by evidence group and looked for
> a column that was identical on every row.
>
> The agent was never broken. It was composed wrong — and composition errors
> are invisible from inside any single component.
>
> Write-up: <BLOG_URL>
> Demo: <DEMO_URL>
>
> Built on @TigerGraphDB Savanna with GSQL, the TigerGraph MCP server and
> GraphRAG. Thanks to the TigerGraph team for a benchmark with real traps in
> it.
>
> #TigerGraph #GraphRAG #FraudDetection #AIAgents #KnowledgeGraph

---

## X

> Half the cases in @TigerGraphDB's fraud benchmark are legitimate. The brief
> warns you: an agent that blocks everything scores badly.
>
> So we built one that argues *against* its own suspicion.
>
> 🧵 and the four ways it was confidently wrong first:

> 1/ Ten steps. Six never touch an LLM. The model picks what to ask, names the
> pattern, writes the prose. Every id, amount, action and approval route is
> computed — 26 GSQL queries, a log-odds ledger fitted on 14,055 confirmed
> frauds, a policy engine with a test per rule.

> 2/ GraphRAG is hybrid. Cosine over 5,611 vectors stored on the vertices
> themselves, fused with a structural ranking — same card, same customer, same
> pattern — by RRF. A cosine and a hop count have no common scale, so you fuse
> the rankings, not the scores.

> 3/ Wrong #1: the risk score was counted twice — once in the prior that exists
> *because* the score fired, once as a feature. 8 of 20 cases were carried past
> 0.85 by it, against the brief's own "above 0.7, most flagged transactions
> turn out to be legitimate".

> 4/ Wrong #2: four evidence groups held one observation. channel_online,
> dist1_missing, m_flags, device_found are four consequences of a transaction
> being online. +1.84 log-odds on every single fraud verdict, −1.45 on every
> legitimate one. A 27× swing for one fact.

> 5/ Wrong #3: temperature 0, fixed seed, four identical runs → three different
> probabilities. The planner added a different detector set each time. A fitted
> likelihood ratio that never posts isn't neutral — it's missing from the sum.

> 6/ Wrong #4: the simulator let a cardholder who'd just reported a charge
> confirm it when asked. Output: "open a case" + "close as no fraud", in the
> same file.

> 7/ None showed up in 300 passing tests — every component did exactly what it
> was written to do. All four showed up when we decomposed the 20 finished
> answer files by evidence group and looked for a column identical on every
> row.
>
> The agent wasn't broken. It was composed wrong.
>
> <BLOG_URL>
