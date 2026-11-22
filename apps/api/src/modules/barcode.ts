import { env } from "../env";

/**
 * Barcode/UPC lookup via UPCitemdb (https://www.upcitemdb.com/api/explorer).
 * Uses the paid endpoint with UPCITEMDB_USER_KEY; without it, the free trial endpoint (rate-limited).
 * Results are always presented to the seller for confirmation.
 */
export async function lookupBarcode(code: string) {
  const paid = !!env.UPCITEMDB_USER_KEY;
  const url = paid ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${code}` : `https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`;
  try {
    const res = await fetch(url, {
      headers: paid ? { user_key: env.UPCITEMDB_USER_KEY!, key_type: "3scale" } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { found: false, provider: "upcitemdb", error: `lookup unavailable (${res.status})` };
    const j = (await res.json()) as any;
    const item = j.items?.[0];
    if (!item) return { found: false, provider: "upcitemdb" };
    return {
      found: true,
      provider: "upcitemdb",
      item: { title: item.title, brand: item.brand || null, model: item.model || null, category: item.category || null, description: item.description?.slice(0, 600) || null, images: (item.images ?? []).slice(0, 3) },
      requiresSellerConfirmation: true,
    };
  } catch {
    return { found: false, provider: "upcitemdb", error: "lookup unavailable" };
  }
}
