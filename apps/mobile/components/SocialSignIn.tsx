import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { api, saveTokens } from "@/lib/api";
import { Btn, ErrorNote, T, useColors } from "./ui";

WebBrowser.maybeCompleteAuthSession();

/**
 * Sign in with Apple (iOS) and Google. The app gets an ID token from the provider and the API verifies
 * it. Each button only appears when the server has that provider configured and this build has the
 * client ids it needs (EXPO_PUBLIC_GOOGLE_*_CLIENT_ID).
 */
const googleIds = {
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
};
const googleReady = Platform.OS === "ios" ? !!googleIds.iosClientId : Platform.OS === "android" ? !!googleIds.androidClientId : !!googleIds.webClientId;

export function SocialSignIn() {
  const c = useColors();
  const [server, setServer] = useState<{ apple: boolean; google: boolean } | null>(null);
  const [appleOk, setAppleOk] = useState(false);
  const [err, setErr] = useState<any>(null);
  useEffect(() => {
    api("/auth/providers").then(setServer).catch(() => setServer({ apple: false, google: false }));
    if (Platform.OS === "ios") AppleAuthentication.isAvailableAsync().then(setAppleOk).catch(() => {});
  }, []);

  const finish = async (provider: "apple" | "google", body: Record<string, unknown>) => {
    setErr(null);
    try {
      await saveTokens(await api(`/auth/${provider}`, { body }));
    } catch (e) {
      setErr(e);
    }
  };

  async function apple() {
    try {
      const nonce = Crypto.randomUUID();
      const cred = await AppleAuthentication.signInAsync({ requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL], nonce });
      if (!cred.identityToken) throw new Error("Apple didn't return a sign-in token");
      const name = cred.fullName ? AppleAuthentication.formatFullName(cred.fullName) : "";
      await finish("apple", { idToken: cred.identityToken, nonce, name: name || undefined });
    } catch (e: any) {
      if (e?.code !== "ERR_REQUEST_CANCELED") setErr(e);
    }
  }

  const showApple = !!server?.apple && appleOk;
  const showGoogle = !!server?.google && googleReady;
  if (!showApple && !showGoogle) return null;
  return (
    <View style={{ gap: 10 }}>
      {showApple && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={999}
          style={{ height: 48 }}
          onPress={apple}
        />
      )}
      {showGoogle && <GoogleButton onToken={(idToken, nonce) => finish("google", { idToken, nonce })} onError={setErr} />}
      <ErrorNote error={err} />
      <T size={12} color={c.muted} style={{ textAlign: "center" }}>or with email</T>
    </View>
  );
}

/** Separate component so the Google hook only runs when Google is configured. */
function GoogleButton({ onToken, onError }: { onToken: (idToken: string, nonce?: string) => void; onError: (e: any) => void }) {
  const [nonce] = useState(() => Crypto.randomUUID());
  const [request, response, prompt] = Google.useIdTokenAuthRequest({ ...googleIds, extraParams: { nonce } });
  useEffect(() => {
    if (response?.type === "success" && response.params.id_token) onToken(response.params.id_token, nonce);
    else if (response?.type === "error") onError(response.error ?? new Error("Google sign-in didn't finish"));
  }, [response]);
  return <Btn kind="ghost" title="Continue with Google" disabled={!request} onPress={() => prompt()} />;
}
