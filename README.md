# Vision2Code

A desktop workspace for translating interface screenshots into frontend code. The desktop supports local screenshot selection, validation, image preview, and output-stack selection. An independent NestJS backend provides health and screenshot analysis through OpenAI, returning validated UISchema v1. The desktop Capture Console sends validated screenshots to that backend on explicit user action. Code generation is not implemented.

## Requirements

- Node.js 22.12+ and npm (Node.js 24 LTS recommended).
- Stable Rust with the MSVC toolchain on Windows.
- Windows: Microsoft C++ Build Tools with the Desktop development with C++ workload and WebView2 Runtime.
- Other platforms: install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Development

Run commands from the repository root:

```sh
npm install
npm run desktop:dev
```

For the browser-only shell, run `npm run dev` and open `http://localhost:1420`.
On Windows PowerShell systems that restrict scripts, use `npm.cmd` instead of `npm`.

```sh
npm run typecheck
npm test
npm run build
npm run check:rust
npm run desktop:build
```

`build` compiles the contracts package, validates the desktop TypeScript configurations, and builds the frontend. The desktop `predev` and `pretypecheck` scripts build contracts automatically, including when invoked by Tauri. `check:rust` checks the native project. `desktop:build` also creates native release bundles and requires the platform packaging prerequisites. Desktop and contract tests use the built-in Node.js test runner and TypeScript stripping; no test framework is installed.

The root `npm test` command runs the complete repository test suite: contracts, desktop, and server. Use `npm run server:test` to run only the backend suite.

## Structure

```text
package.json                     Private npm workspace and root commands
package-lock.json                Single npm dependency lockfile
desktop/
  src/
    App.tsx                      Application composition
    features/workspace/          Shell, navigation, and workspace region
    features/screenshot/         Input UI, feature state, validation, and decoding
    features/analysis/           HTTP client, React-independent model, and Capture Console
    styles/theme.css             Design tokens and responsive shell styling
  tests/                         File validation and decoder lifecycle tests
  src-tauri/                     Minimal native runner, window configuration, icons
packages/contracts/              Zod output-stack, API error, UISchema, and analysis response contracts
server/
  src/
    health/                      Health endpoint and feature module
    http/                        Request IDs, global error filter, and Zod pipe
    ai/                          Provider-agnostic interface only
    analysis/                    Analysis core, multipart HTTP boundary, and provider infrastructure
      providers/                 OpenAI Responses adapter and provider configuration
      http/                      Analysis controller and in-memory upload validation
    configuration.ts             Validated startup configuration
  tests/                         HTTP integration and boundary unit tests
```

The frontend uses React, strict TypeScript, Vite, and Tailwind CSS 4 through `@tailwindcss/vite`. The official Tauri React/TypeScript scaffold is the starting point. IBM Plex Sans and IBM Plex Mono are bundled locally through Fontsource; no remote fonts are requested.

The Capture Console follows the approved visual direction: a light blue-gray canvas, raised and inset surfaces, restrained shadows, purple primary actions, cyan/green status accents, a navigation rail, a workflow strip, and reference/profile panels. This is an initial adaptation of the written direction; exact Figma frame parity has not been verified. CSS theme variables define color, typography, spacing, radius, borders, and motion. The layout adapts to smaller windows and keeps content scrollable. Keyboard users have a skip link and visible focus states; reduced-motion preferences are respected.

Tauri opens a 1280 x 820 window with a 720 x 540 minimum and native window decorations. No custom Rust commands, plugins, or native permissions are enabled. The production content security policy permits local assets and `blob:` images for in-memory previews, plus explicit HTTP connections to localhost:3000 and 127.0.0.1:3000 for the backend. The scaffold's default bundle icons are retained as development placeholders.

There is no frontend router or global state library. Screenshot selection remains in its feature hook. The Capture Console composes it with a screen-scoped analysis model and keeps the existing output-stack selection local to the future generation profile. The contracts workspace exports `OutputStackSchema` and its inferred `OutputStack` type with exactly `REACT_TAILWIND` and `HTML_CSS`, plus the API error envelope, request ID validation, and UISchema v1. It builds JavaScript and declarations consumed by the desktop and ESM backend, with no browser dependencies.

## Backend foundation

The NestJS server exposes `GET /api/v1/health` and `POST /api/v1/analyses`. Health returns:

```json
{ "status": "ok", "service": "vision2code-api" }
```

Run from the repository root:

```sh
npm install
npm run server:dev
```

