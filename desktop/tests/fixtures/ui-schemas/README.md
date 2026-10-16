# UISchema fixtures

Real `UISchema` documents (one per `*.json` file in this folder) used to measure and compare
generation fidelity over time. They are **optional**: the folder may hold only this README.

## Names

- `<site>.v1.json`: baseline schemas (analyzed with prompt v1.0, before the fidelity modes were real).
- `<site>.<mode>.p11.v1.json`: a prompt v1.1 analysis of `<site>` in `<mode>` (`fast`, `balanced` or
  `precise`). Repeated runs of the same site and mode add `.rN`: `<site>.<mode>.p11.r2.v1.json`.
  `npm run report:fidelity` groups these by site and mode (mean over runs, range in parentheses).

Use short lowercase site names with hyphens (`codepen-login`, `linear-landing`, `tremor-dashboard`).

## Save a schema from the dev inspector

1. Run the app in development (`npm run dev` or `npm run desktop:dev`). The inspector exists only
   there; production builds do not contain it.
2. Choose the fidelity mode on the dial, analyze a screenshot (or open a saved generation) and go to
   **Código**.
3. Click **Schema**, then **Copy JSON**.
4. Paste it into a new file here with the name described above.

The schema holds the text the model read from the screenshot (labels, copy). Do not commit
schemas derived from private or confidential screenshots.

## Measurement protocol for the modes (manual, never in CI)

Each analysis is a paid provider call, so this is done by hand.

1. Use the same three reference screenshots for every run (CodePen login, Linear landing, Tremor
   dashboard) and the same server configuration (`OPENAI_MODEL`, no `ANALYSIS_*` overrides).
2. For each site, analyze once in each mode: 3 sites x 3 modes = **9 analyses**. Save each with
   **Copy JSON** as `<site>.<mode>.p11.v1.json`.
3. The model is not deterministic: repeat the 9 analyses **3 times** (27 in total, saved as `.r2`,
   `.r3`) before drawing conclusions. Differences smaller than the spread between runs of the same
   mode are noise. Two runs are the minimum to see that spread at all.
4. Run `npm.cmd run report:fidelity` (nodes, textRisk, noLayout, rows, placeholders and warnings
   per site and mode) and `npm.cmd run measure:layout` (rendered boxes against the schema bounds;
   needs `V2C_BROWSER`, see the main README).
5. What to expect if the modes work: more nodes and fewer `noLayout` / `textRisk` from fast to
   precise, and a precise run that takes noticeably longer.

### Estimated cost per analysis

Token counts are estimates from the current prompt (about 4.8 KB, roughly 1,200 tokens) and the
baseline schemas (about 14 KB of compact JSON for 24 nodes, roughly 170 output tokens per node).
Reasoning tokens are billed as output. Image tokens depend on the model; the figures use the
documented tile accounting (low detail about 85 tokens, high detail for a 1890 x 900 capture about
1,450 tokens; `auto` usually behaves like high for large screenshots).

| Mode | Input tokens | Output tokens (schema + reasoning) | Hard ceiling on output |
| --- | --- | --- | --- |
| fast | about 1,300 | about 3,000-5,000 | 6,000 |
| balanced | about 2,500-2,700 | about 4,500-8,000 | 10,000 |
| precise | about 2,700 | about 8,000-14,500 | 16,000 |

Cost of one analysis = input tokens x the model's input price + output tokens x its output price
(prices per token from the provider's current price list for the configured `OPENAI_MODEL`). The
worst case of a mode is bounded by its output ceiling. A full protocol of 27 analyses costs about
9 x (fast + balanced + precise).

## What uses them

- `desktop/tests/fidelity-fixtures.test.ts` discovers every `*.json` here, validates it with the
  shared Zod schema, runs the generator and the metrics, and checks the output is non-empty and
  stable. With no fixtures it passes.
- The generator golden tests (`desktop/tests/golden/`) pin the emitted code per fixture: the current v4
  and the frozen v3, both for every fixture. **A missing golden
  file fails the test; nothing is created silently.** After adding a fixture or reviewing an intended
  change, create or refresh the files deliberately and commit them with the fixture:
  `UPDATE_GOLDEN=1 node --experimental-strip-types --test desktop/tests/generator-v4.test.ts desktop/tests/generator-v3.test.ts`.
- `npm run report:fidelity` prints the metrics per fixture, per generator version and per mode.
- `npm run measure:layout` renders every fixture in a browser and compares it with its bounds.
