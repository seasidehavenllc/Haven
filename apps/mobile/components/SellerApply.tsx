import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, Switch, View } from "react-native";
import { ApplicationStatusInfo, InventorySizes, SellerCategories } from "@haven/shared";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Btn, Chip, ErrorNote, Field, Loading, Notice, T, s, useColors } from "@/components/ui";

export type SellStatus = { canSell: boolean; seller: { status: string } | null; application: any | null; payoutsMode: "stripe" | "test" | "off"; terms: { version: string; points: string[] } };

/**
 * The Sell tab for anyone who isn't an approved seller yet: the application, or where it stands.
 * Approval happens in the admin panel; the server blocks selling and going live until then.
 */
export function SellerApply({ onApproved }: { onApproved: () => void }) {
  const st = useApi<SellStatus>("/sellers/application");
  const approved = !!st.data?.canSell;
  useEffect(() => {
    if (approved) onApproved();
  }, [approved]); // eslint-disable-line react-hooks/exhaustive-deps
  if (st.loading && !st.data) return <Loading />;
  if (!st.data) return <View style={s.screen}><ErrorNote error={st.error} /></View>;
  const d = st.data;
  if (d.canSell) return <Loading />;
  if (d.seller) return <Paused status={d.seller.status} />;
  if (d.application?.status === "SUBMITTED") return <InReview app={d.application} onRefresh={st.reload} refreshing={st.loading} />;
  return <Form status={d} onChange={st.reload} />;
}

function Paused({ status }: { status: string }) {
  const c = useColors();
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <T size={24} weight="800">Selling is paused</T>
      <T size={14} color={c.muted}>Your seller account is {status.toLowerCase().replace("_", " ")}. You can still shop. Contact Haven support if you think this is a mistake.</T>
    </ScrollView>
  );
}

function InReview({ app, onRefresh, refreshing }: { app: any; onRefresh: () => void; refreshing: boolean }) {
  const c = useColors();
  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Chip label={ApplicationStatusInfo.SUBMITTED.label} color={c.brand} />
      <T size={24} weight="800">Thanks! {app.businessName} is in review</T>
      <T size={14} color={c.muted}>{ApplicationStatusInfo.SUBMITTED.summary}</T>
      <View style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
        <T weight="700">What happens next</T>
        <T size={13} color={c.muted}>• The Haven team checks your details and what you sell.</T>
        <T size={13} color={c.muted}>• If we need anything, we'll ask here and send you a notification.</T>
        <T size={13} color={c.muted}>• Once you're approved, this tab turns into your seller studio: scan items, build your shop and go live.</T>
      </View>
      <T size={12} color={c.muted}>You can keep shopping in the meantime.</T>
    </ScrollView>
  );
}