Before starting, copy `server/.env.example` to `server/.env` and set `OPENAI_API_KEY` locally, or supply it through the process environment. The provider fails construction with an English configuration error if the key is missing. This is required to start the application, including its health endpoint. `OPENAI_MODEL` defaults to `gpt-6.1-sol`; an explicitly empty value is rejected. `PORT` defaults to 3000, and invalid ports fail startup. Never put a real key in `.env.example`.

The development command compiles contracts and the server, then starts it at `http://localhost:3000`. It does not watch source files; restart the command after edits. The server binds to `127.0.0.1` for local development. Node loads `server/.env`; existing process environment values take precedence. Actual `.env` files and variants remain ignored by Git; `.env.example` is the non-secret template.

```sh
npm run server:build
npm run server:test
```

Server TypeScript is strict and emits ESM using the existing compiler. Tests compile TypeScript before running Node's built-in test runner; no Nest CLI, Jest, or Supertest is needed. `@nestjs/testing` overrides the AI provider before constructing the application. HTTP integration tests use an ephemeral loopback port and Node fetch. Provider tests inject a simulated transport into the official SDK. Normal automated tests require no API key, make zero real OpenAI calls, and consume zero AI credits. No production test routes exist.

`AppModule` imports `HealthModule` and `AnalysisModule`. The `AI_PROVIDER` injection token binds the production `OpenAIProvider` to `AnalyzeInterfaceUseCase`, which depends only on the provider abstraction. Bootstrap applies the `api/v1` prefix, request ID middleware, explicit CORS policy, and global exception filter. The middleware runs before CORS and body parsing. Every application HTTP response includes `X-Request-Id`. Incoming IDs must be 1–128 ASCII letters, digits, dots, underscores, colons, or hyphens, beginning with a letter or digit. Invalid or missing IDs receive a platform-generated UUID. IDs are correlation metadata, not authentication or trusted identity.

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

CORS explicitly allows the Vite origins `http://localhost:1420` and `http://127.0.0.1:1420`, plus packaged desktop origins `tauri://localhost`, `http://tauri.localhost`, and `https://tauri.localhost`. GET and POST are permitted without credentials; `X-Request-Id` is exposed. Unlisted browser origins receive no CORS permission; CORS is not authentication. No wildcard origin, HTTP plugin, or new native capability is used.

`AIProvider` defines an asynchronous, cancellable analysis boundary independent of Nest HTTP objects. It accepts `AnalysisImageInput` and returns `Promise<unknown>` so external output cannot bypass application validation. The production adapter uses the official `openai` SDK. There is no persistence, authentication, provider fallback, or code generation.

## Screenshot analysis API

`POST /api/v1/analyses` accepts `multipart/form-data` with exactly one file named `image` and two text fields, `viewportWidth` and `viewportHeight`. Dimensions must be positive safe integers in decimal notation. `targetStack`, other extra fields, duplicate dimensions, additional files, JSON bodies, and user-supplied image URLs are rejected.

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
| Missing file, invalid dimensions, malformed multipart or extra fields | 400 | `INVALID_REQUEST` |
| Unsupported MIME, empty bytes or mismatched signature | 415 | `UNSUPPORTED_IMAGE` |
| Image above 10 MB | 413 | `IMAGE_TOO_LARGE` |
| OpenAI HTTP 429 | 429 | `AI_RATE_LIMITED` |
| Network/provider failure, timeout or cancellation | 503 | `AI_UNAVAILABLE` |
| Invalid, refused or incomplete provider output | 502 | `AI_OUTPUT_INVALID` |

`ANALYSIS_TIMEOUT_MS` is 120,000 ms, shared by the HTTP analysis cancellation signal and SDK timeout. The analysis signal starts after upload validation. Client disconnects abort in-flight provider work where the socket close can be observed. No response can be delivered to an already disconnected client. SDK automatic retries are explicitly disabled both on the production client and per request; the use case has no retry or fallback.


Development analysis diagnostics are emitted as JSON console records with context `AnalysisDiagnostic` unless `NODE_ENV=production`. Events distinguish `provider_response`, `provider_error`, `output_parse_failed`, and `ui_schema_validation_failed`. Response metadata includes allowlisted status/incomplete reason/error code, completion flags, refusal presence, and whether parsed output or non-empty output text exists. The adapter uses `responses.create()` followed by `JSON.parse`, so missing `output_parsed` is normal and is not itself a failure. Errors include recognized class names, fixed safe English messages, and numeric HTTP status where available; unknown provider codes/reasons are recorded as `other`. Final Zod diagnostics include only up to 20 issue paths/codes, with paths capped at 32 segments and a truncation flag. No raw error messages, headers, credentials, environment values, images, generated output, or Zod issue values/messages are logged. These diagnostics do not alter the public error envelope.

