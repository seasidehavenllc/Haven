import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, saveTokens } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { SocialSignIn } from "@/components/SocialSignIn";
import { Btn, ErrorNote, Field, Icon, T, useColors } from "@/components/ui";

const SITE = "https://sales.seasidehavenllc.com";

/** Full-screen sign in / sign up. Shown before the tabs when nobody is signed in. */
export default function Login() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { setGuest } = useMe();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState({ email: "", password: "", displayName: "", handle: "" });
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: k === "handle" ? v.toLowerCase().replace(/[^a-z0-9_]/g, "") : v });

  const browse = () => {
    setGuest(true);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api(`/auth/${mode}`, { body: mode === "login" ? { email: f.email.trim(), password: f.password } : { ...f, email: f.email.trim() } });
      await saveTokens(r);
      // The login gate sends a signed-in person on to the tabs.
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.paper }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Pressable onPress={browse} hitSlop={12} accessibilityRole="button">
            <T size={15} weight="600" color={c.muted}>Not now</T>
          </Pressable>
        </View>

        <View style={{ alignItems: "center", gap: 10, marginTop: 24, marginBottom: 12 }}>
          <Image source={require("../assets/mark.png")} style={{ width: 72, height: 72 }} accessibilityLabel="Haven" />
          <T size={30} weight="800">{mode === "login" ? "Welcome back" : "Join Haven"}</T>
          <T size={15} color={c.muted} style={{ textAlign: "center" }}>
            {mode === "login" ? "Sign in to shop live drops, follow sellers and track your orders." : "Shop live drops from real sellers, or start selling yourself."}
          </T>
        </View>

        <SocialSignIn />

        {mode === "register" && (
          <>
            <Field label="Name" value={f.displayName} onChangeText={set("displayName")} textContentType="name" autoComplete="name" />
            <Field label="Handle" value={f.handle} onChangeText={set("handle")} autoCapitalize="none" autoCorrect={false} placeholder="yourname" />
          </>
        )}
        <Field label="Email" value={f.email} onChangeText={set("email")} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" />
        <Field
          label="Password"
          value={f.password}
          onChangeText={set("password")}
          secureTextEntry
          textContentType={mode === "login" ? "password" : "newPassword"}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {mode === "register" && <T size={12} color={c.muted}>At least 10 characters.</T>}
        <ErrorNote error={err} />
        <Btn title={mode === "login" ? "Log in" : "Create account"} busy={busy} onPress={submit} />

        <Pressable onPress={() => (setErr(null), setMode(mode === "login" ? "register" : "login"))} style={{ alignItems: "center", paddingVertical: 6 }} accessibilityRole="button">
          <T size={15} color={c.muted}>
            {mode === "login" ? "New to Haven? " : "Already have an account? "}
            <T size={15} weight="700" color={c.brandLight}>{mode === "login" ? "Create an account" : "Log in"}</T>
          </T>
        </Pressable>

        <View style={{ flex: 1 }} />
        <Pressable onPress={browse} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8 }} accessibilityRole="button">
          <T size={14} weight="600" color={c.ink}>Browse without an account</T>
          <Icon name="arrow-forward" size={16} color={c.ink} />
        </Pressable>
        <T size={12} color={c.muted} style={{ textAlign: "center" }}>
          By continuing you agree to Haven's{" "}
          <T size={12} color={c.brandLight} onPress={() => WebBrowser.openBrowserAsync(`${SITE}/terms`)}>Terms</T> and{" "}
          <T size={12} color={c.brandLight} onPress={() => WebBrowser.openBrowserAsync(`${SITE}/privacy`)}>Privacy policy</T>. Haven has zero tolerance for objectionable content or abusive people.
        </T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
