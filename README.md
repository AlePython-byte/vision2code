# Vision2Code

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
npm run desktop:dev
```

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

`build` compiles the contracts package, validates the desktop TypeScript configurations, and builds the frontend. The desktop `predev` and `pretypecheck` scripts build contracts automatically, including when invoked by Tauri. `check:rust` checks the native project and `test:rust` runs its Rust tests (export validation and writes in temporary folders; the pre-existing keyring test touches the OS credential store). `desktop:build` also creates native release bundles and requires the platform packaging prerequisites. Desktop and contract tests use the built-in Node.js test runner and TypeScript stripping; no test framework is installed.

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

Tauri opens a 1280 x 820 window with a 720 x 540 minimum and native window decorations. The native side registers the Stronghold plugin and two commands, `get_vault_key` and `get_vault_path`. The vault master key is generated once with the OS random source and kept in the operating system credential store; the capability file grants only the Stronghold initialize/client/store/save permissions used for session storage. The content security policy permits local assets and `blob:` images for in-memory previews, plus connections to IPC and to `localhost:3000` / `127.0.0.1:3000` for the backend. `connect-src` also lists the explicit HTTPS origin of the Supabase project used for authentication (no wildcard); changing `VITE_SUPABASE_URL` to another project requires updating that origin. The same policy applies to `tauri dev` and packaged builds, while the browser-only shell (`npm run dev`) has no CSP. The scaffold's default bundle icons are retained as development placeholders.

There is no frontend router or global state library. Screenshot selection remains in its feature hook. The Capture Console composes it with a screen-scoped analysis model and keeps the output-stack selection local to the generation profile. The contracts workspace exports `OutputStackSchema` (`REACT_TAILWIND` and `HTML_CSS`), the API error envelope, request ID validation, UISchema v1, the `GeneratedProject` schema, and the Project and Generation schemas used by the projects API. It builds JavaScript and declarations consumed by the desktop and ESM backend, with no browser dependencies.

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

Ordinary HTTP exceptions retain their status. A 404 maps to `NOT_FOUND`, other ordinary client errors to `INVALID_REQUEST`, and unexpected errors to `INTERNAL_ERROR`. Analysis-specific mappings are listed below. All client error messages are Spanish. Responses never copy exception messages, provider bodies, validation issues, or stack traces; global exception-filter logs include only correlation ID and HTTP status. Unknown routes also use this envelope. The existing `ZodValidationPipe` remains available for route-bound schemas; multipart metadata is validated by a dedicated upload boundary.

CORS explicitly allows the Vite origins `http://localhost:1420` and `http://127.0.0.1:1420`, plus packaged desktop origins `tauri://localhost`, `http://tauri.localhost`, and `https://tauri.localhost`. GET, POST, PATCH, and DELETE are permitted without credentials (PATCH and DELETE serve project rename and delete), with `Content-Type`, `X-Request-Id`, and `Authorization` as allowed request headers; `X-Request-Id` is exposed. Unlisted browser origins receive no CORS permission; CORS is not authentication. No wildcard origin, HTTP plugin, or new native capability is used.

`AIProvider` defines an asynchronous, cancellable analysis boundary independent of Nest HTTP objects. It accepts `AnalysisImageInput` and returns `Promise<unknown>` so external output cannot bypass application validation. The production adapter uses the official `openai` SDK. The analysis path has no persistence, provider fallback, or code generation; it reuses `SupabaseAuthGuard` from the `auth` module, and persistence belongs to the separate `projects` module.

## Screenshot analysis API

`POST /api/v1/analyses` accepts `multipart/form-data` with exactly one file named `image` and two text fields, `viewportWidth` and `viewportHeight`. Dimensions must be positive safe integers in decimal notation. `targetStack`, other extra fields, duplicate dimensions, additional files, JSON bodies, and user-supplied image URLs are rejected.

The route requires `Authorization: Bearer <Supabase access token>`, verified exactly like the projects routes. Nest runs guards before interceptors, so a request without a valid token is rejected with 401 before the upload is parsed or validated and before the AI provider is called; an invalid body without a token is also 401. The provider costs money per call, so this route is never public.

