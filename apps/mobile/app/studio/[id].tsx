import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, Switch, View } from "react-native";
import { api } from "@/lib/api";
import { useApi, useRealtime } from "@/lib/hooks";
import { Btn, Chip, ErrorNote, Field, Loading, ModeBadge, Money, Notice, T, minPrice, s, stock, useColors } from "@/components/ui";

const PRESETS = ["What's pinned and how many are left?", "Summarize the chat questions", "What should I show next?"];

/** Seller's control room: show status, pin and hide menu items, moderate chat, ask the private AI co-host. */
export default function Studio() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { data: st, loading, error, reload, setData } = useApi<any>(`/streams/${id}`);
  const [chat, setChat] = useState<any[]>([]);
  const [err, setErr] = useState<any>(null);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);

  useEffect(() => {
    if (st?.chat) setChat(st.chat);
  }, [st?.id]);
  useRealtime(
    `stream:${id}`,
    {
      "stream:chat": (m: any) => setChat((cur) => (m.hidden ? cur.filter((x) => x.id !== m.id) : [...cur.slice(-199), m])),
      "stream:viewers": (p: any) => setData((d: any) => d && { ...d, viewers: p.count }),
      "inventory:changed": () => reload(),
      "stream:menu": () => reload(),
      "order:created": () => reload(),
    },
    { host: true },
  );

  if (loading) return <Loading />;
  if (error || !st) return <View style={s.screen}><ErrorNote error={error} /></View>;
  const act = (path: string, body: unknown = {}, method = "POST") =>
    api(`/seller/streams/${id}${path}`, { method, body })
      .then(() => reload())
      .catch(setErr);

  async function ask(question: string) {
    setAsking(true);
    setErr(null);
    try {
      const r = await api(`/seller/streams/${id}/cohost/ask`, { body: { question } });
      setAnswers((a) => [{ q: question, a: r.answer }, ...a]);
      setQ("");
    } catch (e) {
      setErr(e);
    } finally {
      setAsking(false);
    }
  }

  const ai = st.mode !== "HUMAN";
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        {st.status === "LIVE" ? <Chip label="LIVE" color={c.live} /> : <Chip label={st.status.toLowerCase()} color={c.line} text={c.ink} />}
        <ModeBadge mode={st.mode} />
        <T size={13} color={c.muted}>{st.viewers} watching</T>
      </View>
      <T size={20} weight="700">{st.title}</T>
      {st.video && !st.video.configured && <Notice>Video isn't connected on this server (LiveKit keys needed). Viewers can still chat and buy from your menu.</Notice>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {st.status === "SCHEDULED" && <Btn style={{ flex: 1 }} title="Go live" onPress={() => act("/start")} />}
        {st.status === "LIVE" && <Btn style={{ flex: 1 }} kind="ghost" title="Pause" onPress={() => act("/pause")} />}
        {st.status === "PAUSED" && <Btn style={{ flex: 1 }} title="Resume" onPress={() => act("/resume")} />}
        {st.status !== "ENDED" && <Btn style={{ flex: 1 }} kind="danger" title="End show" onPress={() => act("/end")} />}
      </View>
      <ErrorNote error={err} />

      {ai && (
        <View style={[s.card, { borderColor: c.ai, backgroundColor: c.ai + "10" }]}>
          <T weight="700" color={c.ai}>AI co-host (only you see this)</T>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <T size={13} style={{ flex: 1 }}>Let AI answer viewers in chat (labeled as AI)</T>
            <Switch value={st.aiPublicSpeech} onValueChange={(v) => act("/ai", { aiPublicSpeech: v }, "PATCH")} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <T size={13}>Pause AI</T>
            <Switch value={st.aiPaused} onValueChange={(v) => act("/ai", { aiPaused: v }, "PATCH")} />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {PRESETS.map((p) => (
              <Btn key={p} kind="ghost" title={p} onPress={() => ask(p)} style={{ minHeight: 34, paddingHorizontal: 10 }} />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field placeholder="Ask the co-host privately" value={q} onChangeText={setQ} />
            </View>
            <Btn kind="ai" title="Ask" busy={asking} disabled={!q.trim()} onPress={() => ask(q)} />
          </View>
          {answers.map((x, i) => (
            <View key={i} style={{ gap: 2 }}>
              <T size={12} color={c.muted}>{x.q}</T>
              <T size={14}>{x.a}</T>
            </View>
          ))}
        </View>
      )}

      <T size={18} weight="700">Menu</T>
      {st.products.map(({ product: p, hidden }: any) => {
        const pinned = st.pinnedProductId === p.id;
        return (
          <View key={p.id} style={[s.card, { borderColor: pinned ? c.glint : c.line, backgroundColor: c.card, flexDirection: "row", alignItems: "center", opacity: hidden ? 0.55 : 1 }]}>
            <View style={{ width: 48, height: 48, borderRadius: 10, overflow: "hidden", backgroundColor: c.line }}>{p.media[0] && <Image source={{ uri: p.media[0].url }} style={{ width: 48, height: 48 }} />}</View>
            <View style={{ flex: 1 }}>
              <T size={14} weight="600" lines={1}>{p.title}</T>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Money cents={minPrice(p)} size={13} />
                <T size={12} color={stock(p) === 0 ? c.live : c.muted}>{stock(p) === 0 ? "sold out" : `${stock(p)} in stock`}</T>
              </View>
            </View>
            <Btn kind={pinned ? "primary" : "ghost"} title={pinned ? "Pinned" : "Pin"} disabled={hidden} onPress={() => act("/pin", { productId: pinned ? null : p.id })} style={{ minHeight: 34, paddingHorizontal: 10 }} />
            <Btn kind="ghost" title={hidden ? "Show" : "Hide"} onPress={() => act(`/products/${p.id}`, { hidden: !hidden }, "PATCH")} style={{ minHeight: 34, paddingHorizontal: 10 }} />
          </View>
        );
      })}

      <T size={18} weight="700">Chat</T>
      {!chat.length && <T size={13} color={c.muted}>No messages yet.</T>}
      {chat.slice(-40).map((m) => (
        <View key={m.id} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
          <T size={14} style={{ flex: 1 }}>
            <T size={14} weight="700" color={m.isAi ? c.ai : c.ink}>{m.isAi ? "AI assistant" : m.user?.displayName ?? "viewer"} </T>
            {m.body}
          </T>
          {!m.isAi && ai && st.aiPublicSpeech && (
            <Pressable onPress={() => act("/ai/respond", { messageId: m.id })}>
              <T size={12} color={c.ai}>AI reply</T>
            </Pressable>
          )}
          <Pressable onPress={() => act(`/chat/${m.id}/hide`)}>
            <T size={12} color={c.muted}>Hide</T>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
