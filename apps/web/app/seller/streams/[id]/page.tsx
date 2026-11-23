"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useApi, useRealtime } from "@/lib/hooks";
import { ErrorNote, Loading, Money, NotConfigured, minPrice, stock } from "@/components/ui";

const MODE_BANNER: Record<string, { label: string; cls: string; sub: string }> = {
  HUMAN: { label: "HUMAN HOST", cls: "border border-line bg-card text-ink", sub: "AI is off for this show." },
  HUMAN_AI_COHOST: { label: "HUMAN + AI CO-HOST", cls: "bg-ai text-white", sub: "You're in control. The AI helps privately unless you let it speak." },
  AI_HOST: { label: "AI HOST", cls: "bg-ai text-white", sub: "An AI salesperson is presenting. Viewers see an AI label." },
};

export default function Studio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: s, loading, error, reload, setData } = useApi<any>(`/streams/${id}`);
  const log = useApi<any[]>(`/seller/streams/${id}/ai-log`);
  const [chat, setChat] = useState<any[]>([]);
  const [err, setErr] = useState<any>(null);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [say, setSay] = useState("");
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (s?.chat) setChat(s.chat);
  }, [s?.id]);
  useRealtime(`stream:${id}`, {
    "stream:chat": (m: any) => setChat((c) => (m.hidden ? c.filter((x) => x.id !== m.id) : [...c.slice(-199), m])),
    "stream:chat:update": (m: any) => setChat((c) => c.map((x) => (x.id === m.id ? { ...x, ...m } : x))),
    "stream:viewers": (p: any) => setData((d: any) => d && { ...d, viewers: p.count }),
    "inventory:changed": () => reload(),
    "stream:menu": () => reload(),
    "order:created": () => reload(),
  }, { host: true });

  if (loading) return <Loading />;
  if (error || !s) return <ErrorNote error={error} />;
  const banner = MODE_BANNER[s.mode]!;
  const act = (path: string, body: unknown = {}, method = "POST") => api(`/seller/streams/${id}${path}`, { method, body }).then(() => { reload(); log.reload(); }).catch(setErr);

  const hasVoice = !!s.aiAgent?.voiceId;
  const canSpeak = s.mode === "AI_HOST" || (s.mode === "HUMAN_AI_COHOST" && s.aiPublicSpeech);

  async function aiReply(messageId: string) {
    setErr(null);
    try {
      const r = await api(`/seller/streams/${id}/ai/respond`, { body: { messageId, speak: voiceReplies && hasVoice } });
      if (r.voiceError) setErr({ message: `The answer was posted as text. Voice didn't work: ${r.voiceError}` });
      log.reload();
    } catch (e) {
      setErr(e);
    }
  }

  async function speak(body: { text?: string; messageId?: string }) {
    setSpeaking(true);
    setErr(null);
    try {
      await api(`/seller/streams/${id}/ai/speak`, { body });
      setSay("");
      log.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setSpeaking(false);
    }
  }

  async function ask(question: string) {
    setAsking(true);
    setErr(null);
    try {
      const r = await api(`/seller/streams/${id}/cohost/ask`, { body: { question } });
      setAnswers((a) => [{ q: question, a: r.answer }, ...a]);
      setQ("");
      log.reload();
    } catch (e) {
      setErr(e);
    } finally {
      setAsking(false);
    }
  }

  // Browser speech recognition (Chrome/Edge/Safari) for the host's voice. Server STT providers plug in later.
  function toggleListening() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return setErr({ message: "This browser doesn't support speech recognition. Type your question instead." });
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const text = Array.from(e.results).slice(e.resultIndex).map((r: any) => r[0].transcript).join(" ").trim();
      if (!text) return;
      api(`/seller/streams/${id}/transcript`, { body: { text } }).catch(() => {});
      const m = text.match(/^(?:hey\s+)?(?:ai|assistant)[,\s]+(.+)/i);
      if (m) ask(m[1]!);
    };
    rec.onend = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }

  const aiOn = s.mode !== "HUMAN";
  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 ${banner.cls}`}>
        <div>
          <div className="font-display text-lg font-bold tracking-wide">{banner.label}</div>
          <div className="text-xs opacity-80">{banner.sub}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="chip bg-white/15">{s.status.toLowerCase()}</span>
          <span className="chip bg-white/15">{s.viewers} watching</span>
          {s.status === "SCHEDULED" && <button className="btn bg-live text-white" onClick={() => act("/start")}>Go live</button>}
          {s.status === "LIVE" && <button className="btn bg-white/15" onClick={() => act("/pause")}>Pause</button>}
          {s.status === "PAUSED" && <button className="btn bg-white/15" onClick={() => act("/resume")}>Resume</button>}
          {s.status !== "ENDED" && <button className="btn bg-white/15" onClick={() => confirm("End this show?") && act("/end")}>End</button>}
          <Link href={`/live/${id}`} className="btn bg-white/15" target="_blank">Viewer page</Link>
        </div>
      </div>
      {!s.video.configured && <NotConfigured what="Live video" env={["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]} />}
      <ErrorNote error={err} />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <section className="space-y-4">
          <div className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Product menu</h2>
              <span className="text-xs text-muted">Stock updates live. Sold-out items can't be bought.</span>
            </div>
            <div className="divide-y divide-line">
              {s.products.map(({ product: p, hidden }: any) => {
                const pinned = p.id === s.pinnedProductId;
                const left = stock(p);
                return (
                  <div key={p.id} className={`flex flex-wrap items-center gap-3 py-2 ${hidden ? "opacity-50" : ""}`}>
                    <div className="h-12 w-12 overflow-hidden rounded-lg bg-line">{p.media[0] && <img src={p.media[0].url} alt="" className="h-full w-full object-cover" />}</div>
                    <div className="min-w-40 flex-1 text-sm">
                      <div className="font-medium">{p.title}</div>
                      <div className="text-xs text-muted">
                        <Money cents={minPrice(p)} /> · <span className={left === 0 ? "text-live" : left <= 3 ? "text-warn" : ""}>{left} in stock</span>
                        {p.variants.length > 1 && ` · ${p.variants.map((v: any) => `${v.name}: ${v.quantity}`).join(", ")}`}
                      </div>
                    </div>
                    <button className={pinned ? "btn-primary" : "btn-ghost"} disabled={hidden} onClick={() => act("/pin", { productId: pinned ? null : p.id })}>
                      {pinned ? "Pinned" : "Pin"}
                    </button>
                    <button className="btn-ghost" onClick={() => act(`/products/${p.id}`, { hidden: !hidden }, "PATCH")}>
                      {hidden ? "Show" : "Hide"}
                    </button>
                    <button className="text-xs text-muted hover:text-live" onClick={() => act(`/products/${p.id}`, undefined, "DELETE")}>
                      Remove
                    </button>
                  </div>
                );
              })}
              {!s.products.length && <p className="py-4 text-sm text-muted">No products yet. Publish a scanned item and it's added here automatically.</p>}
            </div>
          </div>

          <div className="panel flex h-96 flex-col">
            <div className="border-b border-line p-3 text-sm font-semibold">Chat</div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
              {chat.map((m) => (
                <div key={m.id} className="group flex items-start gap-2">
                  <div className="flex-1">
                    <b className={m.isAi ? "text-ai" : ""}>{m.isAi ? "AI assistant" : m.user?.displayName}</b> {m.body}
                    {m.audioUrl && (
                      <button className="ml-1 text-xs text-ai" title="Play what the AI said" onClick={() => new Audio(m.audioUrl).play().catch(() => {})}>
                        🔊
                      </button>
                    )}
                  </div>
                  {!m.isAi && aiOn && canSpeak && (
                    <button className="hidden text-xs text-ai group-hover:block" onClick={() => aiReply(m.id)}>
                      {voiceReplies && hasVoice ? "AI voice reply" : "AI reply"}
                    </button>
                  )}
                  {m.isAi && !m.audioUrl && hasVoice && canSpeak && s.status === "LIVE" && (
                    <button className="hidden text-xs text-ai group-hover:block" disabled={speaking} onClick={() => speak({ messageId: m.id })}>
                      Say it
                    </button>
                  )}
                  <button className="hidden text-xs text-muted group-hover:block" onClick={() => act(`/chat/${m.id}/hide`)}>
                    Hide
                  </button>
                </div>
              ))}
              {!chat.length && <div className="text-muted">Chat is quiet.</div>}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="panel space-y-3 border-ai/40 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-ai">AI assistant</h2>
              <span className={`chip ${!aiOn ? "bg-line" : s.aiPaused ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok"}`}>{!aiOn ? "off" : s.aiPaused ? "paused" : listening ? "listening" : "ready"}</span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-xs">
              {(["HUMAN", "HUMAN_AI_COHOST", "AI_HOST"] as const).map((m) => (
                <button key={m} className={`rounded-lg border px-2 py-1.5 ${s.mode === m ? "border-ai bg-ai/10 font-semibold" : "border-line"}`} onClick={() => act("/ai", { mode: m }, "PATCH")}>
                  {m === "HUMAN" ? "Human" : m === "AI_HOST" ? "AI host" : "Co-host"}
                </button>
              ))}
            </div>
            {aiOn && (
              <>
                <label className="flex items-center justify-between text-sm">
                  AI may reply in public chat
                  <input type="checkbox" checked={s.aiPublicSpeech} onChange={(e) => act("/ai", { aiPublicSpeech: e.target.checked }, "PATCH")} />
                </label>
                <div className="flex gap-2">
                  <button className="btn-ghost flex-1" onClick={() => act("/ai", { aiPaused: !s.aiPaused }, "PATCH")}>
                    {s.aiPaused ? "Resume AI" : "Pause AI"}
                  </button>
                  {s.mode === "HUMAN_AI_COHOST" ? (
                    <button className="btn-ghost flex-1" onClick={() => act("/ai", { cohostMode: s.cohostMode === "TAKEOVER" ? "SILENT" : "TAKEOVER" }, "PATCH")}>
                      {s.cohostMode === "TAKEOVER" ? "Take back control" : "Hand over to AI"}
                    </button>
                  ) : null}
                </div>
                {s.cohostMode === "TAKEOVER" && <p className="text-xs text-warn">Takeover is recorded. The AI answers chat and, with a voice, speaks its answers. It doesn't present products on its own yet.</p>}
                {canSpeak && (
                  <div className="space-y-2 rounded-xl border border-ai/30 p-3">
                    <div className="flex items-center justify-between text-sm font-medium">
                      AI voice
                      {s.aiAgent && !hasVoice && (
                        <a href="/seller/ai-agents" className="text-xs font-normal text-ai underline">
                          Give {s.aiAgent.name} a voice
                        </a>
                      )}
                    </div>
                    {hasVoice ? (
                      <>
                        <label className="flex items-center justify-between text-sm">
                          Speak AI replies out loud
                          <input type="checkbox" checked={voiceReplies} onChange={(e) => setVoiceReplies(e.target.checked)} />
                        </label>
                        <form
                          className="flex gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (say.trim()) speak({ text: say.trim() });
                          }}
                        >
                          <input className="input" placeholder="Have the AI say…" value={say} onChange={(e) => setSay(e.target.value)} maxLength={1200} disabled={s.status !== "LIVE"} />
                          <button className="btn-ai" disabled={speaking || s.status !== "LIVE"}>
                            {speaking ? "…" : "Say"}
                          </button>
                        </form>
                        <p className="text-[11px] text-muted">Speech uses AI credits (by length) and plays for viewers who have sound on. It's labelled as AI.</p>
                      </>
                    ) : (
                      <p className="text-xs text-muted">{s.aiAgent ? "This AI salesperson has no voice yet, so it answers in text." : "Assign an AI salesperson with a voice to have the AI speak."}</p>
                    )}
                  </div>
                )}
                <button className={listening ? "btn-ai w-full" : "btn-ghost w-full"} onClick={toggleListening}>
                  {listening ? "🎙 Listening — say “AI, …”" : "🎙 Listen to my mic"}
                </button>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (q.trim()) ask(q.trim());
                  }}
                >
                  <input className="input" placeholder="Ask privately: what sizes are left?" value={q} onChange={(e) => setQ(e.target.value)} />
                  <button className="btn-ai" disabled={asking}>
                    Ask
                  </button>
                </form>
                <div className="flex flex-wrap gap-1">
                  {["Summarize the questions in chat", "What should I show next?", "What's the current inventory?", "Three reasons someone might like this"].map((x) => (
                    <button key={x} className="chip bg-ai/10 normal-case text-ai" onClick={() => ask(x)} disabled={asking}>
                      {x}
                    </button>
                  ))}
                </div>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {answers.map((a, i) => (
                    <div key={i} className="rounded-xl bg-ai/10 p-2 text-sm">
                      <div className="text-xs text-muted">{a.q}</div>
                      <div className="whitespace-pre-line">{a.a}</div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted">The AI only uses your real catalog, stock and policies. It can't change prices, give discounts or issue refunds.</p>
              </>
            )}
          </div>
          <div className="panel p-4">
            <h3 className="mb-2 text-sm font-semibold">AI activity log</h3>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
              {log.data?.map((e) => (
                <li key={e.id}>
                  <span className="text-muted">{new Date(e.createdAt).toLocaleTimeString()} · {e.speaker}/{e.kind}:</span> {e.body.slice(0, 160)}
                </li>
              ))}
              {!log.data?.length && <li className="text-muted">Nothing yet.</li>}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
