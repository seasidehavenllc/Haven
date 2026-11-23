import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, Switch, View } from "react-native";
import { api } from "@/lib/api";
import { useApi, useMe, useRealtime } from "@/lib/hooks";
import { mobileRoute, pushAvailable, registerForPush } from "@/lib/push";
import { Btn, Empty, ErrorNote, Loading, Notice, T, s, useColors } from "@/components/ui";

type N = { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };
type Prefs = { push: boolean; email: boolean; mutedTypes: string[]; mutableTypes: string[]; channels: { push: boolean; email: boolean } };

const LABELS: Record<string, string> = {
  "stream.live": "A seller I follow goes live",
  "auction.outbid": "I've been outbid",
  "social.follow": "Someone follows me",
  "video.like": "Likes on my videos",
  "video.comment": "Comments on my videos",
  marketing: "Deals and announcements",
};

function ago(d: string) {
  const sec = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return new Date(d).toLocaleDateString();
}

export default function NotificationsScreen() {
  const c = useColors();
  const { me } = useMe();
  const list = useApi<N[]>(me ? "/notifications" : null, [me?.user.id]);
  const [settings, setSettings] = useState(false);
  useRealtime(null, { "notification:new": (n: N) => list.setData((cur) => [n, ...(cur ?? []).filter((x) => x.id !== n.id)]) });
  useEffect(() => {
    const unread = list.data?.filter((n) => !n.readAt).map((n) => n.id);
    if (unread?.length) api("/notifications/read", { body: { ids: unread } }).catch(() => {});
  }, [list.data]);

  if (!me) return <View style={s.screen}><Empty title="Sign in to see notifications" /></View>;
  if (settings) return <Settings onDone={() => setSettings(false)} />;
  if (list.loading && !list.data) return <Loading />;
  return (
    <FlatList
      data={list.data ?? []}
      keyExtractor={(n) => n.id}
      contentContainerStyle={[s.screen, { gap: 0 }]}
      refreshControl={<RefreshControl refreshing={list.loading} onRefresh={list.reload} tintColor={c.brand} />}
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: 8 }}>
          <ErrorNote error={list.error} />
          <Btn kind="ghost" title="Notification settings" onPress={() => setSettings(true)} />
        </View>
      }
      ListEmptyComponent={<Empty title="Nothing yet">Orders, shipping updates, outbids and shows from sellers you follow show up here.</Empty>}
      renderItem={({ item: n }) => (
        <Pressable onPress={() => n.link && router.push(mobileRoute(n.link) as any)} style={{ flexDirection: "row", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.line }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: n.readAt ? "transparent" : c.brand }} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <T weight="600" style={{ flex: 1 }}>{n.title}</T>
              <T size={12} color={c.muted}>{ago(n.createdAt)}</T>
            </View>
            {!!n.body && <T size={13} color={c.muted}>{n.body}</T>}
          </View>
        </Pressable>
      )}
    />
  );
}

function Settings({ onDone }: { onDone: () => void }) {
  const c = useColors();
  const { data, error, setData } = useApi<Prefs>("/me/notification-preferences");
  const [err, setErr] = useState<any>(null);
  const [pushNote, setPushNote] = useState<string | null>(null);
  if (error) return <View style={s.screen}><ErrorNote error={error} /></View>;
  if (!data) return <Loading />;
  const save = (next: Prefs) => {
    setData(next);
    api("/me/notification-preferences", { method: "PUT", body: { push: next.push, email: next.email, mutedTypes: next.mutedTypes } }).catch(setErr);
  };
  const Row = ({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 }}>
      <T style={{ flex: 1 }}>{label}</T>
      <Switch value={on} onValueChange={onChange} />
    </View>
  );
  return (
    <FlatList
      data={data.mutableTypes}
      keyExtractor={(t) => t}
      contentContainerStyle={s.screen}
      ListHeaderComponent={
        <View style={{ gap: 6 }}>
          <T size={13} color={c.muted}>Order, payment and moderation notices always reach your inbox.</T>
          <Row
            label="Push notifications"
            on={data.push}
            onChange={async (v) => {
              save({ ...data, push: v });
              if (v) {
                const r = await registerForPush().catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));
                setPushNote(r.ok ? null : r.reason ?? null);
              }
            }}
          />
          {!pushAvailable() && <Notice>Push isn't available in this build yet. You'll still see everything here.</Notice>}
          {pushNote && <Notice>{pushNote}</Notice>}
          <Row label={data.channels.email ? "Email (orders, shipping, wins)" : "Email (not set up on the server yet)"} on={data.email} onChange={(v) => save({ ...data, email: v })} />
          <T size={12} weight="600" color={c.muted} style={{ marginTop: 10 }}>TELL ME WHEN</T>
        </View>
      }
      renderItem={({ item: t }) => <Row label={LABELS[t] ?? t} on={!data.mutedTypes.includes(t)} onChange={(v) => save({ ...data, mutedTypes: v ? data.mutedTypes.filter((x) => x !== t) : [...data.mutedTypes, t] })} />}
      ListFooterComponent={
        <View style={{ gap: 8, marginTop: 12 }}>
          <ErrorNote error={err} />
          <Btn kind="ghost" title="Done" onPress={onDone} />
        </View>
      }
    />
  );
}
