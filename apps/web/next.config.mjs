/** @type {import('next').NextConfig} */
const staticExport = process.env.STATIC_EXPORT === "1";
export default {
  transpilePackages: ["@haven/shared"],
  images: { unoptimized: true },
  // GitHub Pages build: plain files, no Node server. Pages Next can't pre-render come from app/not-found.tsx.
  ...(staticExport ? { output: "export" } : {}),
};
