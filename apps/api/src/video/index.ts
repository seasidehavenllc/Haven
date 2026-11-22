import { SignJWT } from "jose";
import { env } from "../env";
import { notConfigured } from "../lib/errors";

/**
 * Live video provider abstraction. LiveKit is implemented (access tokens are standard JWTs
 * signed with the API secret). Agora/Mux adapters can implement the same interface.
 */
export interface VideoProvider {
  id: string;
  configured(): boolean;
  joinToken(opts: { room: string; identity: string; name: string; canPublish: boolean }): Promise<{ url: string; token: string }>;
}

export const livekit: VideoProvider = {
  id: "livekit",
  configured: () => !!(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET),
  async joinToken({ room, identity, name, canPublish }) {
    if (!this.configured()) throw notConfigured("Live video (LiveKit)", ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]);
    const token = await new SignJWT({
      name,
      video: { room, roomJoin: true, canPublish, canSubscribe: true, canPublishData: canPublish },
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(env.LIVEKIT_API_KEY!)
      .setSubject(identity)
      .setNotBefore(Math.floor(Date.now() / 1000) - 10)
      .setExpirationTime("6h")
      .sign(new TextEncoder().encode(env.LIVEKIT_API_SECRET!));
    return { url: env.LIVEKIT_URL!, token };
  },
};

export const videoProvider: VideoProvider = livekit;
