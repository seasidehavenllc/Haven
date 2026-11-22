import { execSync } from "node:child_process";

/** Rebuilds the dedicated *_test database before each run. Refuses any other database. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://commerce:commerce@localhost:5432/commerce_test";
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma db execute --stdin --schema prisma/schema.prisma", { env, input: "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;", stdio: ["pipe", "ignore", "inherit"] });
  execSync("npx prisma migrate deploy", { env, stdio: ["ignore", "ignore", "inherit"] });
  execSync("npx tsx prisma/seed.ts", { env, stdio: ["ignore", "ignore", "inherit"] });
}
