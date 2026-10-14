# Vision2Code engineering rules

Shared, agent-neutral source of truth for architecture decisions and working rules. Claude Code (`CLAUDE.md`), Codex (`AGENTS.md`) and humans follow the same document. Agent entry files only point here and add tool-specific notes; they never restate or override these rules.

Precedence when sources disagree: **code and configuration first**, then this document, then `README.md` (long narrative reference). If this document is wrong, fix the document in the same change that proves it wrong.

Product language: user-facing text is Spanish (with English resources); code, identifiers, file names and developer docs are English.

## 1. Product and pipeline

Desktop app (Tauri 2 + React 19) that turns a UI screenshot into React + Tailwind code:

```text
screenshot -> POST /api/v1/analyses (NestJS + OpenAI) -> validated UISchema v1
  -> pure deterministic generator -> Monaco editor + sandboxed live preview
  -> optional cloud persistence per Project (Supabase Auth + Postgres via Prisma)
```

The desktop requires an authenticated session to reach the workspace. Screenshots are never stored; only the generated artifact (UISchema + GeneratedProject) is persisted.

## 2. Layout

npm workspaces; run commands from the repository root.

| Path | Role |
| --- | --- |
| `packages/contracts/` | Zod schemas: UISchema v1, GeneratedProject, Project/Generation, API errors, analysis response. Built to `dist/`; desktop and server consume the build. |
| `desktop/src/features/` | `analysis`, `api` (base URL resolution), `auth`, `editor`, `feedback` (toasts), `generation`, `login`, `preferences` (i18n), `preview`, `projects`, `screenshot`, `settings`, `workspace` (shell + `workspaceServices.ts` composition root). |
| `desktop/src/styles/` | `theme.css` (tokens, fonts, shell) and `foundation.css` (light/dark tokens). |
| `desktop/src-tauri/` | Native runner: Stronghold plugin and two commands (`get_vault_key`, `get_vault_path`) backed by the OS credential store. |
| `server/src/` | NestJS 12 ESM: `analysis`, `auth`, `projects`, `prisma`, `ai` (provider interface), `health`, `http`, `configuration.ts`. |
| `server/prisma/` | `schema.prisma` and migrations. |
| `desktop/tests`, `packages/contracts/tests`, `server/tests` | Tests (Node built-in runner; no Jest, Vitest or Playwright suite). |

## 3. Commands

Run from the repository root. On Windows PowerShell with restricted scripts use `npm.cmd`.

| Command | What it does |
| --- | --- |
| `npm test` | Contracts (builds first), desktop, then server tests. |
| `npm run server:test` | Backend only (builds contracts and server, compiles tests, runs `node --test`). |
| `npm run typecheck` | Contracts and desktop only; the server is typechecked by `server:build` / `server:test`. |
| `npm run build` | Contracts, desktop typecheck, then `vite build`. |
| `npm run check:rust` | `cargo check` for `desktop/src-tauri`. |
| `npm run dev` | Browser shell on `http://localhost:1420`. |
| `npm run desktop:dev` | Tauri dev window. |
| `npm run server:dev` | Builds and starts the API on `http://localhost:3000` (no watch; restart after edits). |

Single desktop test file, from the repository root: `node --experimental-strip-types --test desktop/tests/<file>.test.ts`. From `desktop/` the path is `tests/<file>.test.ts`. Desktop tests import the built contracts, so run a contracts build once on a fresh clone.

`npm run test:db --workspace @vision2code/server` is a manual smoke script against a real database; it skips itself when `DATABASE_URL` is unset and is never part of automated verification.

No linter and no CI are configured. `npm audit` has known findings (DOMPurify via Monaco, deepmerge-ts via Prisma): report new ones, never run `npm audit fix --force`.

## 4. Architecture rules

