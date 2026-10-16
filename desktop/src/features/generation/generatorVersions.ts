import type { UISchema } from "@vision2code/contracts";
import { generateReactProjectV3 } from "./generateReactProjectV3.ts";
import type { GeneratedProject } from "./generatedProject.ts";

/**
 * The previous generator, kept only as the "before" side of the fidelity comparison
 * (`npm run report:fidelity`, `npm run measure:layout`). Only the immediately previous version is
 * kept; stored generations of older versions are data and never need their generator.
 */
export const GENERATOR_VERSIONS: readonly { version: string; generate: (schema: UISchema) => GeneratedProject }[] = [
  { version: "3", generate: generateReactProjectV3 },
];
