import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/lib/hooks";
import { useColors } from "@/components/ui";

export default function Root() {
  const c = useColors();
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerStyle: { backgroundColor: c.paper }, headerTintColor: c.ink, contentStyle: { backgroundColor: c.paper }, headerBackTitle: "Back" }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="p/[id]" options={{ title: "" }} />
          <Stack.Screen name="live/[id]" options={{ title: "Live" }} />
          <Stack.Screen name="cart" options={{ title: "Cart" }} />
          <Stack.Screen name="scan/[id]" options={{ title: "Review listing" }} />
          <Stack.Screen name="studio/[id]" options={{ title: "Studio" }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