/** Birth dates are typed as MM/DD/YYYY and sent as YYYY-MM-DD. */
const toIso = (v: string) => {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
};
const fromIso = (v: string | null) => (v ? `${v.slice(5, 7)}/${v.slice(8, 10)}/${v.slice(0, 4)}` : "");
const maskDate = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join("/");
};
const slugify = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function Form({ status, onChange }: { status: SellStatus; onChange: () => void }) {
  const c = useColors();
  const a = status.application;
  const [f, setF] = useState({
    legalName: a?.legalName ?? "",
    phone: a?.phone ?? "",
    dob: fromIso(a?.dateOfBirth ?? null),
    line1: a?.address?.line1 ?? "",
    line2: a?.address?.line2 ?? "",
    city: a?.address?.city ?? "",
    region: a?.address?.region ?? "",
    postalCode: a?.address?.postalCode ?? "",
    businessType: (a?.businessType ?? "INDIVIDUAL") as "INDIVIDUAL" | "BUSINESS",
    businessName: a?.businessName ?? "",
    storeName: a?.storeName ?? "",
    storeSlug: a?.storeSlug ?? "",
    categories: (a?.categories ?? []) as string[],
    description: a?.description ?? "",
    inventorySize: (a?.inventorySize ?? "") as string,
    experience: a?.experience ?? "",
    links: ((a?.socialLinks ?? []) as string[]).join("\n"),
    photos: (a?.sampleImageUrls ?? []) as string[],
    agree: !!a?.termsAcceptedAt,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const set = (p: Partial<typeof f>) => (setF({ ...f, ...p }), setSaved(false));
  const missing: { key: string; label: string }[] = a?.missing ?? [];

  const body = () => {
    const out: any = { businessType: f.businessType, agreeToTerms: f.agree, categories: f.categories, sampleImageUrls: f.photos };
    for (const k of ["legalName", "phone", "businessName", "storeName", "storeSlug", "description", "experience"] as const) if (f[k].trim()) out[k] = f[k].trim();
    if (f.inventorySize) out.inventorySize = f.inventorySize;
    if (toIso(f.dob)) out.dateOfBirth = toIso(f.dob);
    if (f.line1 && f.city) out.address = { line1: f.line1, line2: f.line2 || null, city: f.city, region: f.region, postalCode: f.postalCode, country: "US" };
    out.socialLinks = f.links.split(/\s+/).map((l) => l.trim()).filter(Boolean).map((l) => (/^https?:\/\//.test(l) ? l : `https://${l}`));
    return out;
  };
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };
  const save = () => api("/sellers/application", { method: "PUT", body: body() });

  async function addPhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setErr({ message: "Photo access is off. Turn it on in Settings." });
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsMultipleSelection: true, selectionLimit: 6 - f.photos.length });
    if (r.canceled) return;
    await run("photos", async () => {
      const urls: string[] = [];
      for (const [i, p] of r.assets.entries()) {
        const fd = new FormData();
        fd.append("file", { uri: p.uri, name: p.fileName ?? `sample-${i}.jpg`, type: p.mimeType ?? "image/jpeg" } as any);
        urls.push((await api<{ url: string }>("/uploads", { form: fd })).url);
      }
      set({ photos: [...f.photos, ...urls].slice(0, 6) });
    });
  }

  const Section = ({ n, title, hint }: { n: number; title: string; hint?: string }) => (
    <View style={{ gap: 2, marginTop: 8 }}>
      <T size={18} weight="800">{n}. {title}</T>
      {hint && <T size={12} color={c.muted}>{hint}</T>}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <T size={24} weight="800">Apply to sell</T>
      <T size={13} color={c.muted}>Anyone can shop. To sell and go live, tell us about you and what you sell. The Haven team reviews every seller, usually within 1 to 2 business days.</T>
      {a?.status === "NEEDS_INFO" && <Notice tone="ai">{ApplicationStatusInfo.NEEDS_INFO.label}: {a.decisionNote}{"\n"}Update your application and send it again.</Notice>}
      {a?.status === "REJECTED" && <Notice>{ApplicationStatusInfo.REJECTED.summary}{a.decisionNote ? ` Reason: ${a.decisionNote}` : ""}{"\n"}You can change it and send it again.</Notice>}

      <Section n={1} title="About you" hint="Only the Haven team sees these." />
      <Field label="Legal name" value={f.legalName} onChangeText={(v) => set({ legalName: v })} textContentType="name" autoComplete="name" />
      <Field label="Phone" value={f.phone} onChangeText={(v) => set({ phone: v })} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" />
      <Field label="Date of birth (18+)" placeholder="MM/DD/YYYY" value={f.dob} onChangeText={(v) => set({ dob: maskDate(v) })} keyboardType="number-pad" />
      <Field label="Street address" value={f.line1} onChangeText={(v) => set({ line1: v })} textContentType="streetAddressLine1" autoComplete="street-address" />
      <Field label="Apt, suite (optional)" value={f.line2} onChangeText={(v) => set({ line2: v })} textContentType="streetAddressLine2" />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 2 }}><Field label="City" value={f.city} onChangeText={(v) => set({ city: v })} textContentType="addressCity" /></View>
        <View style={{ flex: 1 }}><Field label="State" value={f.region} onChangeText={(v) => set({ region: v })} textContentType="addressState" autoCapitalize="characters" /></View>
      </View>
      <Field label="ZIP" value={f.postalCode} onChangeText={(v) => set({ postalCode: v })} keyboardType="number-pad" textContentType="postalCode" />

      <Section n={2} title="Your business" hint="Selling as yourself is fine. Stripe asks for your SSN or EIN during payout setup; Haven never stores it." />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn style={{ flex: 1 }} kind={f.businessType === "INDIVIDUAL" ? "primary" : "ghost"} title="Just me" onPress={() => set({ businessType: "INDIVIDUAL" })} />
        <Btn style={{ flex: 1 }} kind={f.businessType === "BUSINESS" ? "primary" : "ghost"} title="A business" onPress={() => set({ businessType: "BUSINESS" })} />
      </View>
      <Field label={f.businessType === "BUSINESS" ? "Registered business name" : "Name you sell under"} value={f.businessName} onChangeText={(v) => set({ businessName: v, storeName: f.storeName || v, storeSlug: f.storeSlug || slugify(v) })} />
      <Field label="Store name" value={f.storeName} onChangeText={(v) => set({ storeName: v })} />
      <Field label="Store address" value={f.storeSlug} onChangeText={(v) => set({ storeSlug: v.toLowerCase().replace(/[^a-z0-9-]/g, "") })} autoCapitalize="none" autoCorrect={false} />

      <Section n={3} title="What you sell" hint="Pick up to 6." />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {SellerCategories.map((cat) => {
          const on = f.categories.includes(cat);
          return (
            <Pressable key={cat} onPress={() => set({ categories: on ? f.categories.filter((x) => x !== cat) : f.categories.length < 6 ? [...f.categories, cat] : f.categories })} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: on ? c.brand : c.line, backgroundColor: on ? c.brand : "transparent" }}>
              <T size={13} color={on ? "#fff" : c.ink}>{cat}</T>
            </Pressable>
          );
        })}
      </View>
      <Field label="Tell us about your items" value={f.description} onChangeText={(v) => set({ description: v })} multiline placeholder="What you sell, where it comes from, condition, price range." style={{ minHeight: 96, paddingTop: 10 }} />
      <T size={12} weight="600" color={c.muted}>HOW MANY ITEMS DO YOU HAVE TO SELL?</T>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {InventorySizes.map((x) => <Btn key={x} style={{ flex: 1, paddingHorizontal: 4 }} kind={f.inventorySize === x ? "primary" : "ghost"} title={x} onPress={() => set({ inventorySize: x })} />)}
      </View>
      <Field label="Selling experience (optional)" value={f.experience} onChangeText={(v) => set({ experience: v })} placeholder="e.g. 3 years on eBay" />
      <Field label="Social or shop links (optional)" value={f.links} onChangeText={(v) => set({ links: v })} multiline autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="instagram.com/yourshop" style={{ minHeight: 60, paddingTop: 10 }} />
      <T size={12} weight="600" color={c.muted}>PHOTOS OF ITEMS YOU'D SELL (OPTIONAL)</T>
      <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
        {f.photos.map((u) => (
          <Pressable key={u} onLongPress={() => set({ photos: f.photos.filter((x) => x !== u) })}>
            <Image source={{ uri: u }} style={{ width: 72, height: 72, borderRadius: 10 }} />
          </Pressable>
        ))}
        {f.photos.length < 6 && <Btn kind="ghost" icon="images-outline" title={busy === "photos" ? "Uploading…" : "Add"} busy={busy === "photos"} onPress={addPhotos} style={{ height: 72 }} />}
      </ScrollView>

      <Section n={4} title="Payouts" hint="Stripe pays you for each sale. They verify your identity and bank on their own secure form." />
      {status.payoutsMode === "off" ? (
        <T size={13} color={c.muted}>Payouts aren't connected on Haven yet. You can still send your application.</T>
      ) : a?.payoutsDetailsDone ? (
        <Notice tone="ok">Payout details sent to Stripe{a.payoutsEnabled ? " and verified." : ". Stripe is still verifying them."}</Notice>
      ) : (
        <Btn
          kind="ghost"
          icon="card-outline"
          title="Set up payouts with Stripe"
          busy={busy === "payouts"}
          onPress={() =>
            run("payouts", async () => {
              await save();
              const r = await api<any>("/sellers/application/payouts", { method: "POST" });
              if (r.url) await WebBrowser.openBrowserAsync(r.url);
              onChange();
            })
          }
        />
      )}

      <Section n={5} title="Seller terms" />
      <View style={[s.card, { borderColor: c.line, backgroundColor: c.card, gap: 6 }]}>
        {status.terms.points.map((p) => <T key={p} size={13} color={c.muted}>• {p}</T>)}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Switch value={f.agree} onValueChange={(v) => set({ agree: v })} />
        <T size={14} style={{ flex: 1 }} onPress={() => set({ agree: !f.agree })}>I agree to the Haven seller terms</T>
      </View>

      {!!missing.length && (
        <View style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
          <T weight="700">Still to do</T>
          {missing.map((m) => <T key={m.key} size={13} color={c.muted}>• {m.label}</T>)}
        </View>
      )}
      <ErrorNote error={err} />
      <Btn kind="ghost" title={saved ? "Saved" : "Save for later"} busy={busy === "save"} disabled={!!busy} onPress={() => run("save", async () => (await save(), setSaved(true), onChange()))} />
      <Btn
        title={a?.status === "NEEDS_INFO" || a?.status === "REJECTED" ? "Send again" : "Send application"}
        busy={busy === "send"}
        disabled={!!busy}
        onPress={() => run("send", async () => (await save(), await api("/sellers/application/submit", { method: "POST" }), onChange()))}
      />
    </ScrollView>
  );
}
