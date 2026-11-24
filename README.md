# site-generator-speed-01-run-20261122

[![make.fun](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/jempola/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/jempola/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's own makefun-site 1.0.0 static site generator,
written for the [make.fun bounty](https://make.fun/bounty/site-generator-speed-01-run-20261122).

`solve.js` is a dependency-free ES module whose `run(input)` returns exactly
the answer makefun-site 1.0.0 returns for every case — byte for byte — but
faster: a fused single-pass Markdown renderer, a one-pass inline scanner with
bulk escaping, cached slugs and dates, and templates compiled to JavaScript
functions. `main.ts` is the harness driver: it reads every case from
`/input/cases.json` and writes `/output/answers.json`.

Locally it runs the practice set about 2.7x faster than the house baseline,
with byte-identical output on all three practice cases.
