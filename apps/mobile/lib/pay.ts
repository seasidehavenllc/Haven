import { initPaymentSheet, initStripe, presentPaymentSheet } from "@stripe/stripe-react-native";

let initializedKey: string | null = null;

/**
 * Collect a card with Stripe's own payment sheet. Card details go straight to Stripe and never
 * touch Haven's servers; the order (or credits) is confirmed by Stripe's webhook to the API.
 * Returns "paid", "cancelled", or throws with Stripe's message.
 */
export async function payWithStripe(publishableKey: string, clientSecret: string): Promise<"paid" | "cancelled"> {
  if (initializedKey !== publishableKey) {
    await initStripe({ publishableKey, urlScheme: "haven" });
    initializedKey = publishableKey;
  }
  const init = await initPaymentSheet({
    paymentIntentClientSecret: clientSecret,
    merchantDisplayName: "Haven",
    returnURL: "haven://stripe-redirect",
    style: "alwaysDark",
    appearance: { colors: { primary: "#149ab8", background: "#03060a", componentBackground: "#0b131c", primaryText: "#f4f7fa", secondaryText: "#9aa9b7" } },
  });
  if (init.error) throw new Error(init.error.message);
  const r = await presentPaymentSheet();
  if (r.error) {
    if (r.error.code === "Canceled") return "cancelled";
    throw new Error(r.error.message);
  }
  return "paid";
}
