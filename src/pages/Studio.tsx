import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Copy, Sparkles } from "lucide-react";
import { useState } from "react";
import { post, toast } from "@/lib/api";
import { Button, Field, PageHeader } from "@/ui";

const SAMPLES = ["Hey, are you free for a call tomorrow evening?", "What's the price for this?", "Bhai kal kitne baje milna hai?", "Can you send me your bank account number?"];

export default function Studio() {
  const [sample, setSample] = useState(SAMPLES[0]);
  const [name, setName] = useState("Asha");
  const [tone, setTone] = useState("");
  const run = useMutation({ mutationFn: () => post("/api/studio", { sample, contactName: name, ...(tone ? { tone } : {}) }), onError: toast.err });
  const r = run.data;
  return (
    <>
      <PageHeader title="Reply Studio" sub="Try your assistant on a made-up message. Nothing is sent and no real chat is touched." />
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-4 p-5">
          <Field label="Sample message from a contact">{(id) => <textarea id={id} className="input min-h-[120px]" value={sample} onChange={(e) => setSample(e.target.value)} maxLength={1000} />}</Field>
          <div className="flex flex-wrap gap-2">{SAMPLES.map((s) => <button key={s} onClick={() => setSample(s)} className="rounded-full border border-line px-3 py-1 text-xs text-mute hover:border-violet hover:text-ink">{s.slice(0, 28)}…</button>)}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact name">{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />}</Field>
            <Field label="Tone">{(id) => <select id={id} className="input" value={tone} onChange={(e) => setTone(e.target.value)}><option value="">Use my default</option><option value="friendly">Friendly</option><option value="casual">Casual</option><option value="professional">Professional</option></select>}</Field>
          </div>
          <Button primary busy={run.isPending} disabled={!sample.trim()} onClick={() => run.mutate()}><Sparkles className="h-4 w-4" />Generate reply</Button>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Draft</h2>
          {!r ? <p className="text-mute">Your generated reply shows up here. Change the personality in Settings, then try again.</p> : (
            <div className="space-y-3">
              {r.needsReview && <p className="flex items-start gap-2 rounded-xl border border-warn/50 bg-warn/10 p-2.5 text-sm text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />The assistant would hold this for your review: {r.reviewReason}</p>}
              <p className="whitespace-pre-wrap rounded-xl bg-raised p-4">{r.text}</p>
              <div className="flex items-center justify-between text-xs text-mute"><span>{r.model} · {r.ms} ms</span><Button className="!min-h-[34px]" onClick={() => { navigator.clipboard.writeText(r.text); toast.ok("Copied."); }}><Copy className="h-4 w-4" />Copy</Button></div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
