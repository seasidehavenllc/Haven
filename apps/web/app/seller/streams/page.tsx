"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Empty, ErrorNote, Loading, ModeBadge } from "@/components/ui";

const MODES = [
  ["HUMAN", "Human host", "You present. No AI."],
  ["HUMAN_AI_COHOST", "Human + AI co-host", "You present. AI listens and helps you privately, and can answer chat if you allow it."],
  ["AI_HOST", "AI host", "An AI salesperson runs the show. Always labeled as AI to viewers."],
] as const;

export default function Streams() {
  const router = useRouter();
  const { data, loading } = useApi<any[]>("/seller/streams");
  const agents = useApi<any[]>("/seller/ai-agents");
  const [f, setF] = useState({ title: "", mode: "HUMAN_AI_COHOST", when: "", aiAgentId: "" });
  const [err, setErr] = useState<any>(null);
  if (loading) return <Loading />;
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Live studio</h1>
      <form
        className="panel space-y-4 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            const s = await api("/seller/streams", {
              body: { title: f.title, mode: f.mode, scheduledFor: f.when ? new Date(f.when).toISOString() : undefined, aiAgentId: f.aiAgentId || undefined },
            });
            router.push(`/seller/streams/${s.id}`);
          } catch (e) {
            setErr(e);
          }
        }}
      >
        <h2 className="font-display text-lg font-semibold">New show</h2>
        <div className="grid gap-2 md:grid-cols-3">
          {MODES.map(([v, l, d]) => (
            <button type="button" key={v} onClick={() => setF({ ...f, mode: v })} className={`rounded-2xl border p-3 text-left ${f.mode === v ? "border-glint bg-glint/10" : "border-line"}`}>
              <div className="font-semibold">{l}</div>
              <div className="text-xs text-muted">{d}</div>
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <input className="input md:col-span-2" placeholder="Show title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required minLength={3} />
          <input className="input" type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} aria-label="Schedule (optional)" />
        </div>
        {f.mode === "AI_HOST" && (
          <div>
            <label className="label">AI salesperson</label>
            {agents.data?.length ? (
              <select className="input" value={f.aiAgentId} onChange={(e) => setF({ ...f, aiAgentId: e.target.value })} required>
                <option value="">Choose…</option>
                {agents.data.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-muted">AI salespeople come with the Business plan. Autonomous hosting (voice + avatar) is in the next build phase.</p>
            )}
          </div>
        )}
        <p className="text-xs text-muted">Every active product with "live menu" on is added to the show automatically. You can hide or remove items in the studio.</p>
        <ErrorNote error={err} />
        <button className="btn-primary">Create show</button>
      </form>
      {data?.length ? (
        <div className="divide-y divide-line rounded-2xl border border-line bg-card">
          {data.map((s) => (
            <Link key={s.id} href={`/seller/streams/${s.id}`} className="flex items-center justify-between gap-2 p-3 text-sm">
              <div>
                <div className="font-medium">{s.title}</div>
                <div className="text-xs text-muted">
                  {s._count.products} products · {s.status.toLowerCase()}
                  {s.scheduledFor && ` · ${new Date(s.scheduledFor).toLocaleString()}`}
                </div>
              </div>
              <div className="flex gap-2">
                {s.status === "LIVE" && <span className="chip bg-live text-white">Live</span>}
                <ModeBadge mode={s.mode} />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty title="No shows yet" />
      )}
    </div>
  );
}