### Optional manual live request

This procedure performs one real analysis and consumes paid OpenAI API usage. It is never executed by automated tests. Set `OPENAI_API_KEY` in your ignored `server/.env`, retain `OPENAI_MODEL=gpt-6.1-sol`, and run `npm.cmd run server:dev`. In a second PowerShell terminal, replace the example path and dimensions with those of a real supported screenshot, then execute once:

```powershell
curl.exe --request POST "http://localhost:3000/api/v1/analyses" --header "X-Request-Id: manual-analysis-001" --form "image=@C:/path/to/screenshot.png;type=image/png" --form "viewportWidth=1280" --form "viewportHeight=820"
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

The desktop retains the original validated File and decoded dimensions in memory. It uploads the selected screenshot only when the user activates analysis; it does not persist images or analysis results. Object URLs are revoked after decoding failure, cancellation, successful replacement, removal, and feature cleanup. The preview preserves aspect ratio and constrains its width and height; long file names wrap. All product copy is Spanish, while source identifiers and technical documentation remain English.

## Desktop analysis integration

The Capture Console composes screenshot selection with a small feature boundary in `desktop/src/features/analysis/`:

- `analysisClient.ts`: browser fetch transport, multipart construction, shared success/error contract validation, and fixed Spanish error messages. It sends only `image`, `viewportWidth`, and `viewportHeight` using browser-decoded dimensions and the validated MIME. The browser sets the multipart boundary. No profile settings, output stack, provider key, or provider configuration are sent.
- `analysisModel.ts`: React-independent screen-scoped state with `IDLE`, `READY`, `ANALYZING`, `SUCCESS`, and `ERROR`. `getSnapshot().result` stores validated `{ requestId, uiSchema }`; Task 005 can consume `result.uiSchema` without importing a component or invoking the provider. State is not persisted.
- `useAnalysis.ts`: subscribes React to the model, synchronizes validated selection, and aborts/disposes work on unmount.
- `CaptureConsole.tsx`: presentation and feature composition, including the profile panel, primary action, cancellation, and Spanish announcements.

The primary action is labeled “Activar generador” (the Spanish product label for “Engage generator”), with an explanation that this stage only analyzes. It is disabled without a validated image, during image validation, and during analysis. An active request preserves the preview and cannot be submitted twice. Failures allow manual retry with the same image. Cancelling, replacing/removing an image, or unmounting aborts work; obsolete responses cannot replace newer state. There are no automatic retries or invented progress percentages. A 150-second client transport deadline allows time beyond the backend's 120-second analysis deadline.

The profile preserves the existing React/Tailwind versus HTML/CSS selection. Fidelity is informational and instructions are disabled with a “Próximamente” label. Profile settings do not alter analysis. Projects, library, export, code generation, and generated previews remain unavailable.

Copy `desktop/.env.example` to an ignored `desktop/.env` only when overriding the default `VITE_API_BASE_URL=http://localhost:3000/api/v1`. Vite embeds `VITE_` values in public client code: never place provider secrets there. Start the backend separately with `npm.cmd run server:dev`, then the desktop with `npm.cmd run desktop:dev` (or browser mode with `npm.cmd run dev`). Real analysis consumes provider usage. A custom API origin must also be explicitly allowed by packaged Tauri `connect-src`; a custom frontend origin must be allowed by backend CORS. Restart/rebuild after environment or CSP changes.

Automated desktop tests inject HTTP transports and fixtures. They cover payloads/dimensions, MIME normalization, state transitions, malformed responses, sanitized errors, retry, duplicate submission, cancellation, stale responses, disposal, and subscriptions. They never contact OpenAI. Manually verify the packaged WebView against the local backend separately when authorizing a paid live analysis.

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

- [Tauri project scaffolding](https://v2.tauri.app/start/create-project/)
- [Tailwind CSS Vite integration](https://tailwindcss.com/docs/installation/using-vite)
- [Tauri window configuration and HTML5 drag and drop](https://v2.tauri.app/reference/config/#dragdropenabled)
- [WebView file input behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)
- [NestJS exception filters](https://docs.nestjs.com/exception-filters)
- [Node environment file support](https://nodejs.org/api/cli.html#--env-filefile)
- [Zod recursive object inference](https://zod.dev/api#recursive-objects)
