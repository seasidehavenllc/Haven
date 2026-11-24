import { describe, it, expect } from "vitest";
import { getApp } from "./helpers";

describe("CORS", () => {
  it("lets the website send PATCH, PUT and DELETE", async () => {
    const app = await getApp();
    for (const method of ["PATCH", "PUT", "DELETE"]) {
      const r = await app.inject({
        method: "OPTIONS",
        url: "/admin/ai/providers/x",
        headers: { origin: "http://localhost:3000", "access-control-request-method": method, "access-control-request-headers": "authorization,content-type" },
      });
      expect(r.statusCode).toBe(204);
      expect(String(r.headers["access-control-allow-methods"])).toContain(method);
      expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    }
  });
});
