# UISchema fixtures

Real `UISchema` documents (one per `*.json` file in this folder) used to measure and compare
generation fidelity over time. They are **optional**: the folder may hold only this README.

## Save a schema from the dev inspector

1. Run the app in development (`npm run dev` or `npm run desktop:dev`). The inspector exists only
   there; production builds do not contain it.
2. Analyze a screenshot (or open a saved generation) and go to **Código**.
3. Click **Schema**, then **Copy JSON**.
4. Paste it into a new file here, for example `dakingo-login.json`. Use a short, descriptive name.

The schema holds the text the model read from the screenshot (labels, copy). Do not commit
schemas derived from private or confidential screenshots.

## What uses them

- `desktop/tests/fidelity-fixtures.test.ts` discovers every `*.json` here, validates it with the
  shared Zod schema, runs the generator and the metrics, and checks the output is non-empty and
  stable. With no fixtures it passes.
- `npm run report:fidelity` prints one metrics row per fixture, so you can compare before and after
  a change to the prompt or the generator.