1. **Contracts are the source of truth.** Shapes shared by desktop and server live in `packages/contracts`; neither side keeps a second schema. Server validates with the same Zod schemas the desktop uses.
2. **Generator purity.** `generateReactProject` (`desktop/src/features/generation/generateReactProject.ts`) is synchronous and deterministic and imports only contract types: no HTTP, database, auth, persistence or AI code, no timestamps or randomness.
3. **Framework-free models.** Feature models are plain observables (`getSnapshot` / `subscribe`) with frozen state. Async work is guarded by epochs/revisions so stale responses are discarded. Models expose safe error codes, never raw backend or provider messages.
4. **Composition at the boundary.** User-scoped services are built in `workspaceServices.ts` and wired in `App.tsx`. Domain models never import UI, toast code or the `auth` feature; cross-feature effects use injected callbacks (for example `onUnauthorized` calls `authModel.expireSession`). Only a `UNAUTHORIZED` result expires the session; 5xx and network errors do not.
5. **Auth and secrets.** Access tokens come from `authModel.getAccessToken` and are never stored in models, React state, storage of our own, or logs. The desktop holds only the public Supabase URL and publishable key. No service-role key in the desktop. `.env` files are ignored; only variable names live in `.env.example`.
6. **Backend identity.** The server derives the user from a Supabase JWT verified against the project JWKS (`jose`, issuer `<SUPABASE_URL>/auth/v1`, audience `authenticated`). Request bodies never carry `userId`/`ownerId`. Another user's project returns 404, not 403.
   - **Every endpoint that costs money or touches user data requires authentication** with `SupabaseAuthGuard` (today `/analyses`, `/auth/me`, `/projects/**`); only `GET /health` is public. The guard runs before upload interceptors, so an unauthenticated request never reaches the upload parser or the AI provider. Desktop clients get the token through an injected `getAccessToken` and report a 401 through `onUnauthorized` (rule 4); a new route is added to this list and to an HTTP test that proves 401 without a token.
7. **Persistence.** The target project is captured when analysis starts. Saving reuses the stored artifact and never re-analyzes or regenerates. Editor drafts are never persisted. `sourceImagePath` is sent as `null` (screenshot storage is deferred). Generations are immutable (no update endpoint).
   - **One analysis result is saved at most once per session.** `generationSessionModel` remembers the last generated result and its save outcome across restores; generating the same result again returns to it (pending, failed or saved) and never issues a new save. Only a new analysis result (or `clear`/`reset`) starts a new save.
   - **History belongs to the current result's project.** `generationHistoryModel` lists the generations of the project the shown result belongs to (summaries only, newest first) and never triggers analysis or generation.
   - **One discard confirmation.** Replacing unsaved editor drafts (history, Vault, Library) always goes through `discardGuard` and the single app-level `DiscardDialog`; features never mount their own copy.
   - **Rename and delete are pessimistic.** Nothing changes locally until the server confirms; a failure keeps list, selection and result intact and the dialog shows the error with a retry. Renaming uses the create validation (`validateProjectName`, trim, 1–100) and bumps `updatedAt`. Deleting cascades to the project's generations (`ON DELETE CASCADE`, tested). A 404 on delete counts as success; a 404 on rename removes the project locally with a notice. One request at a time per dialog (double click shares it). Flows live in `projectManageActions.ts` (results `DONE | CANCELLED | FAILED | UNAUTHORIZED | NOT_FOUND`) with a single dialog host in `App.tsx`.
   - **Deleting a project never discards work.** If the current result belongs to it, the code and editor drafts stay and the result becomes local only (`saveStatus: DETACHED`: no project, no generation, no history, no save toast); no discard confirmation is asked. Saves or restores still in flight for it are ignored when they answer, and the project is never recreated or saved to again in that session. The composition root (`onProjectRemoved`) detaches the result and clears the library cache; the history follows the session and selection.
   - **The Library has its own model.** `libraryModel` caches generation summaries per project with per-project epochs and is reset with the session; it reuses the history restore flow (`selectHistoryGeneration`) instead of duplicating it and never changes `generationHistoryModel`.
