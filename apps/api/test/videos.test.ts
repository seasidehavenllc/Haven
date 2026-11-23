import { describe, it, expect, beforeAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/db";
import { admin, buyer, client, getApp, PNG, product, seller } from "./helpers";

/** Smallest thing our sniffer accepts as MP4: an ftyp box header plus padding. */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(64)]);

function form(parts: { name: string; filename?: string; type?: string; data: Buffer | string }[]) {
  const boundary = "----video" + randomUUID();
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"\r\nContent-Type: ${p.type}` : ""}\r\n\r\n`));
    chunks.push(Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data), Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function post(token: string, fields: Record<string, string> = {}, files: { video?: Buffer; poster?: Buffer } = { video: MP4 }) {
  const app = await getApp();
  const f = form([
    ...(files.video ? [{ name: "video", filename: "clip.mp4", type: "video/mp4", data: files.video }] : []),
    ...(files.poster ? [{ name: "poster", filename: "cover.png", type: "image/png", data: files.poster }] : []),
    ...Object.entries(fields).map(([name, data]) => ({ name, data })),
  ]);
  const r = await app.inject({ method: "POST", url: "/videos", payload: f.payload, headers: { ...f.headers, authorization: `Bearer ${token}` } });
  return { status: r.statusCode, json: r.json() };
}

beforeAll(async () => {
  await getApp();
});

describe("short-form video", () => {
  it("posts a shoppable video, checks file types and who can tag what", async () => {
    const s = await seller();
    const mine = await product(s);
    const theirs = await product(await seller());
    expect((await post(s.token, {}, { video: PNG })).status).toBe(400);
    expect((await post(s.token, { productIds: JSON.stringify([theirs.id]) })).status).toBe(403);

    const v = await post(s.token, { caption: "New drop, 3 left", productIds: JSON.stringify([mine.id]), durationSec: "14.5", width: "1080", height: "1920" }, { video: MP4, poster: PNG });
    expect(v.status).toBe(200);
    expect(v.json).toMatchObject({ caption: "New drop, 3 left", mime: "video/mp4", durationSec: 14.5, likeCount: 0, viewCount: 0, likedByMe: false });
    expect(v.json.posterUrl).toMatch(/\.png$/);
    expect(v.json.products.map((p: any) => p.id)).toEqual([mine.id]);

    // A shopper (not a seller) can tag anyone's product, like an affiliate creator.
    const b = await buyer();
    expect((await post(b.token, { productIds: JSON.stringify([mine.id, theirs.id]) })).status).toBe(200);
  });

  it("counts likes, comments and unique daily views for real, and tells the creator", async () => {
    const s = await seller();
    const v = (await post(s.token, { caption: "hi" })).json;
    const fans = await Promise.all([buyer(), buyer()]);

    await Promise.all([fans[0]!.call("POST", `/videos/${v.id}/like`), fans[0]!.call("POST", `/videos/${v.id}/like`), fans[1]!.call("POST", `/videos/${v.id}/like`)]);
    expect((await fans[0]!.call("GET", `/videos/${v.id}`)).json).toMatchObject({ likeCount: 2, likedByMe: true });
    expect((await fans[0]!.call("DELETE", `/videos/${v.id}/like`)).json.likeCount).toBe(1);
    expect((await fans[0]!.call("DELETE", `/videos/${v.id}/like`)).json.likeCount).toBe(1);

    const c = await fans[1]!.call("POST", `/videos/${v.id}/comments`, { body: "Is the jacket still available?" });
    expect(c.status).toBe(200);
    expect((await fans[0]!.call("DELETE", `/videos/${v.id}/comments/${c.json.id}`)).status).toBe(403);
    expect((await s.call("DELETE", `/videos/${v.id}/comments/${c.json.id}`)).status).toBe(200);
    expect((await fans[0]!.call("GET", `/videos/${v.id}`)).json.commentCount).toBe(0);

    // Views: once per viewer per day; the creator's own views don't count.
    expect((await fans[0]!.call("POST", `/videos/${v.id}/view`)).json.counted).toBe(true);
    expect((await fans[0]!.call("POST", `/videos/${v.id}/view`)).json.counted).toBe(false);
    expect((await s.call("POST", `/videos/${v.id}/view`)).json.counted).toBe(false);
    const anon = await client();
    expect((await anon("POST", `/videos/${v.id}/view`)).json.counted).toBe(true);
    expect((await anon("POST", `/videos/${v.id}/view`)).json.counted).toBe(false);
    expect((await anon("GET", `/videos/${v.id}`)).json.viewCount).toBe(2);

    const inbox = (await s.call("GET", "/notifications")).json.map((n: any) => n.type).sort();
    expect(inbox).toEqual(["video.comment", "video.like", "video.like"]);
  });

  it("serves a ranked For You feed and a Following feed", async () => {
    const creator = await seller();
    const fan = await buyer();
    const v = (await post(creator.token, { caption: "follow me" })).json;
    const forYou = await fan.call("GET", "/videos/feed?tab=foryou");
    expect(forYou.status).toBe(200);
    expect(forYou.json.videos.length).toBeGreaterThan(0);

    expect((await fan.call("GET", "/videos/feed?tab=following")).json.videos.find((x: any) => x.id === v.id)).toBeUndefined();
    await fan.call("POST", `/users/${creator.userId}/follow`);
    const following = (await fan.call("GET", "/videos/feed?tab=following")).json.videos;
    expect(following[0]).toMatchObject({ id: v.id, followingCreator: true });
    expect((await creator.call("GET", "/notifications")).json.map((n: any) => n.type)).toContain("social.follow");

    const handle = (await creator.call("GET", "/me")).json.user.handle;
    const profile = (await fan.call("GET", `/users/${handle}`)).json;
    expect(profile).toMatchObject({ id: creator.userId, followerCount: 1, followingCount: 0, videoCount: 1, followedByMe: true, isMe: false });
    expect(profile.email).toBeUndefined();
    expect((await (await client())("GET", `/users/${handle}`)).json.followedByMe).toBe(false);
  });

  it("lets creators delete and admins remove videos, which then leave every feed", async () => {
    const s = await seller();
    const v = (await post(s.token)).json;
    const fan = await buyer();
    expect((await fan.call("POST", `/videos/${v.id}/report`, { reason: "Spam" })).status).toBe(200);
    expect((await fan.call("POST", `/videos/${v.id}/report`, { reason: "Spam" })).status).toBe(409);
    expect((await fan.call("POST", `/admin/videos/${v.id}/remove`, { reason: "Spam" })).status).toBe(403);
    const a = await admin();
    expect((await a.call("POST", `/admin/videos/${v.id}/remove`, { reason: "Spam" })).status).toBe(200);
    expect((await fan.call("GET", `/videos/${v.id}`)).status).toBe(404);
    expect((await prisma.report.findFirstOrThrow({ where: { targetType: "video", targetId: v.id } })).status).toBe("ACTIONED");

    const w = (await post(s.token)).json;
    expect((await fan.call("DELETE", `/videos/${w.id}`)).status).toBe(404);
    expect((await s.call("DELETE", `/videos/${w.id}`)).status).toBe(200);
    expect((await fan.call("GET", `/videos/${w.id}`)).status).toBe(404);
  });

  it.skipIf(!existsSync("/usr/bin/ffprobe"))("measures uploads with ffprobe when configured and rejects unreadable files", async () => {
    vi.stubEnv("FFPROBE_PATH", "/usr/bin/ffprobe");
    try {
      const file = join(mkdtempSync(join(tmpdir(), "vid-")), "clip.mp4");
      execFileSync("/usr/bin/ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=teal:s=360x640:d=2", "-pix_fmt", "yuv420p", "-y", file]);
      const s = await seller();
      const v = await post(s.token, { durationSec: "99", width: "1", height: "1" }, { video: readFileSync(file) });
      expect(v.status).toBe(200);
      expect(v.json).toMatchObject({ durationSec: 2, width: 360, height: 640 });
      expect((await post(s.token)).status).toBe(400);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
