import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { env } from "../env";
import { uploadRoot } from "./index";

const run = promisify(execFile);

/**
 * Read a stored video's real duration and size with ffprobe, when FFPROBE_PATH is set (e.g. /usr/bin/ffprobe).
 * Without it the server keeps what the uploading app reported. Returns null if the file isn't a playable video.
 */
export async function probeVideo(file: { key: string; bytes: Buffer }): Promise<{ durationSec: number; width: number; height: number } | null | undefined> {
  const bin = process.env.FFPROBE_PATH;
  if (!bin) return undefined;
  // With cloud storage there is no local copy, so probe a temporary one.
  const tmp = env.STORAGE_DRIVER === "s3" ? await mkdtemp(join(tmpdir(), "probe-")) : null;
  try {
    const path = tmp ? join(tmp, file.key.split("/").pop()!) : join(uploadRoot, file.key);
    if (tmp) await writeFile(path, file.bytes);
    const { stdout } = await run(bin, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path], { timeout: 15_000 });
    const j = JSON.parse(stdout);
    const v = (j.streams ?? []).find((s: any) => s.codec_type === "video");
    const duration = Number(j.format?.duration ?? v?.duration);
    if (!v || !Number.isFinite(duration)) return null;
    // Phones store portrait video as landscape plus a rotation flag.
    const rot = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((d: any) => d.rotation != null)?.rotation ?? 0)) % 180 === 90;
    return { durationSec: Math.round(duration * 10) / 10, width: rot ? v.height : v.width, height: rot ? v.width : v.height };
  } catch {
    return null;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}
