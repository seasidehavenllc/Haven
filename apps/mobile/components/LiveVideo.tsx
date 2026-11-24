import { AudioSession, LiveKitRoom, VideoTrack, isTrackReference, useLocalParticipant, useRoomContext, useTracks } from "@livekit/react-native";
import { Track } from "livekit-client";
import { useEffect, useState, type MutableRefObject } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { api } from "@/lib/api";
import { Icon, T, friendlyError } from "./ui";

/** Lets the studio turn the camera off for a moment (to snap a photo of an item) and back on. */
export type HostCamera = { setCamera: (on: boolean) => Promise<void> };

/**
 * Live video through LiveKit. The API hands out a join token for the show's room: the host's token can
 * publish camera and microphone, everyone else's can only watch. `host` turns on this phone's camera.
 */
export function LiveVideo({ streamId, host = false, cameraRef, controlsStyle }: { streamId: string; host?: boolean; cameraRef?: MutableRefObject<HostCamera | null>; controlsStyle?: object }) {
  const [join, setJoin] = useState<{ url: string; token: string } | null>(null);
  const [err, setErr] = useState<any>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setErr(null);
    api<{ url: string; token: string }>(`/streams/${streamId}/video-token`)
      .then((j) => live && setJoin(j))
      .catch((e) => live && setErr(e));
    return () => {
      live = false;
    };
  }, [streamId, attempt]);

  useEffect(() => {
    AudioSession.startAudioSession();
    return () => {
      AudioSession.stopAudioSession();
    };
  }, []);

  if (err)
    return (
      <Center>
        <T color="#fff" size={13} style={{ textAlign: "center", opacity: 0.85 }}>{friendlyError(err)}</T>
        <Pressable onPress={() => setAttempt((n) => n + 1)} hitSlop={8}>
          <T color="#5fd3e8" size={13} weight="700">Try again</T>
        </Pressable>
      </Center>
    );
  if (!join) return <Center><ActivityIndicator color="#fff" /></Center>;

  return (
    <LiveKitRoom serverUrl={join.url} token={join.token} connect audio={host} video={host} options={{ adaptiveStream: { pixelDensity: "screen" } }} onError={setErr}>
      {host ? <HostView cameraRef={cameraRef} controlsStyle={controlsStyle} /> : <ViewerView />}
    </LiveKitRoom>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => (
  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 16 }}>{children}</View>
);

/** Shows the host's camera. Viewers never publish. */
function ViewerView() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true }).filter(isTrackReference);
  const cam = tracks.find((t) => !t.participant.isLocal);
  if (!cam)
    return (
      <Center>
        <ActivityIndicator color="#fff" />
        <T color="#fff" size={13} style={{ opacity: 0.85 }}>Waiting for the host's camera…</T>
      </Center>
    );
  return <VideoTrack trackRef={cam} style={{ flex: 1 }} objectFit="cover" />;
}

/** The host's own camera preview, with flip, mute and camera-off controls. */
function HostView({ cameraRef, controlsStyle }: { cameraRef?: MutableRefObject<HostCamera | null>; controlsStyle?: object }) {
  const room = useRoomContext();
  const { isCameraEnabled, isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  useEffect(() => {
    if (!cameraRef) return;
    cameraRef.current = { setCamera: async (on) => void (await localParticipant.setCameraEnabled(on)) };
    return () => {
      cameraRef.current = null;
    };
  }, [cameraRef, localParticipant]);
  const [front, setFront] = useState(true);
  const mine = useTracks([Track.Source.Camera]).filter(isTrackReference).find((t) => t.participant.isLocal);

  const flip = async () => {
    const pub = localParticipant.getTrackPublication(Track.Source.Camera);
    const track: any = pub?.track;
    // react-native-webrtc switches lenses on the existing camera track.
    track?.mediaStreamTrack?._switchCamera?.();
    setFront(!front);
  };

  return (
    <View style={{ flex: 1 }}>
      {mine && isCameraEnabled ? (
        <VideoTrack trackRef={mine} style={{ flex: 1 }} objectFit="cover" mirror={front} />
      ) : (
        <Center>
          <T color="#fff" size={13} style={{ opacity: 0.85 }}>{isCameraEnabled ? "Starting camera…" : "Camera is off"}</T>
        </Center>
      )}
      <View style={[{ position: "absolute", right: 10, bottom: 10, flexDirection: "row", gap: 8 }, controlsStyle]}>
        <Round icon={isMicrophoneEnabled ? "mic" : "mic-off"} label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"} onPress={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)} />
        <Round icon={isCameraEnabled ? "videocam" : "videocam-off"} label={isCameraEnabled ? "Turn camera off" : "Turn camera on"} onPress={() => localParticipant.setCameraEnabled(!isCameraEnabled)} />
        <Round icon="camera-reverse" label="Flip camera" onPress={flip} disabled={!isCameraEnabled || room.state !== "connected"} />
      </View>
    </View>
  );
}

function Round({ icon, label, onPress, disabled }: { icon: any; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityLabel={label} onPress={onPress} disabled={disabled} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", opacity: disabled ? 0.5 : 1 }}>
      <Icon name={icon} size={20} color="#fff" />
    </Pressable>
  );
}
