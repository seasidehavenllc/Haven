import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://commerce:commerce@localhost:5432/commerce_test",
      JWT_SECRET: "test-secret-test-secret-test-secret-test-secret",
      ALLOW_TEST_PAYMENTS: "true",
      UPLOAD_DIR: "/tmp/glint-test-uploads",
      TEST_AI_KEY: "test-key",
    },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
