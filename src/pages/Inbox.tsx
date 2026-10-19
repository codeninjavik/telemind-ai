import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Bot, CheckCheck, Inbox as InboxIcon, PauseCircle, Send, Sparkles, SkipForward, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { ago, get, patch, post, toast } from "@/lib/api";
import { Badge, Button, Empty, PageHeader, cx } from "@/ui";
import type { Conv, Contact, Msg } from "@server/types";

type ConvRow = { peerId: number; title: string; username: string | null; lastAt: string | null; preview: string; paused: boolean; blocked: boolean; allowlisted: boolean; pending: number; needsAttention: number };
type ConvFull = Conv & { contact: Contact | null };

const statusTone = (s?: string) => (s === "replied" ? "ok" : s === "pending_approval" ? "warn" : s === "failed" ? "bad" : "mute") as "ok" | "warn" | "bad" | "mute";
const statusLabel: Record<string, string> = { received: "New", pending_approval: "Needs approval", replied: "Replied", skipped: "Skipped", failed: "Failed" };

export default function Inbox() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["convs"], queryFn: () => get<ConvRow[]>("/api/conversations"), refetchInterval: 10000 });
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { if (sel === null && list.data?.length) setSel(list.data[0].peerId); }, [list.data, sel]);
  const conv = useQuery({ queryKey: ["conv", sel], queryFn: () => get<ConvFull>(`/api/conversations/${sel}`), enabled: sel !== null, refetchInterval: 10000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["convs"] }); qc.invalidateQueries({ queryKey: ["conv"] }); qc.invalidateQueries({ queryKey: ["stats"] }); };

  const target = conv.data?.messages.filter((m) => m.dir === "in" && m.status !== "replied").slice(-1)[0] ?? null;
  const togglePause = useMutation({ mutationFn: (paused: boolean) => patch(`/api/conversations/${sel}`, { paused }), onSuccess: refresh, onError: toast.err });
  const contactPatch = useMutation({ mutationFn: (b: object) => patch(`/api/contacts/${sel}`, b), onSuccess: refresh, onError: toast.err });

  return (
    <>
      <PageHeader title="Inbox" sub="Private chats from your Telegram account. Groups, channels and bots are left out." />
      {!list.data?.length ? (
        <div className="card"><Empty icon={<InboxIcon className="h-8 w-8" />} title="No conversations yet">Connect Telegram, then use “Check for new messages” on the Overview page. Chats appear here once they have text messages.</Empty></div>
      ) : (
        <div className="grid gap-4 lg:h-[calc(100dvh-230px)] lg:grid-cols-[280px_1fr_300px]">
          <section className="card overflow-y-auto" aria-label="Conversations">
            {list.data.map((c) => (
              <button key={c.peerId} onClick={() => setSel(c.peerId)} className={cx("flex w-full flex-col gap-0.5 border-b border-line px-4 py-3 text-left transition hover:bg-raised", sel === c.peerId && "bg-violet/10")}>
                <span className="flex items-center justify-between gap-2"><b className="truncate">{c.title}</b><span className="shrink-0 text-xs text-mute">{ago(c.lastAt)}</span></span>
                <span className="truncate text-sm text-mute">{c.preview}</span>
                <span className="mt-1 flex gap-1.5">
                  {c.needsAttention > 0 && <Badge tone="warn">{c.needsAttention} to review</Badge>}
                  {c.paused && <Badge>Paused</Badge>}{c.blocked && <Badge tone="bad">Blocked</Badge>}{c.allowlisted && <Badge tone="violet">Allowlisted</Badge>}
                </span>
              </button>
            ))}
          </section>

          <section className="card flex min-h-[380px] flex-col" aria-label="Messages">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {conv.data?.messages.map((m) => <Bubble key={`${m.dir}${m.id}`} m={m} />)}
            </div>
          </section>

          <section className="card overflow-y-auto p-4" aria-label="Reply and contact">
            {conv.data && (
              <>
                <h2 className="text-lg font-semibold">{conv.data.title}</h2>
                {conv.data.username && <p className="text-sm text-mute">@{conv.data.username}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button className="!min-h-[34px] !px-3" onClick={() => togglePause.mutate(!conv.data!.paused)}><PauseCircle className="h-4 w-4" />{conv.data.paused ? "Resume" : "Pause"}</Button>
                  <Button className="!min-h-[34px] !px-3" onClick={() => contactPatch.mutate({ allowlisted: !conv.data!.contact?.allowlisted })}><Star className="h-4 w-4" />{conv.data.contact?.allowlisted ? "Remove from allowlist" : "Allowlist"}</Button>
                  <Button danger className="!min-h-[34px] !px-3" onClick={() => contactPatch.mutate({ blocked: !conv.data!.contact?.blocked })}><Ban className="h-4 w-4" />{conv.data.contact?.blocked ? "Unblock" : "Block"}</Button>
                </div>
                <hr className="my-4 border-line" />
                {target ? <ReplyPanel key={`${sel}-${target.id}`} peer={sel!} msg={target} onDone={refresh} /> : <p className="text-sm text-mute">Nothing waiting for a reply.</p>}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Bubble({ m }: { m: Msg }) {
  const mine = m.dir === "out";
  return (
    <div className={cx("flex", mine && "justify-end")}>
      <div className={cx("max-w-[82%] rounded-2xl px-3.5 py-2", mine ? "rounded-br-md text-white" : "rounded-bl-md bg-raised")} style={mine ? { background: "linear-gradient(135deg, rgb(var(--violet)), rgb(var(--blue)))" } : undefined}>
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
        <p className={cx("mt-1 flex items-center gap-1.5 text-[11px]", mine ? "text-white/75" : "text-mute")}>
          {new Date(m.at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
          {mine && m.auto && <><Bot className="h-3 w-3" />auto</>}
          {mine && !m.auto && <CheckCheck className="h-3 w-3" />}
          {!mine && m.status && <Badge tone={statusTone(m.status)}>{statusLabel[m.status]}</Badge>}
        </p>
        {!mine && m.reason && m.status !== "replied" && <p className="mt-1 text-[11px] text-mute">{m.reason}</p>}
      </div>
    </div>
  );
}

function ReplyPanel({ peer, msg, onDone }: { peer: number; msg: Msg; onDone: () => void }) {
  const [text, setText] = useState(msg.draft?.text ?? "");
  const [tone, setTone] = useState("");
  const gen = useMutation({
    mutationFn: () => post(`/api/messages/${peer}/${msg.id}/generate-draft`, tone ? { tone } : {}),
    onSuccess: (d) => { setText(d.text); onDone(); },
    onError: (e) => { toast.err(e); onDone(); },
  });
  const send = useMutation({ mutationFn: () => post(`/api/messages/${peer}/${msg.id}/approve`, { text }), onSuccess: () => { toast.ok("Reply sent."); onDone(); }, onError: (e) => { toast.err(e); onDone(); } });
  const skip = useMutation({ mutationFn: () => post(`/api/messages/${peer}/${msg.id}/skip`), onSuccess: () => { toast.ok("Skipped."); onDone(); }, onError: toast.err });
  const d = msg.draft;
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Reply to: <span className="font-normal text-mute">“{msg.text.slice(0, 80)}{msg.text.length > 80 ? "…" : ""}”</span></p>
      {d?.needsReview && <p className="flex items-start gap-2 rounded-xl border border-warn/50 bg-warn/10 p-2.5 text-xs text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Check this one before sending: {d.reviewReason}</p>}
      {msg.status === "failed" && msg.reason && <p className="text-xs text-bad">{msg.reason}</p>}
      <div className="flex gap-2">
        <select aria-label="Tone" className="input !w-auto" value={tone} onChange={(e) => setTone(e.target.value)}>
          <option value="">Default tone</option><option value="friendly">Friendly</option><option value="casual">Casual</option><option value="professional">Professional</option>
        </select>
        <Button busy={gen.isPending} onClick={() => gen.mutate()}><Sparkles className="h-4 w-4" />{d ? "Regenerate" : "Write draft"}</Button>
      </div>
      <textarea aria-label="Reply text" className="input min-h-[130px]" placeholder="Write a reply, or let the AI draft one." value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      <div className="flex gap-2">
        <Button primary busy={send.isPending} disabled={!text.trim()} onClick={() => send.mutate()}><Send className="h-4 w-4" />Send</Button>
        <Button busy={skip.isPending} onClick={() => skip.mutate()}><SkipForward className="h-4 w-4" />Skip</Button>
      </div>
      {d && <p className="text-xs text-mute">Draft by {d.model} in {d.ms} ms</p>}
    </div>
  );
}
