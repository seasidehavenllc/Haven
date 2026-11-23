import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { client, getApp, register } from "./helpers";
import { setSocialKeys } from "../src/lib/social";

let sign: (claims: Record<string, unknown>, opts?: { iss?: string; aud?: string; exp?: string; foreignKey?: boolean }) => Promise<string>;

beforeAll(async () => {
  await getApp();
  const good = await generateKeyPair("RS256");
  const evil = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(good.publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  setSocialKeys("google", keys);
  setSocialKeys("apple", keys);
  sign = (claims, o = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(o.iss ?? "https://accounts.google.com")
      .setAudience(o.aud ?? "web-client.apps.googleusercontent.com")
      .setIssuedAt()
      .setExpirationTime(o.exp ?? "5m")
      .sign(o.foreignKey ? evil.privateKey : good.privateKey);
});
afterAll(() => {
  setSocialKeys("google", undefined);
  setSocialKeys("apple", undefined);
});
afterEach(() => vi.unstubAllEnvs());

const configure = () => {
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "web-client.apps.googleusercontent.com, ios-client.apps.googleusercontent.com");
  vi.stubEnv("APPLE_CLIENT_ID", "com.seasidehaven.haven");
};

describe("sign in with Apple and Google", () => {
  it("refuses until configured and reports which providers are on", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    const anon = await client();
    const r = await anon("POST", "/auth/google", { idToken: await sign({ sub: "x" }) });
    expect(r.status).toBe(503);
    expect(r.json.details.requiredEnv).toEqual(["GOOGLE_OAUTH_CLIENT_ID"]);
    configure();
    expect((await anon("GET", "/auth/providers")).json).toEqual({ apple: true, google: true });
  });

  it("creates an account on first Google sign-in and signs the same person in after", async () => {
    configure();
    const anon = await client();
    const sub = randomUUID();
    const email = `g_${sub.slice(0, 8)}@gmail.com`;
    const first = await anon("POST", "/auth/google", { idToken: await sign({ sub, email, email_verified: true, name: "Riley Shaw" }) });
    expect(first.status).toBe(200);
    expect(first.json.created).toBe(true);
    expect(first.json.user.displayName).toBe("Riley Shaw");
    expect(first.json.user.handle).toMatch(/^rileyshaw/);
    // Any of the configured client ids (here the iOS one) is accepted.
    const again = await anon("POST", "/auth/google", { idToken: await sign({ sub, email, email_verified: true }, { aud: "ios-client.apps.googleusercontent.com" }) });
    expect(again.json).toMatchObject({ created: false, user: { id: first.json.user.id } });
    const me = await (await client(again.json.accessToken))("GET", "/me");
    expect(me.json.user.email).toBe(email);
  });

  it("links a verified email to an existing account but never an unverified one", async () => {
    configure();
    const existing = await register();
    const email = `${existing.tag}@test.dev`;
    const anon = await client();
    const unverified = await anon("POST", "/auth/google", { idToken: await sign({ sub: randomUUID(), email, email_verified: false }) });
    expect(unverified.status).toBe(400);
    const linked = await anon("POST", "/auth/google", { idToken: await sign({ sub: randomUUID(), email, email_verified: true }) });
    expect(linked.json).toMatchObject({ created: false, user: { id: existing.userId } });
  });

  it("rejects forged, expired, wrong-audience and wrong-issuer tokens", async () => {
    configure();
    const anon = await client();
    const claims = { sub: randomUUID(), email: "x@gmail.com", email_verified: true };
    for (const t of [
      await sign(claims, { foreignKey: true }),
      await sign(claims, { exp: "-1m" }),
      await sign(claims, { aud: "someone-elses-app" }),
      await sign(claims, { iss: "https://evil.example" }),
      "not.a.real.jwt.token.at.all.really",
    ])
      expect((await anon("POST", "/auth/google", { idToken: t })).status).toBe(401);
  });

  it("checks Apple's nonce (hashed on native) and uses the name the app passes once", async () => {
    configure();
    const anon = await client();
    const nonce = randomUUID();
    const sub = `001234.${randomUUID().slice(0, 8)}`;
    const apple = (n: string) => sign({ sub, email: `${sub.slice(-8)}@privaterelay.appleid.com`, email_verified: "true", is_private_email: "true", nonce: n }, { iss: "https://appleid.apple.com", aud: "com.seasidehaven.haven" });
    expect((await anon("POST", "/auth/apple", { idToken: await apple(createHash("sha256").update("other").digest("hex")), nonce })).status).toBe(401);
    const ok = await anon("POST", "/auth/apple", { idToken: await apple(createHash("sha256").update(nonce).digest("hex")), nonce, name: "Kody T" });
    expect(ok.status).toBe(200);
    expect(ok.json.user.displayName).toBe("Kody T");
    // A Google token can't be replayed at the Apple endpoint.
    expect((await anon("POST", "/auth/apple", { idToken: await sign({ sub, email_verified: true }) })).status).toBe(401);
  });
});
