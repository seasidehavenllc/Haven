import snapshot from "./demo-data.json";

/**
 * Ids to pre-render in a static export. The demo build pre-renders its sample pages; a production
 * static build renders one placeholder, and app/not-found.tsx serves every real id in the browser.
 */
export function staticParams(kind: "products" | "streams" | "auctions" | "stores" | "users" | "videos" | "studio", param: string) {
  const ids = new Set<string>(["_"]);
  if (process.env.NEXT_PUBLIC_DEMO === "1") {
    const r = snapshot.responses as Record<string, any>;
    const prefix = { products: "/products/", streams: "/streams/", auctions: "/auctions/", stores: "/stores/", users: "/users/", videos: "/videos/", studio: "" }[kind];
    if (prefix) for (const k of Object.keys(r)) if (k.startsWith(prefix) && !k.slice(prefix.length).includes("/") && !k.includes("?")) ids.add(k.slice(prefix.length));
  }
  return [...ids].map((v) => ({ [param]: v }));
}
