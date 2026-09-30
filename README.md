# Vision2Code

A desktop workspace for translating interface screenshots into frontend code. The desktop supports local screenshot selection, validation, image preview, and output-stack selection. An independent NestJS backend provides health and a standardized HTTP boundary. The desktop does not call the backend yet; no AI provider, external AI API call, or code generation is implemented.

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
    styles/theme.css             Design tokens and responsive shell styling
  tests/                         File validation and decoder lifecycle tests
  src-tauri/                     Minimal native runner, window configuration, icons
packages/contracts/              Zod output-stack, API error, and UISchema contracts
server/
  src/
    health/                      Health endpoint and feature module
    http/                        Request IDs, global error filter, and Zod pipe
    ai/                          Provider-agnostic interface only
    analysis/                    Analysis input, use case, error, and versioned prompt
    configuration.ts             Validated startup configuration
  tests/                         HTTP integration and boundary unit tests
```

The frontend uses React, strict TypeScript, Vite, and Tailwind CSS 4 through `@tailwindcss/vite`. The official Tauri React/TypeScript scaffold is the starting point. IBM Plex Sans and IBM Plex Mono are bundled locally through Fontsource; no remote fonts are requested.

The shell follows a restrained typographic direction: off-white canvas, near-black ink, red accents, and structural borders. CSS theme variables define color, typography, spacing, radius, borders, and motion. The layout adapts to smaller windows and keeps content scrollable. Keyboard users have a skip link and visible focus states; reduced-motion preferences are respected.

Tauri opens a 1280 x 820 window with a 720 x 540 minimum and native window decorations. No custom Rust commands, plugins, or native permissions are enabled. The production content security policy permits local assets and `blob:` images for in-memory previews. The scaffold's default bundle icons are retained as development placeholders.

There is no frontend router or global state library. Screenshot state and output-stack selection stay inside the screenshot feature. The contracts workspace exports `OutputStackSchema` and its inferred `OutputStack` type with exactly `REACT_TAILWIND` and `HTML_CSS`, plus the API error envelope, request ID validation, and UISchema v1. It builds JavaScript and declarations consumed by the desktop and ESM backend, with no browser dependencies.

## Backend foundation

The NestJS server is the future boundary between the desktop and external AI providers. It currently exposes only `GET /api/v1/health`:

```json
{ "status": "ok", "service": "vision2code-api" }
```

Run from the repository root:

```sh
npm install
npm run server:dev
```

The development command compiles contracts and the server, then starts it at `http://localhost:3000`. It does not watch source files; restart the command after edits. The server binds to `127.0.0.1` for local development. Optionally copy `server/.env.example` to `server/.env` to change `PORT`. Node loads that file; existing process environment values take precedence. The default is 3000, and invalid ports fail startup. Actual `.env` files and variants are ignored by Git; `.env.example` is the non-secret template.

```sh
npm run server:build
npm run server:test
```

Server TypeScript is strict and emits ESM using the existing compiler. Tests compile TypeScript before running Node's built-in test runner; no Nest CLI, Jest, Supertest, or extra test framework is needed. Integration tests start the real Nest application on an ephemeral loopback port and use Node fetch. Error-filter tests invoke the filter directly; no production test routes exist.

`AppModule` imports `HealthModule`. Bootstrap applies the `api/v1` prefix, request ID middleware, explicit CORS policy, and global exception filter. The middleware runs before CORS and body parsing. Every application HTTP response includes `X-Request-Id`. Incoming IDs must be 1–128 ASCII letters, digits, dots, underscores, colons, or hyphens, beginning with a letter or digit. Invalid or missing IDs receive a platform-generated UUID. IDs are correlation metadata, not authentication or trusted identity.

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

HTTP exceptions retain their status. A 404 maps to `NOT_FOUND`, other client errors to `INVALID_REQUEST`, and server/unexpected errors to `INTERNAL_ERROR`. Default client messages are Spanish. Responses never copy exception messages, validation issues, or stack traces; server-error logs include only correlation ID and HTTP status. Unknown routes also use this envelope. A small `ZodValidationPipe` validates future route-bound schemas and supports transformed output and asynchronous refinements. There is no request DTO or request endpoint to attach it to yet.

Development CORS allows only `http://localhost:1420` and `http://127.0.0.1:1420`, with GET, no credentials, and `X-Request-Id` exposed to clients. Unlisted browser origins receive no CORS permission; CORS is not access control. Production origins and deployment are not configured. No desktop connectivity or Tauri permission changes were made.

`AIProvider` defines an asynchronous, cancellable analysis boundary independent of Nest HTTP objects. It accepts `AnalysisImageInput` and returns `Promise<unknown>` so external output cannot bypass application validation. No production implementation, injection registration, AI endpoint, provider SDK, provider credentials, or paid integration exists. There is no persistence, authentication, or screenshot upload.

## Provider-independent analysis core

UISchema v1 is the structured representation that future visual analysis will return, independently of generated code technology. Zod is its source of truth; `UISchema` and recursive `UINode` are inferred types. The public contracts entry point exports `UISchemaSchema`, `UINodeSchema`, and both types. All object fields are required, nullable values must be explicit, and unknown fields are rejected.

The envelope contains `schemaVersion: "1.0"`, positive integer screenshot dimensions in `source`, `confidence` from 0 to 1, `designTokens`, a recursive `root`, and technical `warnings`. Tokens contain arrays of named colors, named typography, non-negative spacing, and non-negative radii. There are no global shadow tokens or arbitrary token records.

