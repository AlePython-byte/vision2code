/**
 * Deterministic Tailwind utility styling generator for the generated preview.
 * Operates purely locally with zero remote networks, zero CDN, and zero runtime dependencies.
 */

export const PREVIEW_PREFLIGHT_CSS = `*, ::before, ::after {
  box-sizing: border-box;
  border-width: 0;
  border-style: solid;
  border-color: #e5e7eb;
}
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  background-color: #ffffff;
  color: #0f172a;
}
button, input, textarea {
  font-family: inherit;
  font-size: 100%;
  line-height: inherit;
  color: inherit;
  margin: 0;
  padding: 0;
}
button {
  background: transparent;
  cursor: pointer;
}`;

export const STANDARD_UTILITIES: Record<string, string> = {
  "box-border": "box-sizing: border-box;",
  "min-w-0": "min-width: 0;",
  "absolute": "position: absolute;",
  "relative": "position: relative;",
  "w-full": "width: 100%;",
  "block": "display: block;",
  "inline-block": "display: inline-block;",
  "flex": "display: flex;",
  "flex-row": "flex-direction: row;",
  "flex-col": "flex-direction: column;",
  "flex-wrap": "flex-wrap: wrap;",
  "grid": "display: grid;",
  "grid-flow-col": "grid-auto-flow: column;",
  "justify-start": "justify-content: flex-start;",
  "justify-center": "justify-content: center;",
  "justify-end": "justify-content: flex-end;",
  "justify-between": "justify-content: space-between;",
  "items-start": "align-items: flex-start;",
  "items-center": "align-items: center;",
  "items-end": "align-items: flex-end;",
  "items-stretch": "align-items: stretch;",
  // Emitted by generators v2-v4; without them the preview wrapped single-line text that the exported
  // project keeps on one line (and let placeholders and rows overflow), so both must stay listed.
  "whitespace-pre": "white-space: pre;",
  "flex-nowrap": "flex-wrap: nowrap;",
  "overflow-hidden": "overflow: hidden;",
  "self-start": "align-self: flex-start;",
  "self-center": "align-self: center;",
  "self-end": "align-self: flex-end;",
  "pointer-events-none": "pointer-events: none;",
  "whitespace-pre-wrap": "white-space: pre-wrap;",
  "break-words": "overflow-wrap: break-word;",
  "text-left": "text-align: left;",
  "text-center": "text-align: center;",
  "text-right": "text-align: right;",
  "bg-transparent": "background-color: transparent;",
  "text-inherit": "color: inherit;",
  "[font:inherit]": "font: inherit;",
  "m-0": "margin: 0;",
  "border-0": "border-width: 0;",
  "border-t": "border-top-width: 1px;",
  "border-current": "border-color: currentColor;",
  "border": "border-width: 1px;",
  "border-dashed": "border-style: dashed;",
  "p-2": "padding: 0.5rem;",
  "text-xs": "font-size: 0.75rem; line-height: 1rem;",
};

/** Escapes special characters in class names to form valid CSS selectors. */
export function escapeCssIdentifier(value: string): string {
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

export function parseArbitraryProperty(className: string): { property: string; value: string } | null {
  const match = className.match(/^\[([a-z]+(?:-[a-z]+)*):([^;{}<>\\"]+)\]$/);
  if (!match) return null;
  const property = match[1]!;
  const rawValue = match[2]!;
  // Disallow any control characters, braces, semicolons or HTML breakouts
  if (/[\r\n\t;{}<>]/.test(rawValue)) return null;
  // Tailwind converts underscores to spaces in arbitrary values (e.g., [border:1px_solid_#000])
  const value = rawValue.replace(/_/g, " ").trim();
  if (!value) return null;
  return { property, value };
}

/**
 * Extracts all class names used in project source texts and generates deterministic CSS rules.
 */
export function generatePreviewCss(sources: string[]): string {
  const classNames = new Set<string>();
  const classRegex = /className=(?:\{"([^"]+)"\}|"([^"]+)"|\{'([^']+)'\}|'([^']+)')/g;
  for (const src of sources) {
    let match: RegExpExecArray | null;
    while ((match = classRegex.exec(src)) !== null) {
      const classList = (match[1] || match[2] || match[3] || match[4] || "").split(/\s+/);
      for (const cls of classList) {
        if (cls) classNames.add(cls);
      }
    }
  }

  const rules: string[] = [PREVIEW_PREFLIGHT_CSS];
  for (const cls of classNames) {
    if (STANDARD_UTILITIES[cls]) {
      rules.push(`.${escapeCssIdentifier(cls)} { ${STANDARD_UTILITIES[cls]} }`);
    } else {
      const arbitrary = parseArbitraryProperty(cls);
      if (arbitrary) {
        rules.push(`.${escapeCssIdentifier(cls)} { ${arbitrary.property}: ${arbitrary.value}; }`);
      }
    }
  }
  return rules.join("\n");
}

