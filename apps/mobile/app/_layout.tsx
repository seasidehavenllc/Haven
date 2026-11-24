import { DarkTheme, Stack, ThemeProvider, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useMe } from "@/lib/hooks";
import { usePush } from "@/lib/push";
import { palette, useColors } from "@/components/ui";

// Navigation chrome (tab bar, headers, back buttons) uses Haven's dark palette. Without this the
// default light theme drew dark grey tab labels on the dark tab bar, which made them unreadable.
const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, primary: palette.dark.brand, background: palette.dark.paper, card: palette.dark.card, text: palette.dark.ink, border: palette.dark.line, notification: palette.dark.live },
};

export default function Root() {
  const c = useColors();
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <AuthProvider>
          {Platform.OS !== "web" && <PushBridge />}
          <LoginGate />
          <StatusBar style="light" />
          <Stack screenOptions={{ headerStyle: { backgroundColor: c.paper }, headerTintColor: c.ink, headerTitleStyle: { fontWeight: "700" }, headerShadowVisible: false, contentStyle: { backgroundColor: c.paper }, headerBackTitle: "Back" }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen name="p/[id]" options={{ title: "" }} />
            <Stack.Screen name="live/[id]" options={{ title: "Live" }} />
            <Stack.Screen name="cart" options={{ title: "Cart" }} />
            <Stack.Screen name="scan/[id]" options={{ title: "Review listing" }} />
            <Stack.Screen name="studio/[id]" options={{ title: "Studio" }} />
            <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
            <Stack.Screen name="auctions/index" options={{ title: "Auctions" }} />
            <Stack.Screen name="auctions/[id]" options={{ title: "Auction" }} />
            <Stack.Screen name="u/[handle]" options={{ title: "" }} />
            <Stack.Screen name="video/[id]" options={{ title: "", headerTransparent: true }} />
            <Stack.Screen name="video/new" options={{ title: "Post a video" }} />
            <Stack.Screen name="delete-account" options={{ title: "Delete account" }} />
          </Stack>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Signed-out people land on the full-screen login first. "Browse without an account" lets them in as a
 * guest for this session (Apple asks that shopping apps can be browsed without an account). Signing in
 * from the login screen goes straight to the tabs.
 */
function LoginGate() {
  const { me, ready, guest } = useMe();
  const segments = useSegments();
  const onLogin = segments[0] === "login";
  useEffect(() => {
    if (!ready) return;
    if (!me && !guest && !onLogin) router.replace("/login");
    else if (me && onLogin) router.replace("/");
  }, [me, ready, guest, onLogin]);
  return null;
}

function PushBridge() {
  const { me } = useMe();
  usePush(!!me);
  return null;
}
