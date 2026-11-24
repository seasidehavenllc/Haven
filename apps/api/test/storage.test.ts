import { describe, it, expect, afterEach, vi } from "vitest";
import { env } from "../src/env";
import { readStored, storeUpload } from "../src/storage";
import { PNG } from "./helpers";

const saved = { ...env };
afterEach(() => {
  Object.assign(env, saved);
  vi.unstubAllGlobals();
});

describe("cloud file storage (S3 / Cloudflare R2)", () => {
  it("uploads with a signed request, serves from the public URL, and reads back only its own files", async () => {
    Object.assign(env, {
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://acct123.r2.cloudflarestorage.com",
      S3_BUCKET: "haven-media",
      S3_REGION: "auto",
      S3_ACCESS_KEY_ID: "AKIDEXAMPLE",
      S3_SECRET_ACCESS_KEY: "secret-example",
      CDN_BASE_URL: "https://media.seasidehavenllc.com",
    });
    const stored = new Map<string, ArrayBuffer>();
    const calls: { method: string; url: string; auth: string | null; type: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      calls.push({ method: req.method, url: req.url, auth: req.headers.get("authorization"), type: req.headers.get("content-type") });
      if (req.method === "PUT") {
        stored.set(req.url, await req.arrayBuffer());
        return new Response(null, { status: 200 });
      }
      const body = stored.get(req.url);
      return body ? new Response(body, { status: 200 }) : new Response("NoSuchKey", { status: 404 });
    });

    const f = await storeUpload(PNG, "media/u1");
    expect(f.url).toMatch(/^https:\/\/media\.seasidehavenllc\.com\/media\/u1\/[0-9a-f-]+\.png$/);
    expect(calls[0]).toMatchObject({ method: "PUT", type: "image/png" });
    expect(calls[0]!.url).toBe(`https://acct123.r2.cloudflarestorage.com/haven-media/${f.key}`);
    expect(calls[0]!.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/);
    expect(calls[0]!.auth).not.toContain("secret-example");

    const back = await readStored(f.url);
    expect(Buffer.compare(back.bytes, PNG)).toBe(0);
    await expect(readStored("https://evil.example/media/u1/x.png")).rejects.toThrow();
    await expect(readStored("https://media.seasidehavenllc.com/../etc/passwd")).rejects.toThrow();
  });

  it("says which settings are missing instead of failing silently", async () => {
    Object.assign(env, { STORAGE_DRIVER: "s3", S3_ENDPOINT: undefined, S3_BUCKET: undefined, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined, CDN_BASE_URL: undefined });
    await expect(storeUpload(PNG, "media/u1")).rejects.toMatchObject({ status: 503 });
  });
});
