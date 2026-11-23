import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Image, ScrollView, useWindowDimensions, View } from "react-native";
import { api, newKey } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { Countdown } from "@/components/Countdown";
import { Btn, ErrorNote, Field, Loading, Money, Notice, T, s, useColors } from "@/components/ui";

const blank = { name: "", line1: "", line2: "", city: "", region: "", postalCode: "", country: "US" };

export default function AuctionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { width } = useWindowDimensions();
  const { me } = useMe();
  const { data: a, loading, error, reload, setData } = useApi<any>(`/auctions/${id}`);
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [addr, setAddr] = useState(blank);
  const [paid, setPaid] = useState<any>(null);

  useRealtime(`auction:${id}`, {
    "auction:bid": (b: any) => {
      setData((d: any) => d && { ...d, currentPriceCents: b.amountCents, endsAt: b.endsAt });
      reload();
    },
    "auction:closed": () => reload(),
  });

  if (loading) return <Loading />;
  if (error || !a) return <View style={s.screen}><ErrorNote error={error} /></View>;
  const skew = new Date(a.serverTime).getTime() - Date.now();
  const min = a.currentPriceCents == null ? a.startingPriceCents : a.currentPriceCents + a.minIncrementCents;
  const leading = a.bids[0];
  const ended = a.status === "ENDED";
  const scheduled = a.status === "SCHEDULED";
  const iLead = !!me && leading?.bidderId === me.user.id;
  const won = ended && !!me && a.winnerId === me.user.id;

  async function bid() {
    setErr(null);
    if (!me) return router.push("/account");
    const cents = Math.round(Number(amount || min / 100) * 100);
    if (!(cents >= min)) return setErr({ message: `Bid at least $${(min / 100).toFixed(2)}` });
    setBusy(true);
    try {
      await api(`/auctions/${id}/bids`, { body: { amountCents: cents, idempotencyKey: newKey() } });
      setAmount("");
      reload();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    setErr(null);
    setBusy(true);
    try {
      setPaid(await api(`/auctions/${id}/checkout`, { body: { address: { ...addr, line2: addr.line2 || undefined } } }));
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  const f = (k: keyof typeof blank, label: string) => <Field label={label} value={addr[k]} onChangeText={(v) => setAddr({ ...addr, [k]: v })} />;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ width, height: width, backgroundColor: c.line }}>{a.product.media[0] && <Image source={{ uri: a.product.media[0].url }} style={{ width, height: width }} />}</View>
      <View style={s.screen}>
        <T size={22} weight="700">{a.product.title}</T>
        <View style={[s.card, { borderColor: c.line, backgroundColor: c.card, flexDirection: "row" }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={12} color={c.muted}>{a.currentPriceCents == null ? "STARTING BID" : "HIGH BID"}</T>
            <Money cents={a.currentPriceCents ?? a.startingPriceCents} size={26} />
            {leading && <T size={12} color={iLead ? c.ok : c.muted}>{iLead ? "You're winning" : `by @${leading.bidder.handle}`}</T>}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T size={12} color={c.muted}>{ended ? "STATUS" : scheduled ? "STARTS IN" : "TIME LEFT"}</T>
            {ended ? <T size={26} weight="700">Ended</T> : <Countdown to={scheduled ? a.startsAt : a.endsAt} skewMs={skew} size={26} />}
            {a.hasReserve && <T size={12} color={c.muted}>{a.reserveMet ? "Reserve met" : "Reserve not met"}</T>}
          </View>
        </View>

        <ErrorNote error={err} />
        {!ended && !scheduled && (
          <View style={{ gap: 8 }}>
            <Field label="Your bid (USD)" keyboardType="decimal-pad" placeholder={`$${(min / 100).toFixed(2)} or more`} value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))} />
            <Btn title={me ? `Bid $${(Number(amount) || min / 100).toFixed(2)}` : "Sign in to bid"} busy={busy} onPress={bid} />
            <T size={12} color={c.muted}>Bids are binding. A bid in the last moments extends the clock, so everyone gets a fair chance.</T>
          </View>
        )}
        {scheduled && <Notice tone="ai">Bidding opens when the auction starts.</Notice>}
        {won &&
          (paid ? (
            <View style={{ gap: 8 }}>
              <Notice tone="ok">Order placed{paid.orders?.[0]?.isTest ? " (test payment, no real money moved)" : ""}.</Notice>
              <Btn kind="ghost" title="View orders" onPress={() => router.replace("/account")} />
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <T size={18} weight="700">You won! Where should it ship?</T>
              {f("name", "Full name")}
              {f("line1", "Address")}
              {f("line2", "Apt, suite (optional)")}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>{f("city", "City")}</View>
                <View style={{ width: 90 }}>{f("region", "State")}</View>
              </View>
              {f("postalCode", "ZIP")}
              <Btn title={`Pay $${(a.currentPriceCents / 100).toFixed(2)}`} busy={busy} onPress={checkout} />
            </View>
          ))}
        {ended && !won && <T color={c.muted}>{a.winnerId ? "This auction has a winner." : "Ended without a winning bid."}</T>}

        <T size={16} weight="700">Bid history</T>
        {a.bids.map((b: any) => (
          <View key={b.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.line }}>
            <T>@{b.bidder.handle}</T>
            <Money cents={b.amountCents} />
          </View>
        ))}
        {!a.bids.length && <T color={c.muted}>No bids yet. Be the first.</T>}
        <Btn kind="ghost" title="See the item" onPress={() => router.push(`/p/${a.productId}`)} />
      </View>
    </ScrollView>
  );
}
