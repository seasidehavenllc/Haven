import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { HttpError, notConfigured } from "./errors";

/**
 * Sign in with Apple / Google: the app or web page gets an ID token from the provider, and we verify
 * it here against the provider's published keys (signature, issuer, audience, expiry, nonce).
 * We never see the user's provider password and we store no provider tokens.
 */
export type SocialProvider = "apple" | "google";
export type SocialIdentity = { provider: SocialProvider; sub: string; email: string | null; emailVerified: boolean; name: string | null; picture: string | null };

const CONFIG = {
  apple: { envVar: "APPLE_CLIENT_ID", issuer: ["https://appleid.apple.com"], jwks: "https://appleid.apple.com/auth/keys" },
  google: { envVar: "GOOGLE_OAUTH_CLIENT_ID", issuer: ["https://accounts.google.com", "accounts.google.com"], jwks: "https://www.googleapis.com/oauth2/v3/certs" },
} as const;

const keySets: Partial<Record<SocialProvider, JWTVerifyGetKey>> = {};
/** Tests swap in a local key set so no network calls are made. */
export function setSocialKeys(provider: SocialProvider, keys: JWTVerifyGetKey | undefined) {
  if (keys) keySets[provider] = keys;
  else delete keySets[provider];
}

/** Client ids this server accepts. Comma-separated, because web, iOS and Android each have their own. */
export const socialAudiences = (p: SocialProvider) =>
  (process.env[CONFIG[p].envVar] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const socialConfigured = (p: SocialProvider) => socialAudiences(p).length > 0;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const truthy = (v: unknown) => v === true || v === "true";

export async function verifySocialToken(provider: SocialProvider, idToken: string, nonce?: string): Promise<SocialIdentity> {
  const cfg = CONFIG[provider];
  const audience = socialAudiences(provider);
  if (!audience.length) throw notConfigured(`Sign in with ${provider === "apple" ? "Apple" : "Google"}`, [cfg.envVar]);
  keySets[provider] ??= createRemoteJWKSet(new URL(cfg.jwks));
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keySets[provider]!, { issuer: [...cfg.issuer], audience, clockTolerance: 30 }));
  } catch {
    throw new HttpError(401, "invalid_token", "That sign-in didn't go through. Please try again.");
  }
  // Apple native flows put sha256(nonce) in the token; web flows put the nonce itself.
  if (nonce && payload.nonce !== nonce && payload.nonce !== sha256(nonce)) throw new HttpError(401, "invalid_token", "That sign-in didn't go through. Please try again.");
  if (!payload.sub) throw new HttpError(401, "invalid_token", "Sign-in token has no subject");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  return {
    provider,
    sub: payload.sub,
    email,
    emailVerified: !!email && truthy(payload.email_verified),
    name: typeof payload.name === "string" ? payload.name : null,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
