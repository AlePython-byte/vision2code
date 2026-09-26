# Vision2Code

A minimal desktop foundation for translating interface screenshots into frontend code. This milestone provides only the application shell; image input, generation, and previews are not implemented.

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
npm run build
npm run check:rust
npm run desktop:build
```

`build` validates both TypeScript configurations and builds the frontend. `check:rust` checks the native project. `desktop:build` also creates native release bundles and requires the platform packaging prerequisites.

## Structure

```text
package.json                     Private npm workspace and root commands
package-lock.json                Single npm dependency lockfile
desktop/
  src/
    App.tsx                      Application composition
    features/workspace/          Shell, navigation, and workspace region
    styles/theme.css             Design tokens and responsive shell styling
  src-tauri/                     Minimal native runner, window configuration, icons
```

The frontend uses React, strict TypeScript, Vite, and Tailwind CSS 4 through `@tailwindcss/vite`. The official Tauri React/TypeScript scaffold is the starting point. IBM Plex Sans and IBM Plex Mono are bundled locally through Fontsource; no remote fonts are requested.

The shell follows a restrained typographic direction: off-white canvas, near-black ink, red accents, and structural borders. CSS theme variables define color, typography, spacing, radius, borders, and motion. The layout adapts to smaller windows and keeps content scrollable. Keyboard users have a skip link and visible focus states; reduced-motion preferences are respected.

Tauri opens a 1280 x 820 window with a 720 x 540 minimum and native window decorations. No custom Rust commands, plugins, or native permissions are enabled. A restrictive production content security policy permits local assets. The scaffold's default bundle icons are retained as development placeholders.

There is no router, global state library, backend, or shared contracts package because the current shell requires none. Future features should live in their own folders under `desktop/src/features/` when implemented.

## References

- [Tauri project scaffolding](https://v2.tauri.app/start/create-project/)
- [Tailwind CSS Vite integration](https://tailwindcss.com/docs/installation/using-vite)