8. **Session lifecycle.** Sign-out, session expiry or a user change resets projects, generation session, editor, preview and toasts. The authenticated shell is unmounted when signed out, not hidden.
9. **UI.** All user strings go through `preferences/resources.ts` (ES and EN with the same keys). Fonts: Sora (headings, UI labels), Space Grotesk (body, inputs, values), IBM Plex Mono (technical data, code), bundled via Fontsource; no remote fonts. Reuse theme tokens; support light/dark, reduced motion, keyboard use and visible focus.
10. **Preview isolation.** Generated code runs only inside the sandboxed iframe (`sandbox="allow-scripts"`, restrictive CSP, no network); the host never evaluates it.
11. **TypeScript.** `desktop` and `server` use `strict`, `exactOptionalPropertyTypes` (type optional props as `T | undefined`), `noUncheckedIndexedAccess`, `noUnusedLocals` and `noUnusedParameters`. `packages/contracts` currently sets only `strict`. Plain `.ts` modules in `desktop` import siblings with explicit `.ts` extensions; the server uses `.js` specifiers (NodeNext ESM).

## 5. Working rules

1. Read the surrounding code first, follow existing patterns, make the smallest change that solves the task. No rewrites or drive-by refactors.
2. No new dependency without need and justification. Do not upgrade Prisma or Monaco. Never weaken validation, security or tests to get green: no skipped or deleted tests, `@ts-ignore` or lowered thresholds.
3. A behavior change or bug fix comes with a deterministic test (mock transports, fake schedulers; no real Supabase, OpenAI, Postgres or Tauri). Desktop UI tests load `.tsx` through a `require` shim (`ts.transpileModule`), so covered files use type-only imports for new components, which are injected via props or overrides.
4. Verify proportionally: typecheck and tests for logic, `build` for UI or config, `check:rust` only when `desktop/src-tauri` changed.
5. Never claim something works without running it; state what failed, was skipped or is unverified.
6. Do not touch unrelated or user-modified files. No destructive git or shell commands without explicit approval.
7. Never commit secrets. Keep `git diff --check` clean.

## 6. Git

- Work on feature branches off `main`; the branch name is not recorded here (use `git branch --show-current`).
- Conventional commits: `feat(projects): ...`, `fix(auth): ...`, `style(ui): ...`.
- Do not commit or push unless the user asks. Do not add AI attribution to code, docs, commits or pull requests unless the user asks.
- Never force-add ignored files (`git add -f`).

## 7. Definition of done

Requested behavior implemented; relevant tests and build pass (or failures reported with output); ES and EN strings present; no secrets or debug leftovers; final report lists files changed, what was verified, what failed and what remains.

## 8. Open observations

Facts verified in the repository that may need a decision. They are not rules and nobody should "fix" them silently. Cross-origin contracts that are now guarded by tests: CORS allows exactly `GET, POST, PATCH, DELETE` for the explicit origin list (`server/tests/http-boundary.test.ts`), and the Tauri CSP `connect-src` is a closed list (`desktop/tests/tauri-csp.test.ts`). Changing either means updating the test deliberately.

- **Tauri dev HMR.** The single CSP also applies under `tauri dev` (no `devCsp`), and `connect-src` does not list `ws://localhost:1420`, so Vite's HMR websocket is blocked there (reproduced in Chromium with the exact policy). Only hot reload is affected; use `npm run dev` for HMR. Not changed, to avoid a weaker dev-only policy.
- **Supabase origin in the CSP is per project.** `connect-src` lists one explicit `https://<project-ref>.supabase.co` origin, guarded by `desktop/tests/tauri-csp.test.ts`. Pointing `VITE_SUPABASE_URL` at another project requires updating that origin (no wildcard).
- **`sourceImagePath`.** The desktop always sends `null`, but the contract accepts a string (max 1024) and the server stores what it receives.
- **Duplicate saves.** Without idempotency keys, retrying a save after a lost response can store a duplicate generation (documented in `generationSessionModel.ts`).
- **No row-level security.** The initial migration defines no RLS policies and `projects.user_id` has no foreign key; ownership is enforced in `ProjectsService`.
- **Contracts strictness.** `packages/contracts/tsconfig.json` is laxer than desktop and server (see rule 11).

## 9. Where decisions live

- Stable architecture and working rules: this file.
- Narrative description of features and behavior: `README.md`.
- Tool-specific notes: `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex). Both are local-only and listed in `.git/info/exclude`, so a fresh clone must recreate them as thin pointers to this file.
- Temporary task briefs and conversation history are not rules.
