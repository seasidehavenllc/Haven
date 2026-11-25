import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { api, logout } from "@/lib/api";
import { GoLive } from "@/components/GoLive";
import { useApi, useMe } from "@/lib/hooks";
import { Avatar, Btn, Chip, Empty, ErrorNote, Icon, Loading, Money, Row, T, s, useColors } from "@/components/ui";

const SITE = "https://sales.seasidehavenllc.com";

function BlockedPeople() {
  const c = useColors();
  const { reload } = useMe();
  const [open, setOpen] = useState(false);
  const list = useApi<any[]>(open ? "/me/blocks" : null);
  return (
    <View style={{ borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, overflow: "hidden" }}>
      <Row icon="ban-outline" label={open ? "Hide blocked people" : "Blocked people"} onPress={() => setOpen(!open)} />
      {open && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
          {list.loading ? (
            <Loading />
          ) : !list.data?.length ? (
            <T size={13} color={c.muted}>You haven't blocked anyone.</T>
          ) : (
            list.data.map((b) => (
              <View key={b.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T>@{b.handle}</T>
                <Btn kind="ghost" title="Unblock" onPress={async () => (await api(`/users/${b.handle}/block`, { method: "DELETE" }), await Promise.all([list.reload(), reload()]))} />
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

export default function Account() {
  const { me, ready } = useMe();
  // The app only shows the tabs to signed-in people (app/_layout.tsx).
  if (!ready || !me) return <Loading />;
  return <Profile />;
}

function Profile() {
  const c = useColors();
  const { me } = useMe();
  const orders = useApi<any[]>("/orders");
  const u = me!.user;
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <Pressable
        onPress={() => router.push(`/u/${u.handle}`)}
        accessibilityRole="button"
        accessibilityLabel="Open your profile"
        style={({ pressed }) => [s.card, { borderColor: c.line, backgroundColor: c.card, flexDirection: "row", alignItems: "center", gap: 14, opacity: pressed ? 0.8 : 1 }]}
      >
        <Avatar uri={u.avatarUrl} name={u.displayName} size={60} />
        <View style={{ flex: 1, gap: 2 }}>
          <T size={20} weight="800" lines={1}>{u.displayName}</T>
          <T color={c.muted} lines={1}>@{u.handle}</T>
          {me!.seller && <T size={13} color={c.brandLight} lines={1}>{me!.seller.businessName}{me!.seller.plan ? ` · ${me!.seller.plan.name} plan` : ""}</T>}
        </View>
        <Icon name="chevron-forward" size={20} color={c.muted} />
      </Pressable>
      <Btn title="Edit profile" kind="ghost" icon="create-outline" onPress={() => router.push("/profile/edit")} />

      {me!.canSell && <GoLive compact />}

      <T size={18} weight="700">Orders</T>
      {orders.loading ? <Loading /> : orders.error ? <ErrorNote error={orders.error} /> : !orders.data?.length ? <Empty title="No orders yet">Things you buy show up here with tracking.</Empty> : orders.data.map((o) => (
        <View key={o.id} style={[s.card, { borderColor: c.line, backgroundColor: c.card }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <T weight="600">{o.seller.businessName}</T>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {o.isTest && <Chip label="Test" color={c.warn} />}
              <Chip label={o.status.replace(/_/g, " ").toLowerCase()} color={c.line} text={c.ink} />
            </View>
          </View>
          {o.items.map((i: any) => <T key={i.id} size={13} color={c.muted}>{i.quantity} × {i.titleSnapshot}</T>)}
          {o.shipments?.map((sh: any) => (
            <View key={sh.id} style={{ gap: 2 }}>
              <T size={12} weight="600">{sh.status.replace(/_/g, " ").toLowerCase()}{sh.carrier ? ` · ${sh.carrier}` : ""}{sh.trackingNumber ? ` ${sh.trackingNumber}` : ""}</T>
              {sh.events?.[0] && <T size={12} color={c.muted}>{new Date(sh.events[0].occurredAt).toLocaleDateString()} · {sh.events[0].description ?? sh.events[0].status.toLowerCase()}{sh.events[0].location ? ` · ${sh.events[0].location}` : ""}</T>}
            </View>
          ))}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <T size={12} color={c.muted}>{new Date(o.createdAt).toLocaleDateString()}</T>
            <Money cents={o.totalCents} />
          </View>
        </View>
      ))}

      {u.staffRole && (
        <View style={{ borderRadius: 18, borderWidth: 1, borderColor: c.brand, backgroundColor: c.card, overflow: "hidden" }}>
          <Row icon="shield-half-outline" label={`Admin · ${u.staffRole === "OWNER" ? "Owner" : u.staffRole === "MANAGER" ? "Manager" : "Customer support"}`} onPress={() => router.push("/admin")} />
        </View>
      )}

      <T size={18} weight="700">Settings</T>
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, overflow: "hidden" }}>
        <Row icon="notifications-outline" label="Notifications" onPress={() => router.push("/notifications")} />
        <Divider />
        <Row icon="cart-outline" label="Cart" onPress={() => router.push("/cart")} />
        <Divider />
        <Row icon="shield-checkmark-outline" label="Privacy policy" onPress={() => WebBrowser.openBrowserAsync(`${SITE}/privacy`)} />
        <Divider />
        <Row icon="document-text-outline" label="Terms" onPress={() => WebBrowser.openBrowserAsync(`${SITE}/terms`)} />
      </View>
      <BlockedPeople />
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, overflow: "hidden" }}>
        <Row icon="log-out-outline" label="Log out" onPress={logout} />
        <Divider />
        <Row icon="trash-outline" label="Delete account" tone="danger" onPress={() => router.push("/delete-account")} />
      </View>
    </ScrollView>
  );
}

function Divider() {
  const c = useColors();
  return <View style={{ height: 1, backgroundColor: c.line, marginLeft: 46 }} />;
}
