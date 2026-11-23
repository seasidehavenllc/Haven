"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ErrorNote, Loading } from "@/components/ui";

type Prefs = { push: boolean; email: boolean; mutedTypes: string[]; mutableTypes: string[]; channels: { push: boolean; email: boolean } };

const LABELS: Record<string, string> = {
  "stream.live": "A seller I follow goes live",
  "auction.outbid": "I've been outbid",
  "social.follow": "Someone follows me",
  "video.like": "Likes on my videos",
  "video.comment": "Comments on my videos",
  marketing: "Deals and announcements from Haven",
};

export default function NotificationSettings() {
  const { data, loading, error } = useApi<Prefs>("/me/notification-preferences");
  const [p, setP] = useState<Prefs | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<any>(null);
  useEffect(() => setP(data), [data]);
  if (loading || !p) return error ? <ErrorNote error={error} /> : <Loading />;

  async function save(next: Prefs) {
    setP(next);
    setSaved(false);
    setErr(null);
    try {
      await api("/me/notification-preferences", { method: "PUT", body: { push: next.push, email: next.email, mutedTypes: next.mutedTypes } });
      setSaved(true);
    } catch (e) {
      setErr(e);
    }
  }
  const Toggle = ({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) => (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <input type="checkbox" className="h-5 w-5 accent-[var(--color-brand)]" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="font-display text-3xl font-bold">Notification settings</h1>
      <p className="text-sm text-muted">Your in-app inbox always keeps order, payment and moderation notices. These settings control everything else.</p>
      <section className="panel divide-y divide-line px-4">
        <Toggle label="Push notifications" hint="On phones where you've installed the Haven app and allowed notifications." on={p.push} onChange={(v) => save({ ...p, push: v })} />
        <Toggle
          label="Email"
          hint={p.channels.email ? "Order, shipping, auction wins and account notices only." : "Email isn't set up on this server yet."}
          on={p.email}
          onChange={(v) => save({ ...p, email: v })}
        />
      </section>
      <h2 className="font-display text-lg font-semibold">Tell me when</h2>
      <section className="panel divide-y divide-line px-4">
        {p.mutableTypes.map((t) => (
          <Toggle key={t} label={LABELS[t] ?? t} on={!p.mutedTypes.includes(t)} onChange={(v) => save({ ...p, mutedTypes: v ? p.mutedTypes.filter((x) => x !== t) : [...p.mutedTypes, t] })} />
        ))}
      </section>
      <ErrorNote error={err} />
      {saved && <div className="text-sm text-ok">Saved</div>}
    </div>
  );
}
