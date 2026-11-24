import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { api } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { block, choose, report } from "@/lib/safety";
import { Btn, Chip, ErrorNote, Field, Loading, ModeBadge, Money, Notice, T, minPrice, s, stock, useColors } from "@/components/ui";

export default function LiveViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { me, reload: reloadMe } = useMe();
  const { data: st, loading, error, reload, setData } = useApi<any>(`/streams/${id}`);
  const [chat, setChat] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<any>(null);
  const [note, setNote] = useState<string | null>(null);
  const list = useRef<FlatList>(null);

  useEffect(() => {
    if (st?.chat) setChat(st.chat);
  }, [st?.id]);

  useRealtime(`stream:${id}`, {
    "stream:chat": (m: any) => setChat((cur) => (m.hidden ? cur.filter((x) => x.id !== m.id) : [...cur.slice(-199), m])),
    "stream:pinned": (p: any) => setData((d: any) => d && { ...d, pinnedProductId: p.productId }),
    "stream:viewers": (p: any) => setData((d: any) => d && { ...d, viewers: p.count }),
    "stream:status": () => reload(),
    "stream:menu": () => reload(),
    "inventory:changed": (v: any) =>
      setData((d: any) => d && { ...d, products: d.products.map((sp: any) => ({ ...sp, product: { ...sp.product, variants: sp.product.variants.map((x: any) => (x.id === v.id ? { ...x, quantity: v.quantity } : x)) } })) }),
  });

  if (loading) return <Loading />;
  if (error || !st) return <View style={s.screen}><ErrorNote error={error} /></View>;
  const pinned = st.products.find((p: any) => p.productId === st.pinnedProductId)?.product;
  const open = ["LIVE", "PAUSED"].includes(st.status);

  async function add(p: any) {
    setErr(null);
    if (!me) return router.push("/account");
    const v = p.variants.find((x: any) => x.quantity > 0);
    if (!v) return;
    try {
      await api("/cart/items", { body: { variantId: v.id, quantity: 1 } });
      setNote(`${p.title} added. Check out from the cart without leaving the show.`);
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <View style={{ aspectRatio: 16 / 9, backgroundColor: "#111", justifyContent: "center", padding: 16 }}>
        <T color="#fff" size={13} style={{ textAlign: "center", opacity: 0.85 }}>
          {st.status === "SCHEDULED"
            ? `Starts ${st.scheduledFor ? new Date(st.scheduledFor).toLocaleString() : "soon"}`
            : st.status === "ENDED"
              ? "This show has ended"
              : st.video.configured
                ? "Live video needs the native LiveKit player, which ships with the next app build."
                : "Live video isn't connected on this server yet (LiveKit keys needed). Chat, the menu and buying work."}
        </T>
        <View style={{ position: "absolute", top: 10, left: 10, flexDirection: "row", gap: 6 }}>
          {st.status === "LIVE" && <Chip label="LIVE" color={c.live} />}
          <ModeBadge mode={st.mode} />
          <Chip label={`${st.viewers} watching`} color="#0008" />
        </View>
      </View>
      {st.aiDisclosure && <View style={{ backgroundColor: c.ai, padding: 8 }}><T size={12} weight="600" color="#fff">🤖 {st.aiDisclosure}</T></View>}
      <View style={{ padding: 12, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T size={18} weight="700" lines={1} style={{ flex: 1 }}>{st.title}</T>
          {me && me.user.id !== st.seller.userId && (
            <Pressable hitSlop={8} accessibilityLabel="Report this live stream" onPress={() => report("stream", st.id, "this live stream")}>
              <T size={12} color={c.muted}>Report</T>
            </Pressable>
          )}
        </View>
        {pinned && (
          <View style={[s.card, { borderColor: c.brand, backgroundColor: c.card, flexDirection: "row", alignItems: "center", padding: 10 }]}>
            <View style={{ width: 52, height: 52, borderRadius: 10, overflow: "hidden", backgroundColor: c.line }}>{pinned.media[0] && <Image source={{ uri: pinned.media[0].url }} style={{ width: 52, height: 52 }} />}</View>
            <View style={{ flex: 1 }}>
              <T size={14} weight="600" lines={1}>{pinned.title}</T>
              <Money cents={minPrice(pinned)} />
            </View>
            <Btn title={stock(pinned) === 0 ? "Sold out" : stock(pinned) <= 3 ? `Buy · ${stock(pinned)} left` : "Buy"} disabled={stock(pinned) === 0} onPress={() => add(pinned)} />
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {st.products.map(({ product: p }: any) => (
            <Pressable key={p.id} onPress={() => add(p)} style={{ width: 92, opacity: stock(p) === 0 ? 0.5 : 1 }}>
              <View style={{ width: 92, height: 92, borderRadius: 12, overflow: "hidden", backgroundColor: c.line, borderWidth: p.id === st.pinnedProductId ? 2 : 0, borderColor: c.brand }}>{p.media[0] && <Image source={{ uri: p.media[0].url }} style={{ width: 92, height: 92 }} />}</View>
              <T size={11} lines={1}>{p.title}</T>
              <T size={12} weight="700">{stock(p) === 0 ? "Sold out" : `+ ${(minPrice(p)! / 100).toFixed(2)}`}</T>
            </Pressable>
          ))}
        </ScrollView>
        {note && <Notice tone="ok">{note}</Notice>}
        <ErrorNote error={err} />
      </View>
      <FlatList
        ref={list}
        style={{ flex: 1, borderTopWidth: 1, borderColor: c.line }}
        contentContainerStyle={{ padding: 12, gap: 6 }}
        data={chat.filter((m) => !m.userId || !me?.blockedUserIds?.includes(m.userId))}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<T size={13} color={c.muted}>No messages yet.</T>}
        renderItem={({ item: m }) => (
          <Pressable
            style={m.isAi ? { backgroundColor: c.ai + "18", borderRadius: 10, padding: 6 } : undefined}
            delayLongPress={350}
            accessibilityHint={me && m.userId && m.userId !== me.user.id ? "Long press to report or block" : undefined}
            onLongPress={async () => {
              if (!me || !m.userId || m.userId === me.user.id || !m.user?.handle) return;
              const i = await choose(`Message from @${m.user.handle}`, ["Report message", `Block @${m.user.handle}`], 1);
              if (i === 0) await report("chat", m.id, "this message");
              if (i === 1 && (await block(m.user.handle))) await reloadMe();
            }}
          >
            <T size={14}>
              <T size={14} weight="700" color={m.isAi ? c.ai : c.ink}>{m.isAi ? "AI assistant" : m.user?.displayName ?? "viewer"} </T>
              {m.body}
            </T>
          </Pressable>
        )}
      />
      <View style={{ flexDirection: "row", gap: 8, padding: 10, borderTopWidth: 1, borderColor: c.line, backgroundColor: c.card }}>
        <View style={{ flex: 1 }}>
          <Field editable={open} placeholder={open ? "Say something" : "Chat opens when the show starts"} value={text} onChangeText={setText} maxLength={500} />
        </View>
        <Btn
          title="Send"
          disabled={!open || !text.trim()}
          onPress={async () => {
            if (!me) return router.push("/account");
            try {
              await api(`/streams/${id}/chat`, { body: { body: text } });
              setText("");
            } catch (e) {
              setErr(e);
            }
          }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
