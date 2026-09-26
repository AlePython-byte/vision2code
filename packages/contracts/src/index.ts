import { z } from "zod";

export const OutputStackSchema = z.enum(["REACT_TAILWIND", "HTML_CSS"]);
export type OutputStack = z.infer<typeof OutputStackSchema>;
