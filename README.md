# Vision2Code

[![CI](https://github.com/AlePython-byte/vision2code/actions/workflows/ci.yml/badge.svg)](https://github.com/AlePython-byte/vision2code/actions/workflows/ci.yml)

A desktop workspace for translating interface screenshots into frontend code. Users sign in with Supabase Auth, pick or create a Project, and send a validated screenshot to an independent NestJS backend that analyzes it through OpenAI and returns validated UISchema v1. A deterministic React + Tailwind generator feeds a Monaco workspace with a sandboxed live preview. Each successful generation is saved under the selected Project through the backend (PostgreSQL via Prisma) and can be restored later from the Project Vault.

Architecture rules and working conventions live in [docs/engineering-rules.md](docs/engineering-rules.md); this README is the narrative reference.

## Requirements

- Node.js 22.12+ and npm (Node.js 24 LTS recommended).
- Stable Rust with the MSVC toolchain on Windows.
- Windows: Microsoft C++ Build Tools with the Desktop development with C++ workload and WebView2 Runtime.
- Other platforms: install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
- A Supabase project (Auth) and a PostgreSQL database for sign-in and project persistence, plus an OpenAI API key for analysis. Variable names are listed in the `.env.example` files.

## Development

Run commands from the repository root:

```sh
npm install
npx prisma generate --schema server/prisma/schema.prisma
npm run desktop:dev
```

`npm install` does not generate the Prisma client, and the server does not compile without it, so run the second command once on a fresh clone and again after changing `server/prisma/schema.prisma`. It needs no database.

For the browser-only shell, run `npm run dev` and open `http://localhost:1420`. Vite is configured with `strictPort` because Tauri expects port 1420: if it reports `Port 1420 is already in use`, a previous `tauri dev` or `npm run dev` session is still running. Inspect the owner before closing anything (`Get-NetTCPConnection -LocalPort 1420` then `Get-Process -Id <pid>`), and close the whole earlier session instead of changing the port.
On Windows PowerShell systems that restrict scripts, use `npm.cmd` instead of `npm`.

```sh
npm run typecheck
npm test
npm run build
npm run check:rust
npm run test:rust
npm run desktop:build
```

`desktop:build` produces a single Windows installer, NSIS, installed per user without administrator rights (`bundle.targets: ["nsis"]`, `installMode: currentUser`; no MSI). `desktop:dev` runs with its own identifier, `com.vision2code.desktop.dev` (`desktop/src-tauri/tauri.dev.conf.json`, merged with `--config`), so the development window never shares the vault, the WebView profile or the credential-store entry of the installed app; the release identifier stays `com.vision2code.desktop`. See `docs/packaged-build-checklist.md`. An optional lifecycle log (`VISION2CODE_DEBUG_LIFECYCLE=1`, written to `lifecycle.log` in the app's local data folder; event names only, no personal data) records sign-out, vault writes, window close, destroy and exit, to characterise reports of the app not closing; the checklist explains how to capture and read it.

`build` compiles the contracts package, validates the desktop TypeScript configurations, and builds the frontend. The desktop `predev` and `pretypecheck` scripts build contracts automatically, including when invoked by Tauri. `check:rust` checks the native project and `test:rust` runs its Rust tests (export validation and writes in temporary folders). The keyring test touches the real OS credential store, so it is ignored by default and `cargo test` passes on a runner without one; run it locally with `cargo test --manifest-path desktop/src-tauri/Cargo.toml -- --ignored`. `desktop:build` also creates native release bundles and requires the platform packaging prerequisites. Desktop and contract tests use the built-in Node.js test runner and TypeScript stripping; no test framework is installed.

The root `npm test` command runs the complete repository test suite: contracts, desktop, and server. Use `npm run server:test` to run only the backend suite.

## Structure

```text
package.json                     Private npm workspace and root commands
package-lock.json                Single npm dependency lockfile
docs/engineering-rules.md        Shared architecture rules and working conventions
desktop/
  src/
    App.tsx                      Composition: auth model, workspace services, login or shell
    features/api/                API base URL resolution
    features/auth/               Auth model, Supabase provider, Stronghold session storage, backend probe
    features/login/              Sign-in, registration, and email-confirmation screen
    features/workspace/          Shell, navigation, capture workspace, and workspaceServices composition root
    features/projects/           Projects client and model, Project Vault, new-project dialog, project chip
    features/generation/         Pure generator, generation artifact, and generation session model
    features/feedback/           Toast model, generation toasts, and floating toast viewport
    features/settings/           Settings workspace and preference controls
    features/screenshot/         Input UI, feature state, validation, and decoding
    features/analysis/           Analysis client and model, generation profile, and Capture Console
    features/editor/             Local Monaco adapter, file explorer, and session edits
    features/preview/            Sandboxed live preview (compiler, resolver, runtime, controls)
    features/preferences/        Theme and language preferences, i18n resources
    styles/                      theme.css (tokens, fonts, shell) and foundation.css (light/dark tokens)
  tests/                         Desktop unit and UI tests
  src-tauri/                     Native runner, Stronghold plugin, window configuration, icons
packages/contracts/              Zod contracts: UISchema, GeneratedProject, Project/Generation, API errors, analysis response
server/
  prisma/                        schema.prisma and migrations
  scripts/                       Manual database smoke test
  src/
    health/                      Health endpoint and feature module
    http/                        Request IDs, global error filter, and Zod pipe
    ai/                          Provider-agnostic interface only
    analysis/                    Analysis core, multipart HTTP boundary, and provider infrastructure
      providers/                 OpenAI Responses adapter and provider configuration
      http/                      Analysis controller and in-memory upload validation
    auth/                        Supabase JWT guard (JWKS verification) and GET /auth/me
    projects/                    Projects controller, service, and repository (Prisma and in-memory)
    prisma/                      Prisma module and service
    configuration.ts             Validated startup configuration
  tests/                         HTTP integration and boundary unit tests
```

The frontend uses React, strict TypeScript, Vite, and Tailwind CSS 4 through `@tailwindcss/vite`. The official Tauri React/TypeScript scaffold is the starting point. Typography follows a three-family system bundled locally through Fontsource: Sora for headings and UI labels, Space Grotesk for body text, inputs and values, and IBM Plex Mono for technical data and code. No remote fonts are requested.

The Capture Console follows the approved visual direction: a light blue-gray canvas, raised and inset surfaces, restrained shadows, purple primary actions, cyan/green status accents, a navigation rail, a workflow strip, and reference/profile panels. This is an initial adaptation of the written direction; exact Figma frame parity has not been verified. CSS theme variables define color, typography, spacing, radius, borders, and motion. The layout adapts to smaller windows and keeps content scrollable. Keyboard users have a skip link and visible focus states; reduced-motion preferences are respected.

Tauri opens a 1280 x 820 window with a 720 x 540 minimum and native window decorations. The native side registers the Stronghold and dialog plugins and three commands, `get_vault_key`, `get_vault_path` and `export_project`. The vault master key is generated once with the OS random source and kept in the operating system credential store. `build.rs` declares the three commands in Tauri's app manifest, so the webview may invoke only the ones its capability allows; the capability file grants the Stronghold initialize/client/store/save permissions used for session storage plus `allow-get-vault-key`, `allow-get-vault-path` and `allow-export-project`, and any other command is rejected (`desktop/tests/tauri-acl.test.ts` guards the list). The content security policy permits local assets and `blob:` images for in-memory previews, plus connections to IPC and to `localhost:3000` / `127.0.0.1:3000` for the backend. `connect-src` also lists the explicit HTTPS origin of the Supabase project used for authentication (no wildcard); changing `VITE_SUPABASE_URL` to another project requires updating that origin. The same policy applies to `tauri dev` and packaged builds, while the browser-only shell (`npm run dev`) has no CSP. The scaffold's default bundle icons are retained as development placeholders.

There is no frontend router or global state library. Screenshot selection remains in its feature hook. The Capture Console composes it with a screen-scoped analysis model and a local generation profile (output stack and visual fidelity). The contracts workspace exports `OutputStackSchema` (`REACT_TAILWIND` and `HTML_CSS`), the API error envelope, request ID validation, UISchema v1, the `GeneratedProject` schema, and the Project and Generation schemas used by the projects API. It builds JavaScript and declarations consumed by the desktop and ESM backend, with no browser dependencies.

## Backend foundation

The NestJS server exposes the public `GET /api/v1/health` and the authenticated `POST /api/v1/analyses`, `GET /api/v1/auth/me`, and `/api/v1/projects` routes described in [Projects and persistence](#projects-and-persistence). Every authenticated route uses `SupabaseAuthGuard` and answers 401 `UNAUTHORIZED` without a valid bearer token. Health returns:

```json
{ "status": "ok", "service": "vision2code-api" }
```

Run from the repository root:

```sh
npm install
npm run server:dev
```

Before starting, copy `server/.env.example` to `server/.env` and set `OPENAI_API_KEY` locally, or supply it through the process environment. The provider fails construction with an English configuration error if the key is missing. This is required to start the application, including its health endpoint. `OPENAI_MODEL` defaults to `gpt-6.1-sol`; an explicitly empty value is rejected. `PORT` defaults to 3000, and invalid ports fail startup. `SUPABASE_URL` is the Supabase project URL used only to fetch the public JWKS and verify access tokens; without it every authenticated route answers 401. `DATABASE_URL` is the PostgreSQL connection string used by Prisma for projects. Never put a real key, token, or connection string in `.env.example`.

The development command compiles contracts and the server, then starts it at `http://localhost:3000`. It does not watch source files; restart the command after edits. The server binds to `127.0.0.1` for local development. Node loads `server/.env`; existing process environment values take precedence. Actual `.env` files and variants remain ignored by Git; `.env.example` is the non-secret template. The Prisma schema and its migration live in `server/prisma/`; apply them to the database behind `DATABASE_URL` with the Prisma CLI (`prisma migrate deploy`) before using projects.

```sh
npm run server:build
npm run server:test
```

Server TypeScript is strict and emits ESM using the existing compiler. Tests compile TypeScript before running Node's built-in test runner; no Nest CLI, Jest, or Supertest is needed. `@nestjs/testing` overrides the AI provider before constructing the application. HTTP integration tests use an ephemeral loopback port and Node fetch. Provider tests inject a simulated transport into the official SDK. Normal automated tests require no API key, make zero real OpenAI calls, and consume zero AI credits. No production test routes exist.

`AppModule` imports `HealthModule`, `AnalysisModule`, `AuthModule`, and `ProjectsModule`. The `AI_PROVIDER` injection token binds the production `OpenAIProvider` to `AnalyzeInterfaceUseCase`, which depends only on the provider abstraction. Bootstrap applies the `api/v1` prefix, request ID middleware, explicit CORS policy, and global exception filter. The middleware runs before CORS and body parsing. Every application HTTP response includes `X-Request-Id`. Incoming IDs must be 1–128 ASCII letters, digits, dots, underscores, colons, or hyphens, beginning with a letter or digit. Invalid or missing IDs receive a platform-generated UUID. IDs are correlation metadata, not authentication or trusted identity.

Errors use the shared `ApiErrorResponseSchema`:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No se encontró el recurso solicitado.",
    "requestId": "desktop:request-123"
  }
}
```

The only optional field is `retryAfterSeconds` (a positive integer, at most one day), sent with `ANALYSIS_QUOTA_EXCEEDED` together with the same value in a `Retry-After` header.

Ordinary HTTP exceptions retain their status. A 404 maps to `NOT_FOUND`, other ordinary client errors to `INVALID_REQUEST`, and unexpected errors to `INTERNAL_ERROR`. Analysis-specific mappings are listed below. All client error messages are Spanish. Responses never copy exception messages, provider bodies, validation issues, or stack traces; global exception-filter logs include only correlation ID and HTTP status. Unknown routes also use this envelope. The existing `ZodValidationPipe` remains available for route-bound schemas; multipart metadata is validated by a dedicated upload boundary.

CORS explicitly allows the Vite origins `http://localhost:1420` and `http://127.0.0.1:1420`, plus packaged desktop origins `tauri://localhost`, `http://tauri.localhost`, and `https://tauri.localhost`. GET, POST, PATCH, and DELETE are permitted without credentials (PATCH and DELETE serve project rename and delete), with `Content-Type`, `X-Request-Id`, and `Authorization` as allowed request headers; `X-Request-Id` is exposed. Unlisted browser origins receive no CORS permission; CORS is not authentication. No wildcard origin, HTTP plugin, or new native capability is used.

`AIProvider` defines an asynchronous, cancellable analysis boundary independent of Nest HTTP objects. It accepts `AnalysisImageInput` and returns `Promise<unknown>` so external output cannot bypass application validation. The production adapter uses the official `openai` SDK. The analysis path has no persistence, provider fallback, or code generation; it reuses `SupabaseAuthGuard` from the `auth` module, and persistence belongs to the separate `projects` module.

## Screenshot analysis API

`POST /api/v1/analyses` accepts `multipart/form-data` with exactly one file named `image`, the text fields `viewportWidth` and `viewportHeight`, and an optional `fidelity` field (`fast`, `balanced` or `precise`; without it the analysis is `balanced`, so older clients keep working). Dimensions must be positive safe integers in decimal notation. An unknown or duplicated `fidelity`, `targetStack`, other extra fields, duplicate dimensions, additional files, JSON bodies, and user-supplied image URLs are rejected with 400 `INVALID_REQUEST`.

The route requires `Authorization: Bearer <Supabase access token>`, verified exactly like the projects routes. Nest runs guards before interceptors, so a request without a valid token is rejected with 401 before the upload is parsed or validated and before the AI provider is called; an invalid body without a token is also 401. The provider costs money per call, so this route is never public.

The server independently accepts only PNG (`image/png`), JPEG (`image/jpeg`), and WEBP (`image/webp`), up to and including 10,000,000 bytes (10 decimal MB). Nest's Multer interceptor buffers the upload in memory with bounded file and field limits; no destination path or disk storage is configured. Validation checks MIME, non-empty bytes, file signature, size, and dimensions. It does not fully decode the image or verify that supplied dimensions match encoded dimensions. A supported signature is not proof of a fully decodable image; malformed image data may still be rejected by the provider. Filenames and paths are not sent to OpenAI or returned to clients.

The adapter sends one Responses API request containing the analyzer instructions (prompt v1.1, `server/src/analysis/prompts/analyzer-system.ts`), source dimensions, and a base64 image data URL, to `OPENAI_MODEL` (default `gpt-6.1-sol`). **The fidelity mode is real:** the client names only the mode, and the server's profile table (`server/src/analysis/analysis-profiles.ts`) decides the node budget written into the prompt, the image detail, the reasoning effort and `max_output_tokens` (which bounds visible output and reasoning tokens together, see the [Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create)):

| Mode | Node budget | Image detail | Reasoning | Max output tokens | Server deadline |
| --- | --- | --- | --- | --- | --- |
| `fast` | 10-20 | `low` | `low` | 6,000 | 120 s |
| `balanced` (default) | 20-35 | `auto` | `low` | 10,000 | 180 s |
| `precise` | 30-50 | `high` | `medium` | 14,000 | 300 s |

Fast is the cheapest useful structure (low image detail, small budget). Balanced keeps the previous provider settings (auto detail, low reasoning) with a node budget that no longer forces rows and columns to be merged into flat blocks. Precise reads the image at high detail with more reasoning and the largest budget; it takes longer and costs more (estimates per mode in `desktop/tests/fixtures/ui-schemas/README.md`). Each value can be overridden per deployment with `ANALYSIS_<MODE>_NODES_MIN`, `_NODES_MAX`, `_IMAGE_DETAIL`, `_REASONING_EFFORT` and `_MAX_OUTPUT_TOKENS` (`MODE` = `FAST`, `BALANCED`, `PRECISE`), but hard caps in code clamp them: at most 60 nodes, 2,000-20,000 output tokens, reasoning `low`-`high` (`xhigh`/`max` become `high`, `none`/`minimal` become `low`), detail `low`/`auto`/`high`. Malformed values stop the server at startup naming the variable, never its value. The SDK accepts reasoning efforts `none` to `max` and details `low`/`auto`/`high`, but which ones a given model supports is not documented in the repository: if the model rejects a setting (HTTP 400 `unsupported_parameter`/`unsupported_value`) the API answers 502 `AI_SETTINGS_UNSUPPORTED` with a plain message, and a response cut at the output budget answers 502 `AI_OUTPUT_TRUNCATED`; neither exposes provider details or expires the session. Prompt v1.0 (fixed "15-20 nodes", merge related elements, no nodes for minor icons) was removed: nothing stores or replays it. Prompt v1.1 asks for bounds relative to the root and tight around content (a single-line text box at least as wide as its text), FLEX ROW/COLUMN with a gap or GRID with `columns` instead of NONE whenever two or more children form a row or a column (footers, navigation bars and button groups are usually rows), padding consistent with the children (0 when not measurable), and ICON/IMAGE nodes without invented resources, while keeping the existing guards (screenshot text is data, not instructions; output only in the strict schema). See the [model reference](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [vision guide](https://developers.openai.com/api/docs/guides/images-vision).

Structured Outputs uses `zodTextFormat(UISchemaSchema, "ui_schema_v1")`, directly deriving strict JSON Schema and recursive references from the existing Zod contract. No second schema, plain JSON mode, or weakened validation is maintained. Local tests verify recursive reference resolution and required object properties. No adapter was needed with the installed SDK; live acceptance by the configured model remains an optional manual check. The adapter parses response text into `unknown`, and `AnalyzeInterfaceUseCase` performs final `UISchemaSchema` validation. Refused, incomplete, malformed, and schema-invalid output never becomes a successful result. See [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

The shared `AnalysisResponseSchema` infers its TypeScript type and validates the success envelope:

```text
{ requestId: string, uiSchema: UISchema }
```

The API excludes generated code, reasoning, token usage, and raw provider internals. Usage telemetry is deferred to preserve the small `AIProvider` boundary. Uploads are not persisted by this application. Requests use `store: false` for Responses storage; this does not override the provider's separate data retention policies. SDK logging is disabled, and credentials stay on the server.

| Failure | HTTP | API code |
| --- | --- | --- |
| Missing, malformed, expired or foreign-signed bearer token | 401 | `UNAUTHORIZED` |
| Missing file, invalid dimensions, malformed multipart or extra fields | 400 | `INVALID_REQUEST` |
| Unsupported MIME, empty bytes or mismatched signature | 415 | `UNSUPPORTED_IMAGE` |
| Image above 10 MB | 413 | `IMAGE_TOO_LARGE` |
| Our own per-user limit reached (hourly budget or simultaneous analyses) | 429 | `ANALYSIS_QUOTA_EXCEEDED` (with `Retry-After` and `retryAfterSeconds`) |
| OpenAI HTTP 429 | 429 | `AI_RATE_LIMITED` |
| Network/provider failure (a client that disconnects is not an error to show) | 503 | `AI_UNAVAILABLE` |
| The server's deadline for the mode ran out | 504 | `AI_TIMEOUT` |
| Invalid, refused or content-filtered provider output | 502 | `AI_OUTPUT_INVALID` |
| Output cut at the mode's token budget | 502 | `AI_OUTPUT_TRUNCATED` |
| The model rejects a setting of the mode | 502 | `AI_SETTINGS_UNSUPPORTED` |

The analysis deadline depends on the mode (120 s fast, 180 s balanced, 300 s precise; `ANALYSIS_SERVER_TIMEOUT_MS` in the shared contracts; they follow the measured output speed of `gpt-6.1-sol`, about 63 tokens/s: fast 3,665 tokens in 58 s, balanced 6,578 tokens in 104 s, so a mode can generate its whole output cap inside its deadline) and is shared by the HTTP analysis cancellation signal and the SDK timeout. The desktop waits each mode's deadline plus 30 s, so the server's own error always arrives first. When the deadline runs out the answer is 504 `AI_TIMEOUT` (distinct from 503: the provider was reached but did not answer in time). A client that closes the connection is told apart from a timeout by the reason of the abort (the timer aborts with a `TimeoutError`, a closed connection with an `AbortError`); nobody is left to read that response, so it is only logged as `client_abort`. The desktop says the analysis took too long and suggests only faster modes than the one used (after Precise: Balanced or Fast; after Balanced: Fast or a simpler screenshot; after Fast: a simpler screenshot), never expires the session and never retries by itself. A timed-out analysis is still charged to the quota (the call was made) and frees its concurrency slot. To shorten a deadline, for example to provoke a timeout locally, set `ANALYSIS_<MODE>_TIMEOUT_SECONDS` (`MODE` = `FAST`, `BALANCED`, `PRECISE`): it can only shorten the contract deadline (floor 5 s), never extend it, because the desktop waits the contract deadline plus 30 s. Provider 429s surface as `AI_RATE_LIMITED`; our own per-user limit is described below.

**Reading the analysis log.** Every analysis that reached the provider writes one JSON line with context `AnalysisSummary` (also in production: it holds only the request id, the mode, an outcome from a closed list and numbers; never the image, the schema, the token, an error message or any identifier of the user):

```json
{"context":"AnalysisSummary","requestId":"…","fidelity":"precise","outcome":"ok","durationMs":71234,"inputTokens":2710,"outputTokens":9120,"reasoningTokens":6400}
```

`outcome` is `ok`, `timeout`, `client_abort`, `provider_error`, `truncated` or `invalid`. The token fields are `null` when the provider did not report usage, which is always the case for `timeout`, `client_abort` and a failure before a response. To tune the profiles, run each mode a few times over the same screenshots and compare:

- **`durationMs` against the mode's deadline** (120, 180, 300 s): runs that end near it, or in `timeout`, mean the mode is too slow for that screenshot. Repeated `timeout` in `precise` is the signal to lower its reasoning effort (`ANALYSIS_PRECISE_REASONING_EFFORT=low`) before touching the deadline.
- **`reasoningTokens` against `outputTokens`**: reasoning is billed as output and counts toward `max_output_tokens`. If reasoning is most of the output (for example 6,400 of 9,100) the reasoning effort, not the screenshot, is what makes the mode slow and expensive; if `outputTokens` is close to the mode's cap, expect `truncated` and raise the cap (within its hard limit) or lower the reasoning effort.
- **`inputTokens`** shows what the image costs at the mode's detail (`low`, `auto`, `high`).
- Typical durations per mode are not known yet: this line exists to measure them. Fill them in here after a few real runs.

The line is written to the console; the development diagnostics (`AnalysisDiagnostic`) remain development-only.

**Per-user analysis limit** (`server/src/analysis/analysis-quota.ts`). `POST /analyses` is the only endpoint that spends money, so each account has its own budget before the provider's quota is reached:

- **Key:** the verified JWT `sub`, never a client value or the IP. Two tokens of the same user share the budget. Guards run in order (`SupabaseAuthGuard`, then `AnalysisQuotaGuard`), so a request without a valid session gets 401 and never reads or takes any quota.
- **Budget:** cost units over a sliding window of one hour, 160 by default. One unit is 1,000 tokens of the mode's output cap (`maxOutputTokens`, which bounds visible output and reasoning together), rounded up: fast 6, balanced 10, precise 14 with the default profiles, and the weights follow any override of a mode's cap. 160 units are 11 precise, 16 balanced or 26 fast analyses per user and hour. In the worst case that is 160,000 output tokens plus about 10 x 4,000 input tokens per user and hour; the cost is those tokens times the configured model's prices.
- **Concurrency:** at most 2 analyses in flight per user.
- **When it is checked:** the mode is in the multipart body, which is parsed after the guards. So the guard does a cheap check before the upload is read (no free concurrency slot, or not enough budget for even the cheapest mode: 429 without reading the body) and takes a slot; the exact units of the mode are charged after the request has been validated, right before the provider is called. The slot is released when the response closes and in the controller's `finally`, whatever happened (success, provider error, timeout, cancellation, client disconnect).
- **Charging policy:** a call to the provider costs even if it fails or is truncated, so its units are never refunded. A request rejected before the call (bad image, unknown `fidelity`, over the limit) is never charged.
- **Response:** HTTP 429 `ANALYSIS_QUOTA_EXCEEDED`, distinct from the provider's `AI_RATE_LIMITED`, with a `Retry-After` header and the same number of seconds in `error.retryAfterSeconds` (the header is not readable cross-origin without exposing it, so the desktop reads the body). Over budget it is the time until enough old charges leave the window; with too many analyses running it is a fixed 15 s. The desktop says how long to wait (ES/EN), never expires the session for it and never retries by itself; retrying stays the user's action.
- **Memory:** at most 10,000 tracked users (`ANALYSIS_QUOTA_MAX_USERS`); a user with nothing in the window and nothing running is forgotten. When the table is full of active users a new user is refused with a 429 rather than forgetting someone's charges (which would hand them a fresh budget).
- **Configuration:** `ANALYSIS_QUOTA_UNITS_PER_HOUR` (20-2,000), `ANALYSIS_QUOTA_MAX_CONCURRENT` (1-4) and `ANALYSIS_QUOTA_MAX_USERS` (100-100,000); values beyond the hard caps are clamped and malformed values stop the server at startup naming the variable, never its value.
- **Scope:** the counter lives in the server process. It restarts with the server and is not shared between instances; this fits the single local instance the server is today (`127.0.0.1`), and running several instances would require moving it to a shared store. `GET /health` is not limited. The analysis signal starts after upload validation. Client disconnects abort in-flight provider work where the socket close can be observed. No response can be delivered to an already disconnected client. SDK automatic retries are explicitly disabled both on the production client and per request; the use case has no retry or fallback.


Development analysis diagnostics are emitted as JSON console records with context `AnalysisDiagnostic` unless `NODE_ENV=production`. Events distinguish `provider_response`, `provider_error`, `output_parse_failed`, and `ui_schema_validation_failed`. Response metadata includes allowlisted status/incomplete reason/error code, completion flags, refusal presence, and whether parsed output or non-empty output text exists. The adapter uses `responses.create()` followed by `JSON.parse`, so missing `output_parsed` is normal and is not itself a failure. Errors include recognized class names, fixed safe English messages, and numeric HTTP status where available; unknown provider codes/reasons are recorded as `other`. Final Zod diagnostics include only up to 20 issue paths/codes, with paths capped at 32 segments and a truncation flag. No raw error messages, headers, credentials, environment values, images, generated output, or Zod issue values/messages are logged. These diagnostics do not alter the public error envelope.

### Optional manual live request

This procedure performs one real analysis and consumes paid OpenAI API usage. It is never executed by automated tests. Set `OPENAI_API_KEY` and `SUPABASE_URL` in your ignored `server/.env`, retain `OPENAI_MODEL=gpt-6.1-sol`, and run `npm.cmd run server:dev`. Obtain a current access token by signing in through the desktop or Supabase (never paste it into files or logs). In a second PowerShell terminal, replace the token, example path and dimensions, then execute once:

```powershell
curl.exe --request POST "http://localhost:3000/api/v1/analyses" --header "X-Request-Id: manual-analysis-001" --header "Authorization: Bearer <access-token>" --form "image=@C:/path/to/screenshot.png;type=image/png" --form "viewportWidth=1280" --form "viewportHeight=820"
```

Without the `Authorization` header the same command returns HTTP 401 with code `UNAUTHORIZED` and makes no OpenAI call, which is a free way to check the protection:

```powershell
curl.exe --include --request POST "http://localhost:3000/api/v1/analyses" --form "image=@C:/path/to/screenshot.png;type=image/png" --form "viewportWidth=1280" --form "viewportHeight=820"
```

Expect HTTP 200 with the same request ID and validated UISchema v1. A provider or validation failure returns the standard Spanish error envelope. The desktop also exposes this analysis through its Capture Console; neither entry point generates code.

## Provider-independent analysis core

UISchema v1 is the structured representation that future visual analysis will return, independently of generated code technology. Zod is its source of truth; `UISchema` and recursive `UINode` are inferred types. The public contracts entry point exports `UISchemaSchema`, `UINodeSchema`, and both types. All object fields are required, nullable values must be explicit, and unknown fields are rejected.

The envelope contains `schemaVersion: "1.0"`, positive integer screenshot dimensions in `source`, `confidence` from 0 to 1, `designTokens`, a recursive `root`, and technical `warnings`. Tokens contain arrays of named colors, named typography, non-negative spacing, and non-negative radii. There are no global shadow tokens or arbitrary token records.

Every node contains `id`, `type`, `name`, `bounds`, `layout`, `style`, `text`, `image`, and `children`. The only node types are FRAME, TEXT, IMAGE, ICON, BUTTON, INPUT, and DIVIDER. Leaves use an empty children array. Bounds record observed screenshot-relative geometry, not a code-generation positioning strategy. Layout describes NONE/FLEX/GRID/ABSOLUTE relationships with enumerated direction, justification and alignment, gap, columns, and structured padding. Styles contain color values, structured borders and shadows, radius, and opacity rather than CSS declarations. Optional text and image data use explicit null values.

Dimensions are pixels, including typography line height. Uncertain typography values may be null; offsets, shadow spread, and letter spacing may be negative, while widths, heights, padding, gaps, radii, and blur cannot. Colors are normalized hex strings (#RGB, #RGBA, #RRGGBB, or #RRGGBBAA), including alpha when needed, to avoid arbitrary CSS expressions. Readable screenshot text is preserved in its original language. Names, image descriptions, and warnings are technical English; these semantic instructions live in the prompt, not a language-detection validator.

The application core under `server/src/analysis/` remains independent of Nest and HTTP; its sibling module, `http/`, and `providers/` folders supply infrastructure:

- `analysis-image-input.ts`: a strict runtime schema and inferred types for non-empty `Uint8Array` bytes, PNG/JPEG/WEBP MIME, and positive integer width/height. No `OutputStack` is accepted. This boundary validates metadata and byte representation; it does not decode or preprocess images.
- `analyze-interface.use-case.ts`: validates the input, invokes the injected provider once, validates its untrusted result with `UISchemaSchema`, and returns the parsed schema. Cancellation is forwarded and checked before/after provider work; provider failures propagate without retries or fallback content.
- `invalid-analysis-output.error.ts`: a compact technical application error for invalid provider output, mapped to `AI_OUTPUT_INVALID`. It exposes neither provider content nor Zod issue dumps.
- `prompts/analyzer-system.v1.ts`: the versioned English system prompt used by the provider. It requires evidence-based interface analysis, preserves readable text, and forbids invented content, URLs, source code, breakpoints, hover states, hidden menus, or behavior.

Deterministic JSON fixtures live only under `packages/contracts/tests/fixtures/` and are shared by contract and server tests. Test-only provider doubles and SDK transport mocks verify valid and invalid output, binary data/metadata forwarding, stack exclusion, error propagation, sanitization, and cancellation. Tests use zero AI credits and need no API key. Live calls occur only when a client explicitly submits an analysis request to a configured server.

## Local screenshot workflow

The keyboard-accessible selection button invokes the WebView's native file chooser through an HTML file input. Files dropped into the input region follow the same validation path. Tauri's `dragDropEnabled` is disabled to allow frontend HTML5 drag and drop on Windows. No filesystem plugin or arbitrary file paths are exposed. Dropping files outside the region cannot navigate away from the application.

Only PNG, JPEG, and WEBP are supported. `MAX_SCREENSHOT_BYTES` defines the limit as 10,000,000 bytes (10 decimal MB). Validation checks the size before reading, the extension, the browser-provided MIME when present, and the file signature. A missing MIME is accepted only when the extension and signature match. A browser image decoder must then successfully load the image and report nonzero dimensions.

The UI exposes `EMPTY`, `DRAGGING`, `VALIDATING`, `READY`, and `ERROR` states through Spanish copy and accessible announcements. It shows the file name, dimensions, size, and detected format. Invalid replacements retain the previous image; cancelling the file chooser leaves the selection unchanged. Multiple files are rejected. Removal cancels pending work and returns to the empty state. A newer selection cancels the previous request so stale work cannot replace the current image.

The desktop retains the original validated File and decoded dimensions in memory. It uploads the selected screenshot only when the user activates analysis; the image itself is never persisted. Only the generated artifact is saved, and only when a Project is selected (see [Projects and persistence](#projects-and-persistence)). Object URLs are revoked after decoding failure, cancellation, successful replacement, removal, and feature cleanup. The preview preserves aspect ratio and constrains its width and height; long file names wrap. Product copy supports Spanish and English, while source identifiers and technical documentation remain English.

## Desktop analysis integration

The Capture Console composes screenshot selection with a small feature boundary in `desktop/src/features/analysis/`:

- `analysisClient.ts`: browser fetch transport, multipart construction, shared success/error contract validation, and fixed Spanish error messages. The workspace services build it with the injected `getAccessToken` and `onUnauthorized` (the analysis feature never imports auth): it sends `Authorization: Bearer <token>`, sends nothing without a token, and a missing token or HTTP 401 calls `onUnauthorized` once per request; 5xx, rate limits and network errors never expire the session. It sends only `image`, `viewportWidth`, and `viewportHeight` using browser-decoded dimensions and the validated MIME. The browser sets the multipart boundary. No profile settings, output stack, provider key, or provider configuration are sent.
- `analysisModel.ts`: React-independent screen-scoped state with `IDLE`, `READY`, `ANALYZING`, `SUCCESS`, and `ERROR`. `getSnapshot().result` stores validated `{ requestId, uiSchema }`. The model exposes synchronous React/Tailwind generation from `result.uiSchema` without importing a component or invoking the provider. State is not persisted.
- `useAnalysis.ts`: subscribes React to the model, synchronizes validated selection, and aborts/disposes work on unmount.
- `CaptureConsole.tsx`: presentation and feature composition, including the profile panel, primary action, cancellation, and Spanish announcements.
- `generationProfileModel.ts`: decoupled generation profile state model owning output stack and visual fidelity (`fast`, `balanced`, `precise`).
- `VisualFidelitySelector.tsx`: animated three-state visual fidelity dial control with rotating indicator, tactile segmented radio inputs, and keyboard navigation.

The Capture screen fits the window (from 1280 × 720 content up, at any width above 850 px): a compact header and the five-step strip on top, and two columns that fill the remaining height. The reference image is the compact side of the row (the grid is 1fr : 2fr, so about a third of the width; the options column takes the rest): the panel is as tall as its content, never taller than the row, the preview has a bounded height (`object-fit: contain`) and the empty drop zone is a compact centred block. The file name takes its own line and size, dimensions and format share the next one (back to a single row in one-column mode). The profile panel's body scrolls on its own when the window is short, while its fixed footer always shows the actions and the status line (`role="status"`, `aria-live="polite"`; errors use `role="alert"`; the request reference sits there too). There is one primary action per state: **Analizar captura** / *Analyze screenshot*; while analyzing a disabled **Analizando…** with a spinner (static under `prefers-reduced-motion`) plus **Cancelar análisis**; after success **Generar y abrir código**, with **Analizar de nuevo** as a discreet ghost action; after an error **Reintentar análisis**. The status line names the wait for the mode captured when the analysis started (up to 2, 3 or 5 minutes). The primary action is disabled without a validated image, during image validation, and during analysis; disabled it is flat but legible (label at 3:1 or more against its fill in both themes, never an opacity wash-out). Below 850 px the screen is one column: the five numbered steps stay on a single row and only the current step shows its label (the others remain in the accessibility tree), and the actions-and-status footer is `position: sticky` at the bottom edge of the window (the profile panel is dissolved with `display: contents` so the whole grid is the sticky containing block). The empty drop zone is one centred block (icon, title, description and the **Seleccionar imagen** button) with the formats/size/privacy note pinned to the bottom edge of the panel; the screenshot state text under the panel is now a visually hidden `aria-live` region (the EMPTY/READY badge and the footer already show it), and errors stay visible with `role="alert"`. An active request preserves the preview and cannot be submitted twice. Failures allow manual retry with the same image. Cancelling, replacing/removing an image, or unmounting aborts work; obsolete responses cannot replace newer state. There are no automatic retries or invented progress percentages. The client transport deadline is the mode's server deadline plus 30 s (150 s fast, 210 s balanced, 330 s precise).

The profile shows the output as one read-only row (React · Tailwind CSS · TypeScript, the only generator today); the generation profile model still owns an output stack that defaults to React + Tailwind. The Visual Fidelity selector provides an interactive animated three-state dial (Fast at -35°, Balanced at 0°, Precise at +35°) with tactile segmented buttons defaulting to Balanced. The selected fidelity is sent with the analysis (`fidelity` field) and changes what the server asks the model for; the dial's help text says that precise takes longer and costs more. React/Tailwind generation opens the code workspace after success. The rail's Library entry opens the Library dialog once the workspace is mounted (it is only a disabled placeholder when no library is wired), export lives in the code workspace, and HTML/CSS generation remains unavailable. The code workspace hosts the sandboxed Live Preview described below.

Copy `desktop/.env.example` to an ignored `desktop/.env` only when overriding the default `VITE_API_BASE_URL=http://localhost:3000/api/v1`. Vite embeds `VITE_` values in public client code: never place provider secrets there. Start the backend separately with `npm.cmd run server:dev`, then the desktop with `npm.cmd run desktop:dev` (or browser mode with `npm.cmd run dev`). Real analysis consumes provider usage. A custom API origin must also be explicitly allowed by packaged Tauri `connect-src`; a custom frontend origin must be allowed by backend CORS. Restart/rebuild after environment or CSP changes.

Automated desktop tests inject HTTP transports and fixtures. They cover payloads/dimensions, MIME normalization, state transitions, malformed responses, sanitized errors, retry, duplicate submission, cancellation, stale responses, disposal, and subscriptions. They never contact OpenAI. Manually verify the packaged WebView against the local backend separately when authorizing a paid live analysis.

## Deterministic React + Tailwind generation

The pipeline now includes screenshot -> validated UISchema v1 -> deterministic React + TypeScript + Tailwind source. The backend analysis endpoint remains unchanged and never generates source code.

The pure synchronous function `generateReactProject(schema: UISchema)` lives in `desktop/src/features/generation/`, independently of React presentation. It accepts the existing validated contract, not an unknown provider response. The HTTP client remains the runtime validation boundary. The screen-scoped analysis model exposes `model.generateReactProject()`: it returns a project only after SUCCESS, and null while empty, loading, failed, cancelled, or cleared. The method explicitly targets React/Tailwind; it does not read the future profile selector or automatically generate HTML/CSS. The Capture Console invokes this method through its explicit generation action and passes the result to the editor model. Generation is synchronous, without simulated progress.

`GeneratedProject` contains `target: "react-tailwind"`, `generatorVersion` (`"4"` for new generations; `"1"`, `"2"` and `"3"` for what was stored before), and an ordered `files` array. Each `GeneratedFile` has `path`, `content`, and `language: "typescript"`. The output contains `src/App.tsx` and `src/generated/GeneratedInterface.tsx`. These compile in a React project with the automatic JSX runtime and Tailwind scanning the generated files; they are not a standalone package scaffold. No timestamps, environment values, random identifiers, formatting services, or network calls affect the output.

Mapping rules:

- FRAME and TEXT become div elements; BUTTON becomes a button with explicit type. A button nested under another button is rendered as a div to avoid nested buttons.
- INPUT uses a read-only input, or textarea for multiline text. DIVIDER uses an hr. Wrappers retain children allowed by UISchema on these node types.
- IMAGE and ICON use descriptive placeholders (the description is the `aria-label`), with no asset URLs. Original assets are unavailable, so image fit has no visual effect.
- FLEX and GRID use direction, alignment, justification, gap, padding, and grid columns. NONE preserves normal document flow. Rows may wrap; no breakpoints or interactive behavior are inferred.
- ABSOLUTE children use parent-relative offsets derived from screenshot-global bounds, with percentage sizes and positions. An absolute root uses its schema aspect ratio and a fluid width capped at the measured width. Zero-size parent axes use pixel fallbacks. Other flow nodes use fluid width, measured maximum width, and minimum height.
- Colors, borders, radii, shadows, opacity, and typography use deterministic Tailwind arbitrary properties. Text preserves newlines and wraps. Font families are sanitized and always end in a generic family (see version 4 below). No fonts are downloaded.

Schema strings are encoded as JavaScript string literals inside JSX expressions, including Unicode escaping for markup delimiters and line separators. They never become raw HTML, event handlers, imports, identifiers, or executable expressions. Colors and numeric values come from the validated shared contract; font-family names are allowlisted. No inline style objects are emitted.

**Generator v2 (`generatorVersion: "2"`, removed; stored projects keep it).** Version 2 kept the markup, escaping and file layout of version 1 (shared in `emitSource.ts`) and changes only how classes are chosen, to be faithful to the schema's own bounds:

- **Single-line text never wraps.** A text box whose content has no line break and is at most 1.5 line heights tall (the same heuristic as the `singleLineTextNodes` metric, `textLayout.ts`) uses `white-space: pre` and is never clipped. `pre`, not `nowrap`, because the model pads items with runs of spaces ("Blocks     Templates") and `nowrap` would collapse them. Multi-line text keeps `whitespace-pre-wrap break-words`.
- **Row children keep their own width** (`flex: 0 1 <width>`); version 1 forced `w-full`, so a row that did not fit stacked its children. A row whose children fit one line by bounds does not wrap.
- **Spacing, padding and alignment inferred from bounds** (`layoutInference.ts`), only for FLEX containers whose children form a clean flow, with a 2 px tolerance, and only when unambiguous: a gap when the schema declares none and the measured gaps agree; padding when none is declared; per-child cross-axis alignment (`self-start/center/end`) or a horizontal offset; residual spacing as margins where a measured gap differs from the gap in use; and START instead of a declared CENTER/END/SPACE_BETWEEN that the bounds contradict. If the children overlap, are out of order, leave the container, or the container carries its own text, nothing is inferred and the declared layout is used. Column children narrower than the content box keep their width instead of `w-full`.
- **Placeholders** keep their dashed label and no assets are invented, but IMAGE and ICON boxes are capped to their bounds (`max-height` + `overflow: hidden`) so a 25 px icon label cannot push the layout.

**Generator v3 (`generatorVersion: "3"`, frozen in `generateReactProjectV3.ts`).** Version 3 keeps everything in version 2 and also handles the containers version 2 left flat (same rule: in doubt, do not infer, 2 px tolerance):

- **NONE with a clean row or column** is rendered as that flex flow (gap, padding, alignment inferred as above).
- **NONE or GRID whose children are not a flow** (a heading, a row of three columns and a prompt; a dashboard whose last row spans two columns) get **explicit grid tracks** derived from the children's edges: `grid-template-columns` in `fr` and `grid-template-rows` as minimum heights, with one cell range per child and spacer tracks instead of a gap. Only when every child fits the content box, no two share a cell and there are at most 12 tracks per axis. A declared column count that the bounds contradict (4 declared, 3 columns of children) is replaced; a consistent one, or a single stacked column, is kept.
- **A declared FLEX column or row whose children are not a flow** (a column whose last band is a row) is rendered on the same tracks; if tracks cannot be inferred it stays as declared.
- **Last resort:** a NONE container that fits none of the above positions its children by their bounds (percentages inside a `relative` box with a minimum height). It is counted separately (`positioned`) so its use is visible; the baseline fixtures do not need it.
- **A declared padding the children sit outside of** is replaced by the measured one. Text that is one line once the node's own vertical padding is excluded never wraps, and a GRID frame that only holds text is rendered as plain text.

Containers with their own text and children, and anything not decidable, are generated as in version 2.

**Generator v4 (`generatorVersion: "4"`, current).** Version 4 keeps everything in version 3 and changes three things:

- **Font families with a fallback.** The schema's `fontFamily` (for example `"Lato, sans-serif"`) is split on commas; each entry is unquoted and kept only if it is a plain name (letters, digits, spaces, hyphens; at most 64 characters and 4 names), so it can never inject CSS, URLs or quotes (`fontFamily.ts`). The list always ends in a generic family: one the schema already lists is kept where it is, otherwise `serif` or `monospace` is appended for a short closed list of well-known serif and monospace families and `sans-serif` for everything else. Version 3 emitted a single quoted name with no generic (`[font-family:'Inter']`), so an uninstalled font fell back to the browser's default serif, and it dropped lists such as `"Lato, sans-serif"` entirely.
- **Declared grids that auto-placement cannot reproduce.** A declared GRID whose column count matches the children was kept in version 3 even when a child spans two rows or columns (a sidebar beside two rows of cards); CSS auto-placement then pushed the next child below it. Version 4 keeps the declared grid only when auto-placement puts child *i* in column *i mod n* and row *i div n* with no child reaching into the next track, and otherwise builds the explicit tracks described above.
- **Quieter placeholders.** The dashed "Imagen sin recurso" / "Icono sin recurso" label (`text-xs` with `p-2`: about 137 x 34 px) is shown only when the box is at least 140 x 40 px; smaller ones (logos, icons) keep a dashed outline over their box, and the description stays in `aria-label`. On the fixtures that hides logos and icons and keeps the label on charts and cards.

Stored generations are immutable: the app never regenerates or migrates them, and the contract accepts `"1"` to `"4"`. Only the immediately previous generator is kept (`generateReactProjectV3.ts`, frozen and pinned by golden files) as the "before" of the comparison; versions 1 and 2 were removed because stored projects are data and never need their generator (the layout-inference profile `"v2"` left with generator v2). The application imports no legacy generator.

The live preview builds its CSS from the class names it finds (`previewStyles.ts`), so it must know every utility a generator emits; a test checks every class of v3 and v4 on every fixture. Before version 4 it ignored `whitespace-pre`, `flex-nowrap`, `overflow-hidden` and `self-*`: the preview wrapped single-line text that the exported project keeps on one line (an 84 px "Log In" heading broke under the buttons below it) and let placeholder labels overflow. Those utilities now render in the preview for projects of every version.

Measure a change in two ways. `npm run report:fidelity` lists, for each fixture and generator (v3, v4), how many texts do not wrap, how many `w-full` remain, how many gaps, paddings, margins and alignments were inferred, how many containers became flex flows, track grids or positioned fallbacks, how many texts name no generic font family and how many placeholders show their label. `npm run measure:layout` renders each generator's output in a real browser window as wide as the capture and compares every node's box with its schema `bounds` (share of nodes within 8 px, share on the X axis, mean deviation and total height ratio); `-- --nodes <fixture|all>` prints per node and `-- --json` is machine-readable. It needs a local Chromium-based browser named by the `V2C_BROWSER` environment variable (Chrome, Edge or Chromium), uses no network and no new dependency (DevTools Protocol over Node's built-in `WebSocket`; Vite, React and Tailwind come from the repository's own `node_modules` through a temporary junction), and is never part of `npm test`. It measures the generator against the schema's bounds, not against the screenshot, and text height depends on the fonts installed on the machine.

Visual snapshots live in `desktop/tests/golden/` (`*.v3.*` frozen, `*.v4.*` current, both for every fixture); a missing golden file fails the test, and after reviewing an intended change they are created or refreshed deliberately with `UPDATE_GOLDEN=1 node --experimental-strip-types --test desktop/tests/generator-v4.test.ts desktop/tests/generator-v3.test.ts`.

Current limitations: one primary component, approximate responsive geometry, no font scaling for absolute layouts, no inferred breakpoints or interactions, no asset reconstruction, and no separate design-token stylesheet. Node-level values drive styles. HTML/CSS generation and component inference are not implemented (exporting the working copy is done by the exporter, not the generator). The generator itself never persists anything: saving generations is done by the generation session model, outside the generator.

Generation tests cover every current node type, layouts, styles, hostile and multiline strings, deterministic output, an assembled dashboard fixture, full generated TypeScript checking, Tailwind compilation, and the validated analysis boundary. Run them separately with `node --experimental-strip-types --test desktop/tests/generation.test.ts` from the repository root. They use fixture transports and make no real backend, OpenAI, or external network calls.

## Monaco code workspace

The session pipeline is screenshot -> validated UISchema -> GeneratedProject -> Monaco Workspace. After a successful analysis, select React + Tailwind CSS and choose **Generar y abrir código**. Generation remains in the analysis/generation layer. The editor only consumes GeneratedProject; it never regenerates, analyzes, executes, or persists code.

The application shell owns one React-independent editor model and a small capture/code view selection, without a router. Capture stays mounted while viewing code, preserving the selected screenshot and analysis. The Código rail action opens the current workspace, including its empty state. Generating again explicitly replaces the previous editor project and edits. The HTML/CSS profile cannot invoke generation.

The editor boundary under `desktop/src/features/editor/` contains:

- `editorModel.ts`: a copied original project, deterministic file ordering, active path, immutable per-file drafts, reset, and clipboard feedback. It does not depend on Monaco or React.
- `FileExplorer.tsx`: accessible file buttons with full wrapping paths and a visible active selection.
- `EditorWorkspace.tsx`: project metadata, Spanish empty/loading/error states, copy/reset controls, and a lazy-loaded editor.
- `CodeEditor.tsx`: the local Monaco React adapter, Spanish Monaco locale, language services, and bundled Vite workers.
- `editor.css`: pale blue-gray panels, purple selection, responsive layout, and the existing raised/inset visual direction. It is imported after Tailwind in the theme to preserve layer ordering.

The default file is `src/generated/GeneratedInterface.tsx`, or the first supplied file when absent. The explorer sorts paths with a locale-independent comparison. Edits survive file and screen switches, including empty strings, without mutating GeneratedProject. **Restaurar proyecto** restores all original files. **Copiar código** uses `navigator.clipboard.writeText` and reports success or failure in Spanish; stale asynchronous feedback cannot overwrite a newer selection.

TypeScript/TSX, JavaScript/JSX, CSS, HTML, and JSON map to Monaco languages; unknown names fall back to plaintext. The editor has line numbers, wrapping, automatic layout, a light theme, and no minimap. The active Monaco model is disposed on file/screen changes and unmount; it is not recreated for each edit. Drafts live in the application model, while undo history and cursor positions are local to the mounted editor.

Monaco and its Spanish messages/workers are bundled locally using `monaco-editor` and `@monaco-editor/react`; the wrapper's CDN loader is bypassed. The Tauri CSP permits same-origin workers and inline styles for Monaco's dynamic layout, while retaining script restrictions and the existing backend connection allowlist. No external font, asset, or JSON schema downloads are needed. Monaco only shows generated code as text; it is executed solely inside the isolated Live Preview. Project diagnostics are disabled because this workspace has no installed generated-project dependencies or compiler environment.

Tests cover selection, ordering, independent drafts, resets, empty states, language mapping, rendered explorer paths, clipboard success/failure, and stale feedback. Run `node --experimental-strip-types --test desktop/tests/editor.test.ts` for this suite. Tests inject clipboard functions and require no analysis server or external network. An isolated Edge check also exercised fixture analysis -> generation -> real Monaco editing, file/screen switching, copy, and reset at 1280, 720, and 390 pixels without horizontal overflow or external page requests. Under the strict CSP, the existing Zod eval-availability probe logs a blocked eval attempt and falls back successfully; script restrictions were not relaxed.

**Exportar** (next to **Copiar código**, secondary) writes the current working copy, Monaco edits included, to a new folder; see [Export the working copy](#export-the-working-copy).

Current limits: editor drafts last only for the current application session and are never persisted; only the originally generated artifact is saved to the backend, never edits. Past generations are restored from the Project Vault. Monaco adds a substantial lazy-loaded bundle and language-worker assets. The workspace follows the existing visual direction; no Figma file was supplied for exact comparison. Packaged WebView/native clipboard verification remains a manual check.

## Schema inspector and fidelity metrics (development only)

To learn *why* a result comes out flat, the real UISchema of every result can be inspected, measured and saved. This is a development tool: production builds do not contain it.

- `desktop/src/features/fidelity/schemaMetrics.ts` (pure): `computeSchemaMetrics(uiSchema)` returns node count and depth (the root is depth 1), nodes by type, containers by layout mode and direction, `containersWithoutLayout` (2+ children and layout `NONE`), `rowCandidates`, `textNodes` / `singleLineTextNodes` / `textClampRisk`, `placeholderCount` (IMAGE + ICON), confidence, warning count and compact JSON size in UTF-8 bytes. A **row candidate** is a container with 2+ children that is not declared FLEX/ROW and whose children, sorted by `bounds.x`, never overlap horizontally by more than 1 px and each neighbour pair shares at least 50% of the smaller height vertically. **Text clamp risk** counts single-line text (no line break, box at most 1.5 line heights tall) whose estimated width, characters x fontSize x 0.55, is greater than its `bounds.width`: these are the nodes the generator may wrap at its `max-width`. Both estimates come from the model's bounds, not from real rendering.
- `SchemaInspector.tsx`: a **Schema** button next to Copy code / Export, visible only when `import.meta.env.DEV` is true. It opens a dialog (focus, trap, Esc) with the metrics table, the warnings, a collapsible read-only JSON and **Copy JSON** / **Copy metrics**. It only reads the current result, which includes restored generations; it makes no request and changes neither session, editor nor preview. Text is English and lives outside `resources.ts`.
- **Not in production:** `App.tsx` loads it with `import.meta.env.DEV ? lazy(() => import(...)) : null`, so the build drops the component, its metrics and its CSS. After `npm run build`, `npm run check:dist-dev-only` fails if any inspector marker appears in `desktop/dist`.
- **Fixtures:** save a schema with **Copy JSON** into `desktop/tests/fixtures/ui-schemas/<name>.json` (see the README there; never commit schemas from private screenshots). `desktop/tests/fidelity-fixtures.test.ts` discovers each file, validates it with the shared Zod schema, runs the generator and the metrics, and checks the output is non-empty and stable; with no fixtures it passes.
- **Report:** `npm run report:fidelity` prints one metrics row per fixture, to compare before and after a prompt or generator change.

## Export the working copy

`desktop/src/features/export/` and `desktop/src-tauri/src/export.rs` export what the editor shows (Monaco drafts included), whether the result was saved, unsaved or local only. Exporting never changes the editor, preview or session.

- `exportPlan.ts` (pure): `buildExportPlan(files, projectName)` checks the same rules as Rust for early feedback, and `workingCopyFiles` applies drafts.
- `exportModel.ts`: one export at a time (`EXPORTING` blocks a double click); success shows a short toast with the folder name, a cancelled dialog shows nothing, failures show a persistent plain-language toast. A sign-out or expiry during an export drops its late toast.
- `tauriExport.ts`: calls the single `export_project` command with relative paths, text and a suggested name only, and validates the answer. Outside the desktop runtime it reports `UNAVAILABLE`.
- `ExportButton.tsx`: rendered through the Code view `actions` slot as a plain sibling of Copy code and Reset (no wrapper, no visible helper text in the action row, so the three buttons share height and baseline); its description is the `title` plus an off-screen `aria-describedby` text.
- `exportScaffold.ts` (pure): `buildScaffold(projectName)` and `buildRunnableExportPlan`, described below.

Native rules: the folder picker opens inside Rust (`tauri-plugin-dialog`, registered without any `dialog:` permission for the webview), so the webview never sends a destination and has no filesystem permission. Rust re-validates every path: ASCII letters, digits, `.`, `_`, `-` and `/` only; no empty, `.` or `..` segments (which also rules out absolute and UNC paths); no reserved Windows names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`, with or without extension); no segment ending in a dot or space; case-insensitive duplicates and file/folder clashes rejected; at most 200 files, 1 MB per file, 5 MB in total, 160 characters per path and 64 per segment; UTF-8 text without NUL. The folder name comes from the project name (sanitized, at most 48 characters, never a reserved name, fallback `vision2code-export`). The export always creates a new subfolder inside the chosen folder (`-2`, `-3`… on collision) with `create_dir` and writes files with `create_new`, so nothing is overwritten; on a failure midway it deletes only the files and folders it created. Results are `EXPORTED { folderName, fileCount }`, `CANCELLED` or `FAILED { code }` with codes such as `INVALID_PATH`, `TOO_LARGE`, `PERMISSION_DENIED`, `DESTINATION_INVALID` or `IO_ERROR`; no internal path is returned.

**Runnable scaffold (010B).** The generator emits only `src/App.tsx` and `src/generated/GeneratedInterface.tsx`, so the exporter adds fixed files that make the folder run with `npm install && npm run dev`: `package.json`, `index.html`, `src/main.tsx`, `src/index.css` (`@import "tailwindcss"`), `src/vite-env.d.ts`, `vite.config.ts`, `tsconfig.json`, `README.md` and `.gitignore`. The scaffold belongs to the exporter: the generator, `GeneratedProject` and the contracts are untouched, and the scaffold never appears in the editor or in saved generations. The export plan is the working copy plus the scaffold, checked together by the same validator and limits (`fileCount` includes the scaffold); a scaffold path the project already has is omitted and reported, so generated files always win. Dependencies are pinned to exact versions (no ranges) equal to the ones the desktop installs and builds with: React and React DOM 19.3.0, Vite 8.3.1, `@vitejs/plugin-react` 6.1.1, TypeScript 6.0.3, `@types/react` and `@types/react-dom` 19.3.0, `tailwindcss` and `@tailwindcss/vite` 4.3.3 (`EXPORT_SCAFFOLD_VERSION = "1"`; Node 22.12 or newer). The package `name` is the project name lowercased, accent-free and URL-safe, with a fallback.

Verify the scaffold for real with `npm run verify:export-scaffold` (opt-in, needs the network, about a minute, not part of `npm test`): it generates a project from the fixture UISchema, writes the exact export plan to a temporary folder, runs `npm install` and `npm run build` there, checks that Tailwind emitted the generated utilities, and fails if anything does not work. Pass `-- --keep` to keep the folder and try `npm run dev`. Re-run it whenever the pinned versions or templates change.

Not included yet: ZIP archives and opening the folder in the file manager.

## Live Preview

The code workspace renders the current `GeneratedProject` beside Monaco in an isolated, fully local preview. The pipeline is `GeneratedProject` (plus unsaved Monaco drafts) -> Sucrase TSX transpilation -> deterministic preview CSS -> relative module resolver -> a self-contained HTML document in a sandboxed iframe. Inside Tauri the frame loads the app's own preview origin (`v2cpreview` scheme registered in Rust, `desktop/src-tauri/src/preview.rs`; `http://v2cpreview.localhost/` on Windows): a fixed bootstrap page served with its own CSP header says "ready", receives the document once through `postMessage` from its parent and writes it. A `srcdoc` or `blob:` document would inherit the app's CSP (`script-src 'self'` plus hashes, no `'unsafe-inline'`), which is why the generated code never ran in the packaged app before. In a plain browser (`npm run dev`, no app CSP) the frame keeps `srcdoc`. Either way the document reports `started` to its parent; without it within 8 s the panel shows "La vista previa no pudo iniciarse" (`ERR_PREVIEW_NOT_STARTED`) with a retry instead of an empty canvas marked active. The preview never calls OpenAI, the backend, or any network, and works offline. Source files live in `desktop/src/features/preview/`.

- **Live sync:** Monaco edits overlay the project in memory (nothing is written to disk) and recompile after a 400 ms debounce. Switching files without editing, project replacement, and reset behave as expected; replacement and reset update immediately. Invalid TSX shows a compact, sanitized error over the last good preview, keeps the draft intact, and recovers automatically once fixed.
- **Controls:** Desktop (1440 x 900), Tablet (768 x 1024), and Mobile (390 x 844) presets; Fit, 50%, 75%, and 100% zoom (aspect ratio preserved); manual Refresh/Retry that compiles immediately and cancels stale renders. These controls are presentation-only and never recompile. They are session-only and not persisted. Generated interfaces use fixed-width absolute layouts, so presets scale the same interface rather than producing a different responsive layout.
- **Security:** the iframe uses `sandbox="allow-scripts"` (no `allow-same-origin`, popups, top navigation, or forms), so its origin is opaque: no parent DOM, no app storage, no cookies. Its CSP is `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'` (served as a header by Rust, plus `frame-ancestors` limited to the app, and repeated as a meta tag). The app's own CSP only gained `frame-src` for that origin and `data:` in `img-src`; its `script-src` and `connect-src` are unchanged. Both sides check `event.source` on every message. Compilation happens outside the frame; the host never evaluates generated code. The preview stage follows the app theme, while the generated interface keeps its own independent colors.
- **Tests:** `desktop/tests/preview*.test.ts` cover the state machine, compiler/runtime, resolver, fit/zoom, sync, controls, and an end-to-end acceptance flow (`preview-acceptance.test.ts`). They need no backend or network.

## Authentication

The desktop reaches the workspace only with an authenticated session; the login screen is the entry point otherwise. `desktop/src/features/auth/` follows the same pattern as the other features:

- `authModel.ts`: React-independent state machine with `RESTORING`, `UNAUTHENTICATED`, `AUTHENTICATING`, `AUTHENTICATED`, `SIGNING_OUT`, `AWAITING_EMAIL_CONFIRMATION`, and `ERROR`. Stale async results are discarded. Snapshots hold a frozen user (`id`, `email`, `emailVerified`) and a safe error code, never a password or token.
- `authProvider.ts`: provider port (`restoreSession`, `signIn`, `signUp`, `signOut`, `getAccessToken`). `createUnconfiguredAuthProvider` is used when Supabase configuration is absent; it never fakes a session.
- `supabaseAuthProvider.ts` and `supabaseClient.ts`: Supabase email/password adapter built from the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (legacy `VITE_SUPABASE_ANON_KEY` is also read). No service-role key exists in the desktop.
- `tauriStrongholdStorage.ts` and `authStorage.ts`: session persistence in a Stronghold vault inside Tauri, with an in-memory fallback elsewhere. Legacy WebView `localStorage` entries are cleaned.
- `authProbe.ts`: after authentication the app calls `GET /api/v1/auth/me` once; a 401 expires the session, while backend downtime or 5xx responses do not.

The access token is read on demand through `authModel.getAccessToken` and is never stored in models, React state, or logs. Projects and generation models receive an `onUnauthorized` callback instead of importing the auth feature; a `UNAUTHORIZED` result there calls `expireSession`. Signing out, expiry, or a different user resets projects, the generation session, editor, preview, and toasts, and the application shell is unmounted rather than hidden.

Signing out (or an expiry) goes through `SIGNING_OUT` ("Cerrando sesión…") and reaches `UNAUTHENTICATED` only once the stored session is off the disk. The Supabase SDK removes its local copy only after `POST /logout` answers, so the provider waits for that request at most 2.5 s and then clears the session keys itself (`clearSession`: remove, then one vault save, awaited). From then until the next sign-in the storage returns nothing and ignores writes, so a late token refresh cannot bring the session back. If the vault cannot be rewritten, the session is still unreadable in memory and the login shows `SIGN_OUT_NOT_PERSISTED`. The client is created with an explicit `storageKey` equal to the SDK default, so sessions saved by earlier versions keep restoring.

When the Supabase project requires email confirmation, an account that has not confirmed its address cannot sign in and the login screen shows the `EMAIL_NOT_CONFIRMED` message. A failed sign-in keeps its own error code (invalid credentials, unconfirmed email, rate limit, network); only an authenticated session that the backend rejects with 401 is reported as an expired session.

The login screen (`features/login/Login.tsx`) offers sign-in and registration tabs with password confirmation, an email-confirmation state, accessible password visibility, and Spanish/English copy. Email and password fields are validated with shared Zod rules (8 to 128 character passwords) and never logged.

## Projects and persistence

A **Project** groups the generations of one user. Persistence is optional per run: a result is saved only when a Project was selected when analysis started.

Backend (`server/src/projects/`, all routes behind `SupabaseAuthGuard`, prefix `/api/v1`):

| Route | Purpose |
| --- | --- |
| `POST /projects`, `GET /projects` | Create / list the caller's projects |
| `GET /projects/:projectId`, `PATCH /projects/:projectId`, `DELETE /projects/:projectId` | Detail with generation summaries / rename (same name validation as create; bumps `updatedAt`; response has no counts) / delete (cascades to generations, 204; 404 when missing or another user's) |
| `POST /projects/:projectId/generations`, `GET /projects/:projectId/generations` | Save / list generations |
| `GET /projects/:projectId/generations/:generationId`, `DELETE ...` | Full artifact / delete |

Bodies are validated with the shared contracts (`CreateProjectInputSchema`, `UpdateProjectInputSchema`, `CreateGenerationInputSchema`). Request bodies never include a user id: the owner comes from the verified JWT subject. Another user's project is reported as not found. Generations are immutable.

Data model (`server/prisma/schema.prisma`, one migration): `projects` (`id`, `user_id`, `name` up to 100 characters, timestamps) and `generations` (`project_id` with cascade delete, optional `source_image_path` / `source_image_name` / `source_image_mime_type`, `ui_schema` and `generated_project` as JSONB, `generation_target`, `fidelity_mode`). The migration defines no row-level security policies; ownership is enforced in `ProjectsService`.

Authentication on the server: `JoseSupabaseJwtVerifier` verifies the bearer token against the Supabase project's remote JWKS, with issuer `<SUPABASE_URL>/auth/v1` and audience `authenticated`. Tokens and verification details are never logged or returned.

Desktop (`desktop/src/features/projects/` and `generation/`):

- `projectsClient.ts`: typed HTTP client that validates responses with the shared contracts and maps failures to safe codes (`UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_FAILED`, `NETWORK_ERROR`, `SERVER_ERROR`, `UNKNOWN`).
- `projectsModel.ts`: project list, selection, create/rename/delete, with epochs that discard stale responses.
- `generationSessionModel.ts`: single owner of the current result. The target project is captured at analysis start (`targetProjectId`); the result is shown immediately and then saved in the background. Retrying reuses the stored artifact and project, and never analyzes or generates again. Save status is `IDLE`, `PROJECT_REQUIRED`, `NOT_PERSISTABLE`, `SAVING`, `SAVED`, `SAVE_FAILED`, or `DETACHED` (its project was deleted; local only). Opening a stored generation restores its code into the editor and preview without analysis or generation. An analysis result is persisted at most once per session: restoring keeps the last generated result and its save outcome, so generating that same result again returns to it (same stored artifact, generation id and status, including a pending or failed save) instead of saving a duplicate. `sourceImagePath` is always sent as `null`; screenshot storage is deferred.
- `thumbnailBlocks.ts`, `thumbnailModel.ts`, `SchemaThumbnail.tsx`: the thumbnails of the Projects and Library cards. Project and generation summaries carry no UISchema, so the thumbnail model asks for the detail of one generation (the project's latest, or the Library entry's own), derives a block model with the pure `schemaThumbnail(schema)` and keeps only that and the fidelity mode (never the schema or the code). `schemaThumbnail` keeps proportions and hierarchy in a fixed 160 x 100 view box (frames, text lines, images, icons, buttons, inputs, dividers; a page taller than the box shows its top), stops at 300 nodes, depth 8 and 400 blocks without recursion, and never throws: an empty or invalid schema gives a placeholder. It reads the schema's colours only to tell a dark surface from a light one; every block is painted with design tokens (`--thumb-paper|slate` and their ink in both themes, plus the usual surface/accent tokens). Requests are queued three at a time, start only when a card is near the viewport, are never repeated for a generation (they are immutable) and are dropped with the session. A failed one shows "Sin vista previa" / "No preview", never a toast. The card shows the thumbnail first, the fidelity chip on it, the title, the generation count and the relative date; the grid is `auto-fill, minmax(240px, 1fr)`, so the 720 x 540 minimum window shows two columns.
- `ProjectVault.tsx`, `NewProjectDialog.tsx`, `ProjectChip.tsx` with `vaultActions.ts`, `vaultSelectors.ts`, `vaultKeyboard.ts`, and `projectTargetActions.ts`: searchable vault, create/rename/delete flows, opening a project or its latest generation, and the project chip used in the Capture Console. Navigation lives in the shell (`projects`, `capture`, `editor`, `settings`).
- `generationHistoryModel.ts`, `GenerationHistoryTray.tsx`, `discardGuard.ts`, `DiscardDialog.tsx`: per-project history of the current result in the Code view and the single app-level confirmation before unsaved edits are replaced.
- `projectManageActions.ts`, `ProjectManageDialogs.tsx`: rename and delete from each Vault card (sibling buttons of the open button, never nested), confirmed in one app-level dialog host. Both are pessimistic: nothing changes until the server confirms, and a failure keeps the dialog open with the error and Retry. Rename uses the create validation and moves the project to the top of Recent (the server bumps `updatedAt`); the new name shows in the Vault, the project chip, the Library and the Code view. Delete names the project and how many generations go with it (cascade), focuses Cancel and cannot be undone; a 404 counts as already deleted. If the open result belonged to the deleted project, its code and edits stay as a local-only result (`DETACHED`) with no history; late save or restore answers for that project are ignored. A 404 on rename removes the project with a notice. 401 expires the session once; 5xx and network errors never do.
- `libraryModel.ts`, `LibraryDialog.tsx`, `libraryActions.ts`: the Library dialog opened from the rail or the Code view project name; it lazily loads each project's generations with its own model and opens them through the same discard guard and restore flow. A failed refresh keeps the cached list and says so. Each generation is a card (thumbnail with its fidelity chip, "Generación 03", relative date, source file name) whose single button covers the whole card; the Code view's history tray keeps its compact log.

Known limitation: there are no idempotency keys, so retrying a save after a response was lost post-commit can store a duplicate generation.

## Floating feedback toasts

`desktop/src/features/feedback/` renders save, restore, and vault outcomes as floating capsules in a fixed viewport outside the document flow. `toastModel.ts` is a React-independent queue (at most three visible, persistent toasts are never evicted for transient ones, timers come from an injected scheduler). `generationToasts.ts` binds generation session state to the queue, so domain models never import toast code. Messages are i18n keys, so a language switch applies to toasts already on screen.

## UI foundation, preferences, and login shell

The login screen is described in [Authentication](#authentication). Email and password fields are never copied to application state or storage beyond the controlled form values needed to submit them. Password visibility is accessible and reversible.

`desktop/src/features/preferences/` owns the UI foundation:

- `preferences.ts`: framework-independent theme/language preferences, defaulting to LIGHT and Spanish, regardless of OS preferences. Only `theme` and `language` are stored under `vision2code.preferences`. Invalid/blocked storage falls back safely to defaults or session-only changes.
- `i18n.ts` and `resources.ts`: bundled Spanish/English resources using i18next and react-i18next, with no remote translation service or reload. The HTML language and root `data-theme` update immediately.
- `useLabels.ts`: presentation translation helpers. Existing framework-independent error/feedback messages are mapped to keys at render time, so messages already on screen also change language. Backend error contracts and generated source are unchanged.
- `PreferenceControls.tsx`: theme and language as two segmented controls for Login (`SegmentedRadioGroup`: a `radiogroup` named by its visible label, roving tabindex, arrows/Home/End move the selection and the focus, theme with Sun/Moon icons, language as ES/EN with the full name in `aria-label`). They write through the same `preferences` model as before. Within the application shell, Settings is the canonical preferences location.
- Login and registration: the card keeps the height of the tallest tab (the Sign in tab reserves an invisible, inert copy of the Register field), so the title and the left text column never move when switching tabs, and the whole composition (text and card) is centred vertically and horizontally. The screen fits a 1280 × 720 window without page scroll in both tabs; below about 700 px of height the composition anchors to the top and the page scrolls. The tabs are the only way to switch mode (the old duplicate link under the button was removed). Form fields use `--color-field` and `--color-field-border`: the border keeps 3:1 against the card and the fill in both themes (WCAG 1.4.11; `npm run report:contrast`, guarded by `desktop/tests/shell-auth-polish.test.ts`).
- Navigation rail: only one item is current at a time. With the library dialog open only **Library** has `aria-current` and the page behind it does not; closing the dialog gives the page its `aria-current="page"` back. The account block is a generated avatar plus one short label (the display name from `user_metadata.full_name` / `name` if the user has one, otherwise "Cuenta" / "Account"); the address is never visible text there, only the `title` of the block and of the sign-out item, and a row in Settings > Account. The avatar (`features/account/`) is drawn by the pure `avatarSpec(seed)` (FNV-1a hash of the Supabase user id, never the address, then mulberry32 for one of 8 palettes, one of 5 eye variants and a smooth 8-point Catmull-Rom blob); its palettes are `--avatar-<n>-bg|blob|eyes` tokens in both themes and `npm run report:contrast` checks 3:1 for the eyes on the blob. Icon-only rails (561–760 px) show only the avatar. The sign-out item reads "Cerrar sesión" / "Sign out".
- `SettingsScreen.tsx`: dedicated Settings screen in `features/settings/` accessible from left navigation, featuring skeuomorphic tactile selectors for Light/Dark appearance and Español/English localization, system telemetry, and default restoration.
- `ScreenshotInput.tsx` (Interactive Upload Surface): the entire screenshot upload tray functions as an interactive file picker. Clicking the central dropzone area, the raised '+' button affordance, or the 'Browse files' button triggers a single shared hidden file picker. Double-triggering is prevented via event containment, drag-and-drop validation is strictly preserved, and reduced-motion preferences disable transitions. Keyboard users can Tab to the '+' affordance or Browse button and activate via Enter/Space.

`styles/foundation.css` defines light/dark surface, text, border, focus, status, and depth tokens, with brand purple centered on #7662F5. Primary buttons use a slightly darker purple for small white-label contrast. Raised and inset surfaces remain restrained; active navigation, workflow steps, file selections, icons, and focus treatment use the brand accent. All screens use the same tokens rather than duplicated dark-mode components.

Lucide supplies the consistent local SVG icon family. Icons accompanying visible labels are decorative; the password visibility control has a translated accessible name. Native selects, labeled inputs, focus outlines, and responsive panels remain keyboard accessible. Login, Capture Console, input states/errors, profile settings, navigation, Workspace actions, and empty states are translated. Technical framework names, file paths, and generated source are never translated. Screenshot file sizes use the active language.

Monaco follows the app theme immediately using its light/vs-dark themes without discarding drafts. Application-owned editor labels switch language live. Monaco's bundled native command/menu translations remain Spanish: those strings are initialized by Monaco at module load and are outside the application's runtime translation resources.

Automated preferences tests cover defaults, switching, persistence, corrupt/unavailable storage, complete bilingual keys, retained messages, login rendering, password visibility, accessible controls, and unchanged editor drafts. Existing screenshot, analysis, generation, and editor suites remain in place. A local Edge smoke check with intercepted analysis tested Login, actual password toggling, both themes/languages, persisted reload preferences, capture -> generation -> Monaco, copying, resets, and file/screen switches. No real analysis/OpenAI calls or external application requests were made.

Not implemented: OAuth providers, password reset, screenshot storage, and HTML/CSS generation. The Library dialog and the working-copy export are implemented. Editor drafts are lost on application reload; only generated artifacts are saved. Packaged WebView verification remains manual.

## Manual verification

Automated tests cover format metadata/signatures, empty or unsupported files, the exact size boundary, early rejection of oversized files, cancellation, temporary URL cleanup with a simulated decoder, and the shared stack schema. They do not substitute for native GUI verification.

Run `npm run desktop:dev` and verify in the actual desktop WebView:

- Select a valid PNG, JPEG, and WEBP through the file chooser and by dropping each file into the region. Check the preview and metadata.
- Drop an unsupported file, a renamed non-image, a corrupt image, multiple files, and a file larger than 10 MB. Check the Spanish errors and preservation of any previous selection.
- Replace and remove an image; select the same file again and cancel the chooser. Try rapid replacement or removal during validation.
- Change between React + Tailwind CSS and HTML + CSS using both mouse and keyboard.
- Resize to 720 x 540, use a long file name and wide/tall images, and confirm scrolling without horizontal page overflow. Check keyboard focus, announcements, and reduced-motion behavior.

An isolated headless browser check exercised the Capture Console with intercepted HTTP responses and verified layouts at 1280, 720, and 390 pixels without horizontal overflow. Packaged WebView behavior, native file-dialog interaction, and a real desktop-to-provider analysis still require manual verification; no paid request was performed during implementation.

## References

- [react-i18next runtime translation](https://react.i18next.com/latest/usetranslation-hook)
- [Lucide React icons](https://lucide.dev/guide/react/)

- [Monaco React local-package integration](https://github.com/suren-atoyan/monaco-react#use-monaco-editor-as-an-npm-package)
- [Monaco Editor and localization](https://github.com/microsoft/monaco-editor)

- [Tauri project scaffolding](https://v2.tauri.app/start/create-project/)
- [Tailwind CSS Vite integration](https://tailwindcss.com/docs/installation/using-vite)
- [Tauri window configuration and HTML5 drag and drop](https://v2.tauri.app/reference/config/#dragdropenabled)
- [WebView file input behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)
- [NestJS exception filters](https://docs.nestjs.com/exception-filters)
- [Node environment file support](https://nodejs.org/api/cli.html#--env-filefile)
- [Zod recursive object inference](https://zod.dev/api#recursive-objects)

## License

Released under the [MIT License](LICENSE).
