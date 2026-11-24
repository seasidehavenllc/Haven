"use client";
import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

const cache = new Map<string, ReturnType<typeof loadStripe>>();
const stripeFor = (key: string) => {
  if (!cache.has(key)) cache.set(key, loadStripe(key));
  return cache.get(key)!;
};

/**
 * Stripe's card form for a PaymentIntent the API created. Card details go straight to Stripe and
 * never touch Haven's servers. The order (or credits) is confirmed by Stripe's webhook, not here.
 */
export function CardPayment({ publishableKey, clientSecret, label, onPaid }: { publishableKey: string; clientSecret: string; label: string; onPaid: () => void }) {
  const stripe = useMemo(() => stripeFor(publishableKey), [publishableKey]);
  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret,
        appearance: {
          theme: "night",
          variables: { colorPrimary: "#149ab8", colorBackground: "#0b131c", colorText: "#f4f7fa", colorTextSecondary: "#9aa9b7", colorDanger: "#ff4d6d", borderRadius: "12px", fontFamily: "inherit" },
        },
      }}
    >
      <Form label={label} onPaid={onPaid} />
    </Elements>
  );
}

function Form({ label, onPaid }: { label: string; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-3 text-left"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setBusy(true);
        setErr(null);
        // Cards finish here; bank redirects (3-D Secure) come back to the orders page.
        const r = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { return_url: `${window.location.origin}/orders` } });
        setBusy(false);
        if (r.error) setErr(r.error.message ?? "The payment didn't go through.");
        else if (r.paymentIntent?.status === "succeeded" || r.paymentIntent?.status === "processing") onPaid();
        else setErr("The payment wasn't completed. Try again or use another card.");
      }}
    >
      <PaymentElement options={{ layout: "tabs" }} />
      {err && <p className="text-sm text-live">{err}</p>}
      <button className="btn-primary w-full py-3" disabled={!stripe || busy}>
        {busy ? "Paying…" : label}
      </button>
    </form>
  );
}
