import { useLocalSearchParams } from "expo-router";
import { LiveFeed } from "@/components/LiveFeed";

/** A show opened from a notification, a profile or a link. Swipe up from it to the other live shows. */
export default function LiveViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LiveFeed startId={id} standalone />;
}
