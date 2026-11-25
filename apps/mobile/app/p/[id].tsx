import { Link, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Image, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { api } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { report } from "@/lib/safety";
import { confirmDelete, setShown } from "@/lib/listing";
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
        {me && me.seller?.id !== p.sellerId && (
          <Pressable hitSlop={8} accessibilityLabel="Report this listing" onPress={() => report("product", p.id, "this listing")} style={{ alignSelf: "flex-start" }}>
            <T size={12} color={c.muted}>Report listing</T>
          </Pressable>
        )}
        {me?.seller?.id === p.sellerId && (
          <View style={[s.card, { borderColor: c.line, backgroundColor: c.card, gap: 10 }]}>
            <T size={13} color={c.muted}>
              {p.status === "ACTIVE" ? "This is your listing. Buyers can see it in your shop." : p.status === "DRAFT" ? "This listing is hidden. Buyers can't see it." : "You deleted this listing."}
            </T>
            {p.status !== "ARCHIVED" && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Btn
                  kind="ghost"
                  icon={p.status === "DRAFT" ? "eye-outline" : "eye-off-outline"}
                  title={p.status === "DRAFT" ? "Show in shop" : "Hide from shop"}
                  busy={busy}
                  style={{ flex: 1 }}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      const shown = p.status === "DRAFT";
                      await setShown(p.id, shown);
                      setData((d: any) => ({ ...d, product: { ...d.product, status: shown ? "ACTIVE" : "DRAFT" } }));
                    } catch (e) {
                      setErr(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                <Btn kind="danger" icon="trash-outline" title="Delete" style={{ flex: 1 }} onPress={async () => { if (await confirmDelete(p)) router.back(); }} />
              </View>
            )}
          </View>
        )}
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
            if (!me) return router.push("/login");
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
