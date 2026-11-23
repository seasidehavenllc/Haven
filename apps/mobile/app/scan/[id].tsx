import { ProductConditions } from "@glint/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Switch, View } from "react-native";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Btn, ErrorNote, Field, Loading, Money, Notice, T, s, useColors } from "@/components/ui";

const label = (x: string) => x.replace(/_/g, " ").toLowerCase();

export default function ReviewScan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const scan = useApi<any>(`/seller/scans/${id}`);
  const cats = useApi<any[]>("/categories");
  const [f, setF] = useState<any>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = scan.data?.draft ?? {};
    const r = scan.data?.result ?? {};
    if (scan.data && !f)
      setF({
        title: d.title ?? "",
        description: d.description ?? "",
        categoryId: d.categoryId ?? "",
        brand: d.brand ?? r.brand?.value ?? "",
        model: d.model ?? r.model?.value ?? "",
        condition: d.condition ?? "",
        tags: (d.tags ?? []).join(", "),
        price: "",
        quantity: String(d.quantity ?? 1),
        addToLiveMenu: true,
      });
  }, [scan.data]);

  if (scan.error) return <View style={s.screen}><ErrorNote error={scan.error} /></View>;
  if (scan.loading || !f) return <Loading />;
  const sc = scan.data;
  const r = sc.result ?? {};
  const set = (k: string) => (v: any) => setF({ ...f, [k]: v });
  const priceCents = Math.round(Number(f.price) * 100);

  async function publish() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/seller/scans/${id}/publish`, {
        body: {
          title: f.title,
          description: f.description,
          categoryId: f.categoryId || undefined,
          brand: f.brand || null,
          model: f.model || null,
          condition: f.condition,
          tags: f.tags.split(",").map((t: string) => t.trim()).filter(Boolean),
          priceCents,
          priceConfirmed: true,
          quantity: Number(f.quantity),
          addToLiveMenu: f.addToLiveMenu,
        },
      });
      router.back();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
        {sc.imageUrls.map((u: string) => (
          <Image key={u} source={{ uri: u }} style={{ width: 110, height: 110, borderRadius: 12 }} />
        ))}
      </ScrollView>
      {sc.status === "FAILED" && <Notice>AI couldn't analyze this ({sc.error}). You can still fill it in by hand.</Notice>}
      {!!r.questionsForSeller?.length && <Notice tone="ai">{"The AI needs you to confirm:\n" + r.questionsForSeller.map((q: string) => `• ${q}`).join("\n")}</Notice>}
      {r.barcode?.found && <Notice tone="ok">Barcode match: {r.barcode.item.title}. Make sure this is the exact item you're selling.</Notice>}
      <Field label="Title" value={f.title} onChangeText={set("title")} />
      <Field label="Description" value={f.description} onChangeText={set("description")} multiline style={{ minHeight: 110, paddingTop: 10, textAlignVertical: "top" }} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="Brand" value={f.brand} onChangeText={set("brand")} placeholder="Blank if unknown" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Model" value={f.model} onChangeText={set("model")} />
        </View>
      </View>
      <T size={12} weight="600" color={c.muted}>CONDITION</T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {ProductConditions.map((x) => (
          <Btn key={x} kind={f.condition === x ? "primary" : "ghost"} title={label(x)} onPress={() => set("condition")(x)} style={{ minHeight: 36, paddingHorizontal: 12 }} />
        ))}
      </View>
      {r.condition?.notes && <T size={12} color={c.muted}>AI condition notes: {r.condition.notes}</T>}
      <T size={12} weight="600" color={c.muted}>CATEGORY</T>
      <ScrollView horizontal contentContainerStyle={{ gap: 6 }}>
        {(cats.data ?? []).map((x) => (
          <Btn key={x.id} kind={f.categoryId === x.id ? "primary" : "ghost"} title={x.name} onPress={() => set("categoryId")(x.id)} style={{ minHeight: 36, paddingHorizontal: 12 }} />
        ))}
      </ScrollView>
      <Field label="Tags (comma separated)" value={f.tags} onChangeText={set("tags")} autoCapitalize="none" />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="Your price ($)" keyboardType="decimal-pad" value={f.price} onChangeText={(v) => set("price")(v.replace(/[^0-9.]/g, ""))} />
        </View>
        <View style={{ width: 100 }}>
          <Field label="Quantity" keyboardType="number-pad" value={f.quantity} onChangeText={(v) => set("quantity")(v.replace(/\D/g, ""))} />
        </View>
      </View>
      {r.price ? (
        <View style={[s.note, { backgroundColor: c.line }]}>
          <View style={{ flexDirection: "row", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            <T size={13}>Estimate:</T>
            <Money cents={r.price.lowCents} size={13} />
            <T size={13}>to</T>
            <Money cents={r.price.highCents} size={13} />
            <Pressable onPress={() => set("price")((r.price.suggestedCents / 100).toFixed(2))}>
              <T size={13} color={c.glint} weight="600">
                {"  "}use {(r.price.suggestedCents / 100).toFixed(2)}
              </T>
            </Pressable>
          </View>
          <T size={12} color={c.muted}>{r.price.basis}</T>
        </View>
      ) : (
        <T size={12} color={c.muted}>No price estimate for this item. Set the price yourself.</T>
      )}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <T>Add to my live menu</T>
        <Switch value={f.addToLiveMenu} onValueChange={set("addToLiveMenu")} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <T style={{ flex: 1 }} weight="600">I've checked the details and set this price myself</T>
        <Switch value={confirmed} onValueChange={setConfirmed} />
      </View>
      <ErrorNote error={err} />
      <Btn
        title={priceCents > 0 ? `Publish at $${(priceCents / 100).toFixed(2)}` : "Publish"}
        busy={busy}
        disabled={!confirmed || !f.title || !f.condition || !(priceCents > 0) || !(Number(f.quantity) >= 1)}
        onPress={publish}
      />
      <Btn kind="ghost" title="Discard draft" onPress={() => api(`/seller/scans/${id}`, { method: "DELETE" }).then(() => router.back()).catch(setErr)} />
    </ScrollView>
  );
}
