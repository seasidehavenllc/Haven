import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useMe } from "@/lib/hooks";
import { usePush } from "@/lib/push";
import { useColors } from "@/components/ui";

export default function Root() {
  const c = useColors();
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PushBridge />
        <StatusBar style="light" />
        <Stack screenOptions={{ headerStyle: { backgroundColor: c.paper }, headerTintColor: c.ink, contentStyle: { backgroundColor: c.paper }, headerBackTitle: "Back" }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function PushBridge() {
  const { me } = useMe();
  usePush(!!me);
  return null;
}
