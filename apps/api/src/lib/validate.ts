import type { ZodTypeAny, z } from "zod";
import { badRequest } from "./errors";
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest("Validation failed", r.error.flatten());
  return r.data;
}
