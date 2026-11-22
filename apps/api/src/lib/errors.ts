export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, "bad_request", msg, details);
export const unauthorized = (msg = "Sign in required") => new HttpError(401, "unauthorized", msg);
export const forbidden = (msg = "Not allowed") => new HttpError(403, "forbidden", msg);
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, "conflict", msg, details);
/** Feature requires an external provider/credential that is not configured. */
export const notConfigured = (what: string, envVars: string[]) =>
  new HttpError(503, "not_configured", `${what} is not configured on this server`, { requiredEnv: envVars });
/** AI usage denied: plan, credits, limits or kill switch. */
export const paymentRequired = (msg: string, details?: unknown) => new HttpError(402, "ai_usage_denied", msg, details);
