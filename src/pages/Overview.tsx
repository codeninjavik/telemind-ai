import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { ago, get, post, toast } from "@/lib/api";
import { Badge, Button, PageHeader } from "@/ui";

export default function Overview() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["stats"], queryFn: () => get("/api/dashboard/stats"), refetchInterval: 8000 });
  const sync = useMutation({
    mutationFn: () => post("/api/sync"),
    onSuccess: (r) => { toast.ok(`Checked Telegram: ${r.newIncoming} new message${r.newIncoming === 1 ? "" : "s"}.`); qc.invalidateQueries(); },
    onError: toast.err,
  });
  const s = q.data;
  const cards: [string, number | undefined, string?][] = [
    ["Messages received", s?.incoming], ["Drafts written", s?.drafts], ["Waiting for you", s?.awaiting, "text-warn"],
    ["Sent by you", s?.sentManual], ["Sent automatically", s?.sentAuto, "text-violet"], ["Skipped", s?.skipped], ["AI errors", s?.aiFailed, s?.aiFailed ? "text-bad" : ""],
  ];
  const steps = [
    { ok: s?.telegram === "connected", text: "Connect your Telegram account", to: "/telegram" },
    { ok: s?.aiConfigured, text: "Add your Groq API key (GROQ_API_KEY in Netlify)", to: "/settings" },
    { ok: s?.running, text: "Start the assistant", to: "/" },
  ];
  return (
    <>
      <PageHeader title="Overview" sub="The last 30 days of activity in your personal Telegram chats."
        actions={<Button busy={sync.isPending} disabled={s?.telegram !== "connected"} onClick={() => sync.mutate()}><RefreshCw className="h-4 w-4" />Check for new messages</Button>} />
      {s?.lastError && (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-bad/50 bg-bad/10 p-3 text-sm text-bad"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Last problem: {s.lastError}</p>
      )}
      {(!s || steps.some((x) => !x.ok)) && (
        <section className="card mb-6 p-5">
          <h2 className="mb-3 text-lg font-semibold">Get started</h2>
          <ul className="space-y-2">
            {steps.map((x) => (
              <li key={x.text} className="flex items-center gap-3">
                {x.ok ? <CheckCircle2 className="h-5 w-5 text-ok" /> : <Circle className="h-5 w-5 text-mute" />}
                {x.ok ? <span className="text-mute line-through">{x.text}</span> : <Link to={x.to} className="font-medium hover:text-violet">{x.text}</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([label, n, tone]) => (
          <div key={label} className="card p-4">
            <p className={`font-display text-3xl font-bold ${tone ?? ""}`}>{n ?? "–"}</p>
            <p className="mt-1 text-sm text-mute">{label}</p>
          </div>
        ))}
      </div>
      <section className="card mt-6 grid gap-4 p-5 sm:grid-cols-3">
        <div><p className="text-sm text-mute">Telegram</p><Badge tone={s?.telegram === "connected" ? "ok" : "warn"}>{s?.telegram ?? "…"}</Badge></div>
        <div><p className="text-sm text-mute">Reply mode</p><Badge tone={s?.mode === "auto" ? "bad" : "violet"}>{s?.mode === "auto" ? "Automatic" : s?.mode === "draft" ? "AI drafts" : "Manual"}</Badge></div>
        <div><p className="text-sm text-mute">Last check</p><p className="font-medium">{ago(s?.lastPollAt)}</p></div>
      </section>
      <p className="mt-4 text-sm text-mute">On Netlify the assistant looks for new messages once a minute while it is running.</p>
    </>
  );
}
