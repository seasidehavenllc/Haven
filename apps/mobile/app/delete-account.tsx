import { router } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { api, clearTokens } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { Btn, ErrorNote, Field, Notice, T, s, useColors } from "@/components/ui";

export default function DeleteAccount() {
  const c = useColors();
  const { me, reload } = useMe();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  if (!me) return null;
  const needsPassword = me.user.hasPassword !== false;
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <T size={22} weight="800">Delete your account</T>
      <T color={c.muted}>This can't be undone. Deleting your account:</T>
      <T>• Erases your name, email, handle, photo, bio, saved addresses and sign-in methods</T>
      <T>• Removes your videos and hides your comments and chat messages</T>
      <T>• Ends your follows, blocks, notifications, cart and wishlist</T>
      {me.seller && <T>• Closes your shop: listings are archived, upcoming shows are ended, and your AI plan is cancelled</T>}
      <Notice>Orders and payments are kept without your personal details, because the law requires sales records. Orders still on their way must be delivered before you can delete your account.</Notice>
      {needsPassword && <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />}
      <Field label='Type DELETE to confirm' value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} />
      <ErrorNote error={err} />
      <Btn
        kind="danger"
        title="Delete my account"
        busy={busy}
        disabled={confirm.trim() !== "DELETE" || (needsPassword && !password)}
        onPress={async () => {
          setBusy(true);
          setErr(null);
          try {
            await api("/me", { method: "DELETE", body: { confirm: "DELETE", ...(needsPassword ? { password } : {}) } });
            await clearTokens();
            await reload();
            router.replace("/");
          } catch (e) {
            setErr(e);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Btn kind="ghost" title="Keep my account" onPress={() => router.back()} />
    </ScrollView>
  );
}
