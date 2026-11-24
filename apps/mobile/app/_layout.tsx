import { registerGlobals } from "@livekit/react-native";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Image, Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useMe } from "@/lib/hooks";
import { usePush } from "@/lib/push";
import { Btn, T, friendlyError, palette, useColors } from "@/components/ui";

// WebRTC for live video (LiveKit) has to be set up before anything joins a room.
if (Platform.OS !== "web") registerGlobals();

// Navigation chrome (tab bar, headers, back buttons) uses Haven's dark palette. Without this the
// default light theme drew dark grey tab labels on the dark tab bar, which made them unreadable.
const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, primary: palette.dark.brand, background: palette.dark.paper, card: palette.dark.card, text: palette.dark.ink, border: palette.dark.line, notification: palette.dark.live },
};

export default function Root() {
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <AuthProvider>
          {Platform.OS !== "web" && <PushBridge />}
          <StatusBar style="light" />
          <AppStack />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Haven is account-based: until someone signs in, the only screen is the login. Once they do, the tabs and
 * every other screen open up, and logging out (or deleting the account) goes back to the login.
 */
function AppStack() {
  const c = useColors();
  const { me, ready } = useMe();
  if (!ready) return <Splash />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: c.paper }, headerTintColor: c.ink, headerTitleStyle: { fontWeight: "700" }, headerShadowVisible: false, contentStyle: { backgroundColor: c.paper }, headerBackTitle: "Back" }}>
      <Stack.Protected guard={!me}>
        <Stack.Screen name="login" options={{ headerShown: false, animation: "fade" }} />
      </Stack.Protected>
      <Stack.Protected guard={!!me}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: "fade" }} />
        <Stack.Screen name="p/[id]" options={{ title: "" }} />
        <Stack.Screen name="live/[id]" options={{ title: "Live", headerShown: false, contentStyle: { backgroundColor: "#000" } }} />
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
        <Stack.Screen name="admin" options={{ title: "Admin" }} />
      </Stack.Protected>
    </Stack>
  );
}

/** Shown while a saved sign-in is checked. If the server can't be reached, says so and offers a retry. */
function Splash() {
  const c = useColors();
  const { offline, reload } = useMe();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper, alignItems: "center", justifyContent: "center", padding: 32, gap: 18 }}>
      <Image source={require("../assets/mark.png")} style={{ width: 72, height: 72 }} accessibilityLabel="Haven" />
      {offline ? (
        <>
          <T color={c.muted} style={{ textAlign: "center" }}>{friendlyError(offline)}</T>
          <Btn title="Try again" onPress={reload} style={{ alignSelf: "stretch" }} />
        </>
      ) : (
        <ActivityIndicator color={c.brand} />
      )}
    </View>
  );
}

function PushBridge() {
  const { me } = useMe();
  usePush(!!me);
  return null;
}
