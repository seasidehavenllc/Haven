import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { api, logout, saveTokens } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { SocialSignIn } from "@/components/SocialSignIn";
import { Btn, Chip, Empty, ErrorNote, Field, Loading, Money, T, s, useColors } from "@/components/ui";

const SITE = "https://sales.seasidehavenllc.com";

function BlockedPeople() {
  const c = useColors();
  const { reload } = useMe();
  const [open, setOpen] = useState(false);
  const list = useApi<any[]>(open ? "/me/blocks" : null);
  return (
    <View style={{ gap: 6 }}>
      <Btn kind="ghost" title={open ? "Hide blocked people" : "Blocked people"} onPress={() => setOpen(!open)} />
      {open &&
        (list.loading ? (
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
        ))}
    </View>
  );
}

export default function Account() {
  const { me, ready } = useMe();
  if (!ready) return <Loading />;
  return me ? <Profile /> : <AuthForm />;
}

function AuthForm() {
  const c = useColors();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ email: "", password: "", displayName: "", handle: "" });
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: k === "handle" ? v.toLowerCase().replace(/[^a-z0-9_]/g, "") : v });
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <T size={26} weight="800">{mode === "login" ? "Welcome back" : "Create your account"}</T>
      <SocialSignIn />
      {mode === "register" && (
        <>
          <Field label="Name" value={f.displayName} onChangeText={set("displayName")} />
          <Field label="Handle" value={f.handle} onChangeText={set("handle")} autoCapitalize="none" />
        </>
      )}
      <Field label="Email" value={f.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Password" value={f.password} onChangeText={set("password")} secureTextEntry autoComplete={mode === "login" ? "current-password" : "new-password"} />
      {mode === "register" && <T size={12} color={c.muted}>At least 10 characters.</T>}
      {mode === "register" && (
        <Pressable onPress={() => WebBrowser.openBrowserAsync(`${SITE}/terms`)}>
          <T size={12} color={c.muted}>
            By signing up you agree to Haven's <T size={12} color={c.brand}>Terms</T>. Haven has zero tolerance for objectionable content or abusive people.
          </T>
        </Pressable>
      )}
      <ErrorNote error={err} />
      <Btn
        title={mode === "login" ? "Log in" : "Sign up"}
        busy={busy}
        onPress={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await api(`/auth/${mode}`, { body: mode === "login" ? { email: f.email, password: f.password } : f });
            await saveTokens(r);
          } catch (e) {
            setErr(e);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Btn kind="ghost" title={mode === "login" ? "New here? Create an account" : "Have an account? Log in"} onPress={() => setMode(mode === "login" ? "register" : "login")} />
    </ScrollView>
  );
}

function Profile() {
  const c = useColors();
  const { me } = useMe();
  const orders = useApi<any[]>("/orders");
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <T size={24} weight="800">{me!.user.displayName}</T>
      <T color={c.muted}>@{me!.user.handle}{me!.seller ? ` · ${me!.seller.businessName} (${me!.seller.plan?.name ?? "no"} plan)` : ""}</T>
      <T size={18} weight="700">Orders</T>
      {orders.loading ? <Loading /> : orders.error ? <ErrorNote error={orders.error} /> : !orders.data?.length ? <Empty title="No orders yet" /> : orders.data.map((o) => (
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
      <Btn kind="ghost" title="Log out" onPress={logout} />
      <BlockedPeople />
      <View style={{ flexDirection: "row", gap: 16, justifyContent: "center" }}>
        <Pressable onPress={() => WebBrowser.openBrowserAsync(`${SITE}/privacy`)} hitSlop={8}>
          <T size={13} color={c.muted}>Privacy policy</T>
        </Pressable>
        <Pressable onPress={() => WebBrowser.openBrowserAsync(`${SITE}/terms`)} hitSlop={8}>
          <T size={13} color={c.muted}>Terms</T>
        </Pressable>
      </View>
      <Btn kind="ghost" title="Delete account" onPress={() => router.push("/delete-account")} />
    </ScrollView>
  );
}
