import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useApi } from "@/lib/hooks";
import { FeedVideo } from "@/components/FeedVideo";
import { VideoComments } from "@/components/VideoComments";
import { ErrorNote, Loading, s } from "@/components/ui";

export default function OneVideo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error } = useApi<any>(`/videos/${id}`);
  const [height, setHeight] = useState(0);
  const [muted, setMuted] = useState(false);
  const [comments, setComments] = useState(false);
  if (error) return <View style={s.screen}><ErrorNote error={error} /></View>;
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {!data || !height ? <Loading /> : <FeedVideo v={data} active height={height} muted={muted} onToggleMute={() => setMuted(!muted)} onComments={() => setComments(true)} />}
      <VideoComments video={comments ? data : null} onClose={() => setComments(false)} />
    </View>
  );
}
