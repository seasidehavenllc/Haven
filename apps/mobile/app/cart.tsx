import { router } from "expo-router";
import { useState } from "react";
import { Image, ScrollView, View } from "react-native";
import { api, newKey } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Btn, Empty, ErrorNote, Field, Loading, Money, Notice, T, s, useColors } from "@/components/ui";

const blank = { name: "", line1: "", line2: "", city: "", region: "", postalCode: "", country: "US" };

export default function Cart() {
  const c = useColors();
  const { data: cart, loading, error, reload } = useApi<any>("/cart");
  const caps = useApi<any>("/capabilities");
  const [a, setA] = useState(blank);
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [done, setDone] = useState<any>(null);

  if (loading) return <Loading />;
  if (error) return <View style={s.screen}><ErrorNote error={error} /></View>;
  if (done)
    return (
      <View style={s.screen}>
        <T size={24} weight="700">Order placed</T>
        {done.orders[0]?.isTest && <Notice>Test payment: no real money moved. Stripe isn't connected on this server.</Notice>}
        {done.clientSecret && <Notice>Payment confirmation with Stripe's mobile sheet is part of the next build; your order is reserved until payment completes.</Notice>}
        <Btn title="View orders" onPress={() => router.replace("/account")} />
      </View>
    );
  const items = cart?.items ?? [];
  const total = items.reduce((n: number, i: any) => n + i.variant.priceCents * i.quantity, 0);
  const f = (k: keyof typeof blank, label: string) => <Field label={label} value={a[k]} onChangeText={(v) => setA({ ...a, [k]: v })} />;

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      {!items.length ? (
        <Empty title="Your cart is empty" />
      ) : (
        <>
          {items.map((i: any) => (
            <View key={i.id} style={[s.card, { borderColor: c.line, backgroundColor: c.card, flexDirection: "row", alignItems: "center" }]}>
              <View style={{ width: 56, height: 56, borderRadius: 10, overflow: "hidden", backgroundColor: c.line }}>{i.variant.product.media[0] && <Image source={{ uri: i.variant.product.media[0].url }} style={{ width: 56, height: 56 }} />}</View>
              <View style={{ flex: 1 }}>
                <T size={14} weight="600" lines={2}>{i.variant.product.title}</T>
                <T size={12} color={c.muted}>{i.variant.name} · qty {i.quantity}{i.variant.quantity < i.quantity ? ` · only ${i.variant.quantity} left` : ""}</T>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Money cents={i.variant.priceCents * i.quantity} />
                <Btn kind="ghost" title="Remove" onPress={() => api(`/cart/items/${i.variantId}`, { method: "DELETE" }).then(reload)} style={{ minHeight: 32, paddingHorizontal: 10 }} />
              </View>
            </View>
          ))}
          <T size={18} weight="700">Ship to</T>
          {f("name", "Full name")}
          {f("line1", "Address")}
          {f("line2", "Apt, suite (optional)")}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>{f("city", "City")}</View>
            <View style={{ width: 90 }}>{f("region", "State")}</View>
          </View>
          {f("postalCode", "ZIP")}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <T weight="700">Total</T>
            <Money cents={total} />
          </View>
          {caps.data && !caps.data.payments.provider && <Notice>Payments aren't connected on this server yet (needs STRIPE_SECRET_KEY).</Notice>}
          {caps.data?.payments.provider === "test" && <Notice>Test mode: checkout uses a test payment and no money moves.</Notice>}
          <ErrorNote error={err} />
          <Btn
            title="Place order"
            busy={busy}
            disabled={!a.name || !a.line1 || !a.city || !a.region || !a.postalCode}
            onPress={async () => {
              setBusy(true);
              setErr(null);
              try {
                setDone(await api("/checkout", { body: { address: { ...a, line2: a.line2 || undefined }, idempotencyKey: key } }));
              } catch (e) {
                setErr(e);
                reload();
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      )}
    </ScrollView>
  );
}