Every node contains `id`, `type`, `name`, `bounds`, `layout`, `style`, `text`, `image`, and `children`. The only node types are FRAME, TEXT, IMAGE, ICON, BUTTON, INPUT, and DIVIDER. Leaves use an empty children array. Bounds record observed screenshot-relative geometry, not a code-generation positioning strategy. Layout describes NONE/FLEX/GRID/ABSOLUTE relationships with enumerated direction, justification and alignment, gap, columns, and structured padding. Styles contain color values, structured borders and shadows, radius, and opacity rather than CSS declarations. Optional text and image data use explicit null values.

Dimensions are pixels, including typography line height. Uncertain typography values may be null; offsets, shadow spread, and letter spacing may be negative, while widths, heights, padding, gaps, radii, and blur cannot. Colors are normalized hex strings (#RGB, #RGBA, #RRGGBB, or #RRGGBBAA), including alpha when needed, to avoid arbitrary CSS expressions. Readable screenshot text is preserved in its original language. Names, image descriptions, and warnings are technical English; these semantic instructions live in the prompt, not a language-detection validator.

`server/src/analysis/` contains a small application core with no Nest or HTTP coupling:

- `analysis-image-input.ts`: a strict runtime schema and inferred types for non-empty `Uint8Array` bytes, PNG/JPEG/WEBP MIME, and positive integer width/height. No `OutputStack` is accepted. This boundary validates metadata and byte representation; it does not decode or preprocess images.
- `analyze-interface.use-case.ts`: validates the input, invokes the injected provider once, validates its untrusted result with `UISchemaSchema`, and returns the parsed schema. Cancellation is forwarded and checked before/after provider work; provider failures propagate without retries or fallback content.
- `invalid-analysis-output.error.ts`: a compact technical application error for invalid provider output. It exposes neither provider content nor Zod issue dumps. No new public API error code or endpoint mapping is introduced.
- `prompts/analyzer-system.v1.ts`: the versioned English system prompt for future provider adapters. It requires evidence-based interface analysis, preserves readable text, and forbids invented content, URLs, source code, breakpoints, hover states, hidden menus, or behavior. It is not sent to a model in this task.

Deterministic JSON fixtures live only under `packages/contracts/tests/fixtures/` and are shared by contract and server tests. Test-only provider doubles verify valid and invalid output, binary data/metadata forwarding, stack exclusion, error propagation, and cancellation. Tests use zero AI credits and need no API key. This core is not registered in the running Nest application, and screenshot-to-AI analysis is not available to users. No external AI API is called.

## Local screenshot workflow

The keyboard-accessible selection button invokes the WebView's native file chooser through an HTML file input. Files dropped into the input region follow the same validation path. Tauri's `dragDropEnabled` is disabled to allow frontend HTML5 drag and drop on Windows. No filesystem plugin or arbitrary file paths are exposed. Dropping files outside the region cannot navigate away from the application.

Only PNG, JPEG, and WEBP are supported. `MAX_SCREENSHOT_BYTES` defines the limit as 10,000,000 bytes (10 decimal MB). Validation checks the size before reading, the extension, the browser-provided MIME when present, and the file signature. A missing MIME is accepted only when the extension and signature match. A browser image decoder must then successfully load the image and report nonzero dimensions.

The UI exposes `EMPTY`, `DRAGGING`, `VALIDATING`, `READY`, and `ERROR` states through Spanish copy and accessible announcements. It shows the file name, dimensions, size, and detected format. Invalid replacements retain the previous image; cancelling the file chooser leaves the selection unchanged. Multiple files are rejected. Removal cancels pending work and returns to the empty state. A newer selection cancels the previous request so stale work cannot replace the current image.

Images are never uploaded or persisted. Object URLs are revoked after decoding failure, cancellation, successful replacement, removal, and feature cleanup. The preview preserves aspect ratio and constrains its width and height; long file names wrap. All product copy is Spanish, while source identifiers and technical documentation remain English.

## Manual verification

Automated tests cover format metadata/signatures, empty or unsupported files, the exact size boundary, early rejection of oversized files, cancellation, temporary URL cleanup with a simulated decoder, and the shared stack schema. They do not substitute for native GUI verification.

Run `npm run desktop:dev` and verify in the actual desktop WebView:

- Select a valid PNG, JPEG, and WEBP through the file chooser and by dropping each file into the region. Check the preview and metadata.
- Drop an unsupported file, a renamed non-image, a corrupt image, multiple files, and a file larger than 10 MB. Check the Spanish errors and preservation of any previous selection.
- Replace and remove an image; select the same file again and cancel the chooser. Try rapid replacement or removal during validation.
- Change between React + Tailwind CSS and HTML + CSS using both mouse and keyboard.
- Resize to 720 x 540, use a long file name and wide/tall images, and confirm scrolling without horizontal page overflow. Check keyboard focus, announcements, and reduced-motion behavior.

This environment has no connected native UI or browser surface, so these manual checks remain pending.

## References

- [Tauri project scaffolding](https://v2.tauri.app/start/create-project/)
- [Tailwind CSS Vite integration](https://tailwindcss.com/docs/installation/using-vite)
- [Tauri window configuration and HTML5 drag and drop](https://v2.tauri.app/reference/config/#dragdropenabled)
- [WebView file input behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)
- [NestJS exception filters](https://docs.nestjs.com/exception-filters)
- [Node environment file support](https://nodejs.org/api/cli.html#--env-filefile)
- [Zod recursive object inference](https://zod.dev/api#recursive-objects)
