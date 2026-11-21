# csv-reader-speed

[![csv-reader-speed-01](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/iwanr94/csv-reader-speed/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121/entries/iwanr94/csv-reader-speed)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/iwanr94/csv-reader-speed/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121/entries/iwanr94/csv-reader-speed)

A faster drop-in for **csv-reader 1.0.0**, make.fun's reference CSV reader of the
`csv-reader-speed-01-run-20261121` bounty. `solve.js` answers exactly what `readCsv()` answers for every
input — `{columns, rows, errors}` under the same broken-row policy — but reads the text in long jumps
instead of one character at a time.

## How it is faster

The reference walks the text character by character and grows each field with `value += c`. That is a
string concatenation per character; here every field is found and taken in one go:

- **Unquoted fields:** the next `,`, `\n` and `\r` are found with `indexOf()`, the nearest one ends the
  field, and `slice()` takes the whole span at once. Only a stray CR (a CR not followed by LF) forces a
  split, and it is still one `slice()` per piece.
- **Forward-only caches:** the three next-stop positions are cached and recomputed only when the cursor
  passes them, so a text with no CRs, or no commas at all, costs one scan total instead of one scan per
  field — the read stays a single pass and cannot degrade to quadratic work.
- **Quoted fields:** `indexOf('"')` jumps from quote to quote; `""` is skipped by two. Newlines inside a
  quoted span are counted on the sliced segment (CRLF and lone CR each one LF, as the policy says), never
  stepped over.
- **No objects per field:** the field result comes back through three reused variables, so a field costs
  no allocation; error objects and their order are exactly the reference's.

No regex on the hot path, no WebAssembly, no native code, no dependencies. The driver `main.ts` turns
V8's incremental marking off before importing `solve.js`, as the house baseline does.

## Files

- `solve.js` — the reader. `run(input)` returns `{columns, rows, errors}`.
- `main.ts` — the driver the harness runs: `/input/cases.json` in, `/output/answers.json` out.
- `LICENSE` — MIT.

## Verify locally

```
node cli/makefun.mjs grade-local --kit <kit> --bot <this repository> --driver docker
```

## Licence

MIT, Copyright (c) 2026 iwanr94. The reading policy and its error codes are make.fun's own (csv-reader
1.0.0, derived from d3-dsv and papaparse; see the kit's NOTICE).
