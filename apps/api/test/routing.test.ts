import { describe, it, expect } from "vitest";
import { getApp } from "./helpers";

describe("routing", () => {
  it("tolerates a base URL saved with a trailing slash (//auth/login) and trailing slashes on routes", async () => {
    const app = await getApp();
    const tag = `slash${Date.now()}`;
    const email = `${tag}@test.dev`;
    const reg = await app.inject({ method: "POST", url: "//auth/register", payload: { email, password: "correct horse battery", displayName: "Slash Test", handle: `u_${tag}` } });
    expect(reg.statusCode).toBe(200);
    const login = await app.inject({ method: "POST", url: "//auth/login", payload: { email, password: "correct horse battery" } });
    expect(login.statusCode).toBe(200);
    expect(login.json().accessToken).toBeTruthy();
    expect((await app.inject({ method: "GET", url: "/health/" })).statusCode).toBe(200);
  });
});
