import { requireOptionalNativeModule } from "expo";

type Native = { grab(quality: number): Promise<string> };

/** Missing on Android, on the web, and in builds made before this module existed. */
const native = requireOptionalNativeModule<Native>("HavenFrameGrab");

/** Name of the pass-through video effect to put on the host's camera track, or null if unavailable. */
export const frameGrabEffect: string | null = native ? "haven-frame-grab" : null; // must match kProcessorName in HavenFrameKeeper.m

/** Saves the newest frame of the live camera as a JPEG and returns its file URL, or null if that isn't possible. */
export async function grabLiveFrame(quality = 0.85): Promise<string | null> {
  if (!native) return null;
  try {
    return await native.grab(quality);
  } catch {
    return null;
  }
}
