"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { ErrorNote, Loading, Money, minPrice } from "@/components/ui";

const MAX_MB = 100;
const MAX_TAGS = 6;

/** Grab a frame from the chosen video to use as its cover. */
function captureCover(video: HTMLVideoElement) {
  return new Promise<Blob | null>((resolve) => {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 720 / Math.max(video.videoWidth, 1));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
  });
}

export default function NewVideo() {
  const router = useRouter();
  const { me, ready } = useMe();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<any>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const isSeller = !!me?.seller;
  const mine = useApi<any[]>(isSeller ? "/seller/products" : null, [isSeller]);
  const search = useApi<{ items: any[] }>(!isSeller && q.trim().length > 1 ? `/products?q=${encodeURIComponent(q)}&pageSize=8` : null, [q]);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  useEffect(() => {
    if (ready && !me) router.push("/login?next=/videos/new");
  }, [ready, me]);
  if (!ready || !me) return <Loading />;

  const options = isSeller ? (mine.data ?? []).filter((p) => p.status === "ACTIVE") : (search.data?.items ?? []);
  const toggle = (p: any) => setTags((t) => (t.some((x) => x.id === p.id) ? t.filter((x) => x.id !== p.id) : t.length >= MAX_TAGS ? t : [...t, p]));

  async function submit() {
    const v = preview.current;
    if (!file || !v) return;
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("video", file);
      const cover = await captureCover(v).catch(() => null);
      if (cover) form.append("poster", cover, "cover.jpg");
      form.append("caption", caption);
      form.append("productIds", JSON.stringify(tags.map((t) => t.id)));
      if (Number.isFinite(v.duration)) form.append("durationSec", String(Math.round(v.duration * 10) / 10));
      if (v.videoWidth) form.append("width", String(v.videoWidth));
      if (v.videoHeight) form.append("height", String(v.videoHeight));
      const created = await api("/videos", { form });
      router.push(`/videos/${created.id}`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-[300px_1fr]">
      <div>
        {url ? (
          <video ref={preview} src={url} className="aspect-[9/16] w-full rounded-3xl bg-stage object-cover" controls playsInline muted onLoadedData={(e) => (e.currentTarget.currentTime = Math.min(0.5, e.currentTarget.duration / 2))} />
        ) : (
          <label className="grid aspect-[9/16] w-full cursor-pointer place-items-center rounded-3xl border-2 border-dashed border-line text-center text-sm text-muted hover:border-brand">
            <span>
              <span className="block text-3xl">🎬</span>
              Choose a video
              <span className="block text-xs">MP4, MOV or WebM, up to {MAX_MB} MB. Vertical looks best.</span>
            </span>
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > MAX_MB * 1024 * 1024) return setErr(new Error(`That video is over ${MAX_MB} MB`));
                setErr(null);
                setFile(f);
                setUrl(URL.createObjectURL(f));
              }}
            />
          </label>
        )}
        {url && (
          <button className="mt-2 text-sm text-muted underline" onClick={() => (setFile(null), setUrl(null))}>
            Choose a different video
          </button>
        )}
      </div>
      <div className="space-y-4">
        <h1 className="font-display text-3xl font-bold">Post a video</h1>
        <label className="block">
          <span className="label">Caption</span>
          <textarea className="input min-h-24" maxLength={500} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What are you showing?" />
        </label>
        <div className="space-y-2">
          <span className="label">Tag products ({tags.length}/{MAX_TAGS})</span>
          <p className="text-xs text-muted">{isSeller ? "Pick from your listings. Viewers can buy straight from the video." : "Search for what's in your video so viewers can shop it."}</p>
          {!isSeller && <input className="input" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {options.map((p) => {
              const on = tags.some((t) => t.id === p.id);
              return (
                <button key={p.id} type="button" onClick={() => toggle(p)} className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left text-sm ${on ? "border-brand bg-brand/10" : "border-line"}`}>
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-line">{p.media?.[0] && <img src={p.media[0].url} alt="" className="h-full w-full object-cover" />}</div>
                  <span className="flex-1 truncate">{p.title}</span>
                  <Money cents={minPrice(p)} />
                  <span>{on ? "✓" : "+"}</span>
                </button>
              );
            })}
            {isSeller && mine.data && !options.length && <p className="text-sm text-muted">No active listings to tag yet.</p>}
          </div>
        </div>
        <ErrorNote error={err} />
        <button className="btn-primary w-full py-3" disabled={!file || busy} onClick={submit}>
          {busy ? "Uploading…" : "Post video"}
        </button>
      </div>
    </div>
  );
}
