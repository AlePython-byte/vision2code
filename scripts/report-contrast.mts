/**
 * Prints the contrast ratios of the form-field, scrollbar and disabled-button tokens in both themes (WCAG 1.4.11
 * asks 3:1 for a control's boundary). Reads `desktop/src/styles/foundation.css`; exits 1 when a pair is below its minimum.
 *   npm run report:contrast
 */
import { readFileSync } from "node:fs";
import { DISABLED_PAIRS, FIELD_FILL_STEP, FIELD_PAIRS, SCROLLBAR_PAIRS, SESSION_NOTICE_PAIRS, ratioFor, readThemeTokens, type Theme } from "./contrast.mts";

const css = readFileSync(new URL("../desktop/src/styles/foundation.css", import.meta.url), "utf8");
const themes = readThemeTokens(css);
let failed = false;
for (const theme of ["light", "dark"] as Theme[]) {
  const tokens = themes[theme];
  console.log(`\n${theme}  (card ${tokens["--color-surface"]}, field fill ${tokens["--color-field"]}, field border ${tokens["--color-field-border"]})`);
  for (const pair of [...FIELD_PAIRS, ...SCROLLBAR_PAIRS, ...DISABLED_PAIRS, ...SESSION_NOTICE_PAIRS]) {
    const ratio = ratioFor(tokens, pair.foreground, pair.background);
    const ok = ratio >= pair.minimum;
    if (!ok) failed = true;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${pair.label.padEnd(26)} ${ratio.toFixed(2)}:1  (min ${pair.minimum}:1)`);
  }
  console.log(`  info field fill / card     ${ratioFor(tokens, FIELD_FILL_STEP.foreground, FIELD_FILL_STEP.background).toFixed(2)}:1`);
}
process.exit(failed ? 1 : 0);
