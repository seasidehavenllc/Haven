import { mkdir, readFile, writeFile } from "node:fs/promises";
import { AwsClient } from "aws4fetch";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { env } from "../env";
import { badRequest, notConfigured } from "../lib/errors";

export interface StoredFile {
  url: string;
  key: string;
  sha256: string;
  mime: string;
  bytes: Buffer;
}

const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/webm", "webm"],
  ["audio/mpeg", "mp3"],
]);
const MAX_IMAGE = 15 * 1024 * 1024;
export const MAX_VIDEO = 100 * 1024 * 1024;

/** Sniff magic bytes; never trust the client-provided content type alone. */
function sniff(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  const ftyp = buf.subarray(4, 12).toString();
  if (ftyp.startsWith("ftypheic") || ftyp.startsWith("ftypheix") || ftyp.startsWith("ftypmif1")) return "image/heic";
  if (ftyp.startsWith("ftypqt")) return "video/quicktime";
  if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  if (buf.subarray(0, 3).toString() === "ID3" || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ftyp.startsWith("ftyp")) return "video/mp4";
  return null;
}

export const uploadRoot = resolve(env.UPLOAD_DIR);

/** Stores a sniffed, size-checked file. Audio is only accepted where the caller asks for it (AI speech). */
export async function storeUpload(bytes: Buffer, prefix: string, opts: { audio?: boolean } = {}): Promise<StoredFile> {
  const mime = sniff(bytes);
  if (!mime || !ALLOWED.has(mime) || (mime.startsWith("audio/") && !opts.audio)) throw badRequest("Unsupported file type. Use JPEG, PNG, WebP, HEIC, MP4, MOV or WebM.");
  if (mime.startsWith("audio/") && bytes.length > MAX_IMAGE) throw badRequest("Audio exceeds 15 MB");
  if (mime.startsWith("image/") && bytes.length > MAX_IMAGE) throw badRequest("Image exceeds 15 MB");
  if (mime.startsWith("video/") && bytes.length > MAX_VIDEO) throw badRequest("Video exceeds 100 MB");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const key = `${prefix}/${randomUUID()}.${ALLOWED.get(mime)}`;
  if (env.STORAGE_DRIVER === "s3") {
    const s3 = bucket();
    const res = await s3.client.fetch(`${s3.base}/${key}`, {
      method: "PUT",
      body: new Uint8Array(bytes),
      headers: { "content-type": mime, "cache-control": "public, max-age=31536000, immutable" },
    });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return { url: `${publicBase()}${key}`, key, sha256: sha, mime, bytes };
  }
  const path = join(uploadRoot, key);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, bytes);
  return { url: `${env.PUBLIC_API_URL}/uploads/${key}`, key, sha256: sha, mime, bytes };
}

let s3: { client: AwsClient; base: string } | null = null;
function bucket() {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.CDN_BASE_URL)
    throw notConfigured("File storage", ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "CDN_BASE_URL"]);
  s3 ??= {
    client: new AwsClient({ accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, service: "s3", region: env.S3_REGION }),
    base: `${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET}`,
  };
  return s3;
}

/** Where stored files are publicly served from (ends with a slash). */
export function publicBase() {
  return env.STORAGE_DRIVER === "s3" ? `${(env.CDN_BASE_URL ?? "").replace(/\/$/, "")}/` : `${env.PUBLIC_API_URL}/uploads/`;
}

/** Read back a file this server stored, by its public URL. Refuses URLs that aren't ours. */
export async function readStored(url: string): Promise<{ key: string; bytes: Buffer }> {
  const base = publicBase();
  if (!url.startsWith(base)) throw badRequest("Not a stored file");
  const key = url.slice(base.length);
  if (key.includes("..")) throw badRequest("Not a stored file");
  if (env.STORAGE_DRIVER === "s3") {
    const res = await bucket().client.fetch(`${bucket().base}/${key}`);
    if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
    return { key, bytes: Buffer.from(await res.arrayBuffer()) };
  }
  return { key, bytes: await readFile(join(uploadRoot, key)) };
}
