import { Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Image, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { api } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { Btn, Chip, ErrorNote, Loading, Money, Notice, T, s, useColors } from "@/components/ui";

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { me } = useMe();
  const { data, loading, error, setData } = useApi<any>(`/products/${id}`);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [err, setErr] = useState<any>(null);
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);

  useRealtime(`product:${id}`, {
    "inventory:changed": (v: any) => setData((d: any) => d && { ...d, product: { ...d.product, variants: d.product.variants.map((x: any) => (x.id === v.id ? { ...x, quantity: v.quantity } : x)) } }),
  });

  if (loading) return <Loading />;
  if (error || !data) return <View style={s.screen}><ErrorNote error={error} /></View>;
  const p = data.product;
  const v = p.variants.find((x: any) => x.id === variantId) ?? p.variants.find((x: any) => x.quantity > 0) ?? p.variants[0];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
        {(p.media.length ? p.media : [null]).map((m: any, i: number) => (
          <View key={m?.id ?? i} style={{ width, height: width, backgroundColor: c.line }}>{m && <Image source={{ uri: m.url }} style={{ width, height: width }} />}</View>
        ))}
      </ScrollView>
      <View style={s.screen}>
        {data.liveNow && (
          <Link href={`/live/${data.liveNow.id}`} asChild>
            <Pressable style={[s.note, { backgroundColor: c.live + "1c", flexDirection: "row", gap: 8, alignItems: "center" }]}>
              <Chip label="LIVE" color={c.live} />
              <T size={13} weight="600" color={c.live}>Selling now in “{data.liveNow.title}”. Watch</T>
            </Pressable>
          </Link>
        )}
        <T size={22} weight="700">{p.title}</T>
        <T size={13} color={c.muted}>
          {p.seller.businessName}
          {p.condition ? ` · ${p.condition.replace(/_/g, " ").toLowerCase()}` : ""}
          {p.brand ? ` · ${p.brand}` : ""}
        </T>
        {v && <Money cents={v.priceCents} size={24} />}
        {p.variants.length > 1 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {p.variants.map((x: any) => (
              <Btn key={x.id} kind={x.id === v?.id ? "primary" : "ghost"} title={`${x.name}${x.quantity === 0 ? " (sold out)" : ""}`} onPress={() => setVariantId(x.id)} disabled={x.quantity === 0} />
            ))}
          </View>
        )}
        {v && v.quantity > 0 && v.quantity <= 3 && <T size={13} color={c.live}>Only {v.quantity} left</T>}
        <ErrorNote error={err} />
        {added && <Notice tone="ok">Added to cart.</Notice>}
        <Btn
          title={!v || v.quantity === 0 ? "Sold out" : "Add to cart"}
          disabled={!v || v.quantity === 0}
          busy={busy}
          onPress={async () => {
            if (!me) return router.push("/account");
            setBusy(true);
            setErr(null);
            try {
              await api("/cart/items", { body: { variantId: v.id, quantity: 1 } });
              setAdded(true);
            } catch (e) {
              setErr(e);
            } finally {
              setBusy(false);
            }
          }}
        />
        {added && <Btn kind="ghost" title="Go to cart" onPress={() => router.push("/cart")} />}
        <T style={{ lineHeight: 22 }}>{p.description}</T>
        {!!p.reviews?.length && (
          <View style={{ gap: 8 }}>
            <T size={18} weight="700">Reviews</T>
            {p.reviews.map((r: any) => (
              <View key={r.id} style={[s.card, { borderColor: c.line }]}>
                <T weight="600">{"★".repeat(r.rating)} {r.user.displayName}{r.orderItemId ? " · verified purchase" : ""}</T>
                {r.body && <T size={14}>{r.body}</T>}
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
