import { z } from "zod";

const PortSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535));

export function readConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const port = PortSchema.safeParse(environment.PORT ?? "3000");
  if (!port.success) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return { port: port.data };
}
