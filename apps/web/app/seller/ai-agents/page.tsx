"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Empty, ErrorNote, Loading, NotConfigured } from "@/components/ui";

type Agent = {
  id: string;
  name: string;
  personality: string;
  salesStyle: string;
  voiceProvider: string | null;
  voiceId: string | null;
  avatarProvider: string | null;
  avatarId: string | null;
  talkingPoints: string[];
};
type Voice = { id: string; name: string; preview: string | null; labels: Record<string, string> };

export default function AiAgents() {
  const agents = useApi<Agent[]>("/seller/ai-agents");
  const voices = useApi<{ configured: boolean; provider?: string; voices: Voice[]; requiredEnv?: string[] }>("/seller/ai/voices");
  const [err, setErr] = useState<any>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  if (agents.loading) return <Loading />;
  if (agents.error) return <ErrorNote error={agents.error} />;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setErr(null);
    try {
      await api("/seller/ai-agents", { body: { name } });
      setName("");
      agents.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">AI salespeople</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          An AI salesperson can host a show for you or speak as your co-host. Viewers always see that it's AI. It only uses your real catalog, stock and policies, and every word it says is billed to your AI credits and kept in the show's AI log.
        </p>
      </div>
      <ErrorNote error={err} />
      {voices.data && !voices.data.configured && <NotConfigured what="AI voice" env={voices.data.requiredEnv ?? ["ELEVENLABS_API_KEY"]} />}

      <form onSubmit={create} className="panel flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-56 flex-1">
          <label className="label">New AI salesperson</label>
          <input className="input" placeholder="Name, e.g. Sunny" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={60} required />
        </div>
        <button className="btn-ai" disabled={creating}>
          Create
        </button>
        <p className="w-full text-xs text-muted">
          Needs the Business plan or higher. <Link href="/seller/ai" className="underline">See plans</Link>
        </p>
      </form>

      {!agents.data?.length ? (
        <Empty title="No AI salespeople yet">Create one, give it a voice, then pick it when you schedule an AI-hosted show.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {agents.data.map((a) => (
            <AgentCard key={a.id} agent={a} voices={voices.data} onSaved={agents.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, voices, onSaved }: { agent: Agent; voices: { configured: boolean; provider?: string; voices: Voice[] } | null; onSaved: () => void }) {
  const [f, setF] = useState({
    name: agent.name,
    personality: agent.personality,
    salesStyle: agent.salesStyle,
    voiceId: agent.voiceId ?? "",
    avatarId: agent.avatarId ?? "",
    talkingPoints: agent.talkingPoints.join("\n"),
  });
  const [err, setErr] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<{ url: string; credits: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const voice = voices?.voices.find((v) => v.id === f.voiceId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    try {
      await api(`/seller/ai-agents/${agent.id}`, {
        method: "PATCH",
        body: {
          name: f.name,
          personality: f.personality,
          salesStyle: f.salesStyle,
          voiceProvider: f.voiceId ? (voices?.provider ?? null) : null,
          voiceId: f.voiceId || null,
          avatarProvider: f.avatarId ? "heygen" : null,
          avatarId: f.avatarId.trim() || null,
          talkingPoints: f.talkingPoints.split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 30),
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setErr(e);
    }
  }

  async function hear() {
    if (!f.voiceId) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api("/seller/ai/voices/preview", { body: { voiceId: f.voiceId, text: `Hi, I'm ${f.name}. Welcome to the show! Let's find you something great.` } });
      setPreview({ url: r.url, credits: r.creditsCharged });
      new Audio(r.url).play().catch(() => {});
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="panel space-y-3 border-ai/30 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-ai">{agent.name}</h2>
        <span className="chip bg-ai/10 text-ai">AI</span>
      </div>
      <ErrorNote error={err} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} minLength={2} maxLength={60} />
        </div>
        <div>
          <label className="label">Personality</label>
          <input className="input" value={f.personality} onChange={(e) => setF({ ...f, personality: e.target.value })} maxLength={200} placeholder="friendly, upbeat" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Sales style</label>
          <input className="input" value={f.salesStyle} onChange={(e) => setF({ ...f, salesStyle: e.target.value })} maxLength={200} placeholder="consultative, no pressure" />
        </div>
      </div>

      <div>
        <label className="label">Voice</label>
        {voices?.configured ? (
          <div className="flex flex-wrap gap-2">
            <select className="input min-w-48 flex-1" value={f.voiceId} onChange={(e) => setF({ ...f, voiceId: e.target.value })}>
              <option value="">No voice (text only)</option>
              {voices.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {Object.values(v.labels).length ? ` · ${Object.values(v.labels).slice(0, 3).join(", ")}` : ""}
                </option>
              ))}
            </select>
            <button type="button" className="btn-ghost" disabled={!f.voiceId || busy} onClick={hear}>
              {busy ? "Making sample…" : "▶ Hear it"}
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted">Voices appear here once a voice provider is set up on the server.</p>
        )}
        {voice?.preview && !preview && (
          <audio className="mt-2 w-full" controls src={voice.preview}>
            <track kind="captions" />
          </audio>
        )}
        {preview && <p className="mt-1 text-xs text-muted">Sample made with your voice settings · used {preview.credits} credit{preview.credits === 1 ? "" : "s"}</p>}
      </div>

      <div>
        <label className="label">Avatar ID (HeyGen, optional)</label>
        <input className="input" value={f.avatarId} onChange={(e) => setF({ ...f, avatarId: e.target.value })} maxLength={120} placeholder="Leave empty for voice only" />
        <p className="mt-1 text-xs text-muted">A video avatar presents AI-hosted shows. It's billed per minute while it's on.</p>
      </div>

      <div>
        <label className="label">Talking points (one per line)</label>
        <textarea className="input min-h-24" value={f.talkingPoints} onChange={(e) => setF({ ...f, talkingPoints: e.target.value })} placeholder={"Free shipping over $50\nEverything is hand-checked"} />
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary">Save</button>
        {saved && <span className="text-sm text-ok">Saved</span>}
      </div>
    </form>
  );
}
