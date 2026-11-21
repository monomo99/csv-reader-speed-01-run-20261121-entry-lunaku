# Fast CSV Reader — csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/monomo99/csv-reader-speed-01-run-20261121-entry-lunaku/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/monomo99/csv-reader-speed-01-run-20261121-entry-lunaku/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

Entry for make.fun `csv-reader-speed-01-run-20261121`: a faster drop-in for
csv-reader 1.0.0, make.fun's own CSV reader. It answers exactly as csv-reader
on every input — same `{columns, rows, errors}`, same broken-row policy —
and does it roughly 3× faster on the practice set.

## The entry

- `solve.js` — the fast reader. `run({text, header}) -> {columns, rows, errors}`.
- `main.ts` — the harness driver (kept from the kit): reads `/input/cases.json`,
  runs `solve.js` over every case, writes `/output/answers.json`.

## How it is fast

csv-reader walks the text one character at a time and builds every field
with string concatenation. This reader does the opposite:

- **One regex scan finds the next interesting character** (`"`, `,`, `\r`,
  `\n`) instead of inspecting each byte. Fields are cut out with `slice()`,
  never built a character at a time.
- **The common path is allocation-free-ish:** a plain unquoted field ending
  at a comma is one regex match and one slice. No per-character work, no
  intermediate string building.
- **Quoted fields skip to the closing quote** with the same scan, handling
  doubled quotes (`""` → `"`), CRLF and lone CR inside quotes (each reads
  as LF), and junk after the closing quote — all by slicing segments and
  joining only when a field actually needed more than one piece.

Everything else is csv-reader's semantics, verbatim: BOM dropped, empty
lines are no records, a CR outside quotes is dropped (`stray_cr`), a quote
that never closes is a literal character and the text after it is read again
as unquoted (`unterminated_quote`), text after a closing quote is appended
as it stands (`quote_junk`), rows are padded with `""` (`short_row`) or cut
(`long_row`) to the first record's width, and every error carries `{code,
line, row}` in the order met.

## Measured speed (this machine, 6-case practice set, ~11 MB of text)

| | parse-only CPU | whole program (wall) |
|---|---|---|
| csv-reader 1.0.0 (baseline) | 632–1040 ms | 1296–1614 ms |
| this reader | 196–267 ms | 683–944 ms |

Correct on all 6 practice cases (the kit's own scorer: `passed: 1,
cases_passed: 6, cases_total: 6`), on a second freshly generated 6-case set
drawn from a different drand seed, and on 20,000 random fuzz cases compared
against the vendored csv-reader oracle.

## Run it

```sh
node main.ts   # reads /input/cases.json, writes /output/answers.json
```