The server independently accepts only PNG (`image/png`), JPEG (`image/jpeg`), and WEBP (`image/webp`), up to and including 10,000,000 bytes (10 decimal MB). Nest's Multer interceptor buffers the upload in memory with bounded file and field limits; no destination path or disk storage is configured. Validation checks MIME, non-empty bytes, file signature, size, and dimensions. It does not fully decode the image or verify that supplied dimensions match encoded dimensions. A supported signature is not proof of a fully decodable image; malformed image data may still be rejected by the provider. Filenames and paths are not sent to OpenAI or returned to clients.

The adapter sends one Responses API request containing the versioned analyzer instructions, source dimensions, and a base64 image data URL. It uses `OPENAI_MODEL` (default `gpt-6.1-sol`), `low` reasoning, and `auto` image detail. Detail and reasoning are named provider configuration constants. The prompt requests the main visible structure with a compact, useful hierarchy, avoiding redundant nodes, micro-fragmentation, and excessive decorative detail. Finer detail is included only when needed to understand the layout or content. The prompt targets 15-20 meaningful total nodes (fewer for simpler interfaces) and shallow nesting of around 5 levels or fewer when possible. It prioritizes global layout, main sections, visible text, and primary controls, merging related elements and omitting micro-decoration. Minor labels remain in related controls or grouped text; individual icon or label nodes are reserved for structural importance. These are prompt guidelines, not Zod limits; UISchema v1 and its recursion remain unchanged. The named provider constant `OPENAI_MAX_OUTPUT_TOKENS = 8000` is sent as `max_output_tokens`. This bounds visible output and reasoning tokens together, as documented in the [Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create). If the bound produces an incomplete response, the existing error mapping returns `AI_OUTPUT_INVALID`; the bound does not guarantee completion within the timeout. These settings aim to reduce request complexity; successful live completion still needs manual verification. See the [model reference](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [vision guide](https://developers.openai.com/api/docs/guides/images-vision).

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
| OpenAI HTTP 429 | 429 | `AI_RATE_LIMITED` |
| Network/provider failure, timeout or cancellation | 503 | `AI_UNAVAILABLE` |
| Invalid, refused or incomplete provider output | 502 | `AI_OUTPUT_INVALID` |

`ANALYSIS_TIMEOUT_MS` is 120,000 ms, shared by the HTTP analysis cancellation signal and SDK timeout. The analysis signal starts after upload validation. Client disconnects abort in-flight provider work where the socket close can be observed. No response can be delivered to an already disconnected client. SDK automatic retries are explicitly disabled both on the production client and per request; the use case has no retry or fallback.


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

The primary action is labeled “Activar generador” (the Spanish product label for “Engage generator”), with an explanation that this stage only analyzes. It is disabled without a validated image, during image validation, and during analysis. An active request preserves the preview and cannot be submitted twice. Failures allow manual retry with the same image. Cancelling, replacing/removing an image, or unmounting aborts work; obsolete responses cannot replace newer state. There are no automatic retries or invented progress percentages. A 150-second client transport deadline allows time beyond the backend's 120-second analysis deadline.

The profile preserves the existing React/Tailwind versus HTML/CSS selection. The Visual Fidelity selector provides an interactive animated three-state dial (Fast at -35°, Balanced at 0°, Precise at +35°) with tactile segmented buttons defaulting to Balanced. Profile settings and fidelity selection do not alter analysis HTTP requests or backend contracts. React/Tailwind generation opens the code workspace after success. The library entry is disabled, and export and HTML/CSS generation remain unavailable. The code workspace hosts the sandboxed Live Preview described below.

Copy `desktop/.env.example` to an ignored `desktop/.env` only when overriding the default `VITE_API_BASE_URL=http://localhost:3000/api/v1`. Vite embeds `VITE_` values in public client code: never place provider secrets there. Start the backend separately with `npm.cmd run server:dev`, then the desktop with `npm.cmd run desktop:dev` (or browser mode with `npm.cmd run dev`). Real analysis consumes provider usage. A custom API origin must also be explicitly allowed by packaged Tauri `connect-src`; a custom frontend origin must be allowed by backend CORS. Restart/rebuild after environment or CSP changes.

Automated desktop tests inject HTTP transports and fixtures. They cover payloads/dimensions, MIME normalization, state transitions, malformed responses, sanitized errors, retry, duplicate submission, cancellation, stale responses, disposal, and subscriptions. They never contact OpenAI. Manually verify the packaged WebView against the local backend separately when authorizing a paid live analysis.

## Deterministic React + Tailwind generation

The pipeline now includes screenshot -> validated UISchema v1 -> deterministic React + TypeScript + Tailwind source. The backend analysis endpoint remains unchanged and never generates source code.

The pure synchronous function `generateReactProject(schema: UISchema)` lives in `desktop/src/features/generation/`, independently of React presentation. It accepts the existing validated contract, not an unknown provider response. The HTTP client remains the runtime validation boundary. The screen-scoped analysis model exposes `model.generateReactProject()`: it returns a project only after SUCCESS, and null while empty, loading, failed, cancelled, or cleared. The method explicitly targets React/Tailwind; it does not read the future profile selector or automatically generate HTML/CSS. The Capture Console invokes this method through its explicit generation action and passes the result to the editor model. Generation is synchronous, without simulated progress.

`GeneratedProject` contains `target: "react-tailwind"`, `generatorVersion: "1"`, and an ordered `files` array. Each `GeneratedFile` has `path`, `content`, and `language: "typescript"`. The output contains `src/App.tsx` and `src/generated/GeneratedInterface.tsx`. These compile in a React project with the automatic JSX runtime and Tailwind scanning the generated files; they are not a standalone package scaffold. No timestamps, environment values, random identifiers, formatting services, or network calls affect the output.

Mapping rules:

- FRAME and TEXT become div elements; BUTTON becomes a button with explicit type. A button nested under another button is rendered as a div to avoid nested buttons.
- INPUT uses a read-only input, or textarea for multiline text. DIVIDER uses an hr. Wrappers retain children allowed by UISchema on these node types.
- IMAGE and ICON use labeled descriptive placeholders, with no asset URLs. Original assets are unavailable, so image fit has no visual effect.
- FLEX and GRID use direction, alignment, justification, gap, padding, and grid columns. NONE preserves normal document flow. Rows may wrap; no breakpoints or interactive behavior are inferred.
- ABSOLUTE children use parent-relative offsets derived from screenshot-global bounds, with percentage sizes and positions. An absolute root uses its schema aspect ratio and a fluid width capped at the measured width. Zero-size parent axes use pixel fallbacks. Other flow nodes use fluid width, measured maximum width, and minimum height.
- Colors, borders, radii, shadows, opacity, and typography use deterministic Tailwind arbitrary properties. Text preserves newlines and wraps. Simple local font-family names are supported; unsupported family syntax is omitted and inherits the host font. No fonts are downloaded.

Schema strings are encoded as JavaScript string literals inside JSX expressions, including Unicode escaping for markup delimiters and line separators. They never become raw HTML, event handlers, imports, identifiers, or executable expressions. Colors and numeric values come from the validated shared contract; font-family syntax is allowlisted. No inline style objects are emitted.

Current limitations: one primary component, approximate responsive geometry, no font scaling for absolute layouts, no inferred breakpoints or interactions, no asset reconstruction, and no separate design-token stylesheet. Node-level values drive styles. HTML/CSS generation, export, and component inference are not implemented. The generator itself never persists anything: saving generations is done by the generation session model, outside the generator.

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

The code workspace renders the current `GeneratedProject` beside Monaco in an isolated, fully local preview. The pipeline is `GeneratedProject` (plus unsaved Monaco drafts) -> Sucrase TSX transpilation -> deterministic preview CSS -> relative module resolver -> a self-contained `srcDoc` document in a sandboxed iframe. The preview never calls OpenAI, the backend, or any network, and works offline. Source files live in `desktop/src/features/preview/`.

- **Live sync:** Monaco edits overlay the project in memory (nothing is written to disk) and recompile after a 400 ms debounce. Switching files without editing, project replacement, and reset behave as expected; replacement and reset update immediately. Invalid TSX shows a compact, sanitized error over the last good preview, keeps the draft intact, and recovers automatically once fixed.
- **Controls:** Desktop (1440 x 900), Tablet (768 x 1024), and Mobile (390 x 844) presets; Fit, 50%, 75%, and 100% zoom (aspect ratio preserved); manual Refresh/Retry that compiles immediately and cancels stale renders. These controls are presentation-only and never recompile. They are session-only and not persisted. Generated interfaces use fixed-width absolute layouts, so presets scale the same interface rather than producing a different responsive layout.
- **Security:** the iframe uses `sandbox="allow-scripts"` (no `allow-same-origin`, popups, top navigation, or forms) and a CSP of `default-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'` with only inline script/style allowed. Compilation happens outside the frame; the host never evaluates generated code. The preview stage follows the app theme, while the generated interface keeps its own independent colors.
- **Tests:** `desktop/tests/preview*.test.ts` cover the state machine, compiler/runtime, resolver, fit/zoom, sync, controls, and an end-to-end acceptance flow (`preview-acceptance.test.ts`). They need no backend or network.

## Authentication

The desktop reaches the workspace only with an authenticated session; the login screen is the entry point otherwise. `desktop/src/features/auth/` follows the same pattern as the other features:

- `authModel.ts`: React-independent state machine with `RESTORING`, `UNAUTHENTICATED`, `AUTHENTICATING`, `AUTHENTICATED`, `AWAITING_EMAIL_CONFIRMATION`, and `ERROR`. Stale async results are discarded. Snapshots hold a frozen user (`id`, `email`, `emailVerified`) and a safe error code, never a password or token.
- `authProvider.ts`: provider port (`restoreSession`, `signIn`, `signUp`, `signOut`, `getAccessToken`). `createUnconfiguredAuthProvider` is used when Supabase configuration is absent; it never fakes a session.
- `supabaseAuthProvider.ts` and `supabaseClient.ts`: Supabase email/password adapter built from the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (legacy `VITE_SUPABASE_ANON_KEY` is also read). No service-role key exists in the desktop.
- `tauriStrongholdStorage.ts` and `authStorage.ts`: session persistence in a Stronghold vault inside Tauri, with an in-memory fallback elsewhere. Legacy WebView `localStorage` entries are cleaned.
- `authProbe.ts`: after authentication the app calls `GET /api/v1/auth/me` once; a 401 expires the session, while backend downtime or 5xx responses do not.

The access token is read on demand through `authModel.getAccessToken` and is never stored in models, React state, or logs. Projects and generation models receive an `onUnauthorized` callback instead of importing the auth feature; a `UNAUTHORIZED` result there calls `expireSession`. Signing out, expiry, or a different user resets projects, the generation session, editor, preview, and toasts, and the application shell is unmounted rather than hidden.

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
- `ProjectVault.tsx`, `NewProjectDialog.tsx`, `ProjectChip.tsx` with `vaultActions.ts`, `vaultSelectors.ts`, `vaultKeyboard.ts`, and `projectTargetActions.ts`: searchable vault, create/rename/delete flows, opening a project or its latest generation, and the project chip used in the Capture Console. Navigation lives in the shell (`projects`, `capture`, `editor`, `settings`).
- `generationHistoryModel.ts`, `GenerationHistoryTray.tsx`, `discardGuard.ts`, `DiscardDialog.tsx`: per-project history of the current result in the Code view and the single app-level confirmation before unsaved edits are replaced.
- `projectManageActions.ts`, `ProjectManageDialogs.tsx`: rename and delete from each Vault card (sibling buttons of the open button, never nested), confirmed in one app-level dialog host. Both are pessimistic: nothing changes until the server confirms, and a failure keeps the dialog open with the error and Retry. Rename uses the create validation and moves the project to the top of Recent (the server bumps `updatedAt`); the new name shows in the Vault, the project chip, the Library and the Code view. Delete names the project and how many generations go with it (cascade), focuses Cancel and cannot be undone; a 404 counts as already deleted. If the open result belonged to the deleted project, its code and edits stay as a local-only result (`DETACHED`) with no history; late save or restore answers for that project are ignored. A 404 on rename removes the project with a notice. 401 expires the session once; 5xx and network errors never do.
- `libraryModel.ts`, `LibraryDialog.tsx`, `libraryActions.ts`: the Library dialog opened from the rail or the Code view project name; it lazily loads each project's generations with its own model and opens them through the same discard guard and restore flow. A failed refresh keeps the cached list and says so.

Known limitation: there are no idempotency keys, so retrying a save after a response was lost post-commit can store a duplicate generation.

## Floating feedback toasts

`desktop/src/features/feedback/` renders save, restore, and vault outcomes as floating capsules in a fixed viewport outside the document flow. `toastModel.ts` is a React-independent queue (at most three visible, persistent toasts are never evicted for transient ones, timers come from an injected scheduler). `generationToasts.ts` binds generation session state to the queue, so domain models never import toast code. Messages are i18n keys, so a language switch applies to toasts already on screen.

## UI foundation, preferences, and login shell

The login screen is described in [Authentication](#authentication). Email and password fields are never copied to application state or storage beyond the controlled form values needed to submit them. Password visibility is accessible and reversible.

`desktop/src/features/preferences/` owns the UI foundation:

- `preferences.ts`: framework-independent theme/language preferences, defaulting to LIGHT and Spanish, regardless of OS preferences. Only `theme` and `language` are stored under `vision2code.preferences`. Invalid/blocked storage falls back safely to defaults or session-only changes.
- `i18n.ts` and `resources.ts`: bundled Spanish/English resources using i18next and react-i18next, with no remote translation service or reload. The HTML language and root `data-theme` update immediately.
- `useLabels.ts`: presentation translation helpers. Existing framework-independent error/feedback messages are mapped to keys at render time, so messages already on screen also change language. Backend error contracts and generated source are unchanged.
- `PreferenceControls.tsx`: keyboard-accessible, labeled theme and language selectors for Login; within the application shell, Settings is the canonical preferences location.
- `SettingsScreen.tsx`: dedicated Settings screen in `features/settings/` accessible from left navigation, featuring skeuomorphic tactile selectors for Light/Dark appearance and Español/English localization, system telemetry, and default restoration.
- `ScreenshotInput.tsx` (Interactive Upload Surface): the entire screenshot upload tray functions as an interactive file picker. Clicking the central dropzone area, the raised '+' button affordance, or the 'Browse files' button triggers a single shared hidden file picker. Double-triggering is prevented via event containment, drag-and-drop validation is strictly preserved, and reduced-motion preferences disable transitions. Keyboard users can Tab to the '+' affordance or Browse button and activate via Enter/Space.

`styles/foundation.css` defines light/dark surface, text, border, focus, status, and depth tokens, with brand purple centered on #7662F5. Primary buttons use a slightly darker purple for small white-label contrast. Raised and inset surfaces remain restrained; active navigation, workflow steps, file selections, icons, and focus treatment use the brand accent. All screens use the same tokens rather than duplicated dark-mode components.

Lucide supplies the consistent local SVG icon family. Icons accompanying visible labels are decorative; the password visibility control has a translated accessible name. Native selects, labeled inputs, focus outlines, and responsive panels remain keyboard accessible. Login, Capture Console, input states/errors, profile settings, navigation, Workspace actions, and empty states are translated. Technical framework names, file paths, and generated source are never translated. Screenshot file sizes use the active language.

Monaco follows the app theme immediately using its light/vs-dark themes without discarding drafts. Application-owned editor labels switch language live. Monaco's bundled native command/menu translations remain Spanish: those strings are initialized by Monaco at module load and are outside the application's runtime translation resources.

Automated preferences tests cover defaults, switching, persistence, corrupt/unavailable storage, complete bilingual keys, retained messages, login rendering, password visibility, accessible controls, and unchanged editor drafts. Existing screenshot, analysis, generation, and editor suites remain in place. A local Edge smoke check with intercepted analysis tested Login, actual password toggling, both themes/languages, persisted reload preferences, capture -> generation -> Monaco, copying, resets, and file/screen switches. No real analysis/OpenAI calls or external application requests were made.

Not implemented: OAuth providers, password reset, screenshot storage, export, HTML/CSS generation, and the library. Editor drafts are lost on application reload; only generated artifacts are saved. Packaged WebView verification remains manual.

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
