import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { get, patch, post, toast } from "@/lib/api";
import { Badge, Button, Field, Modal, PageHeader, Switch } from "@/ui";
import type { Settings } from "@server/types";

interface Out { settings: Settings; autoConfirmed: boolean; ai: { configured: boolean; keyHint: string | null }; telegram: { configured: boolean } }

export default function SettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => get<Out>("/api/settings") });
  const models = useQuery({ queryKey: ["models"], queryFn: () => get<{ models: string[] }>("/api/ai/models"), enabled: !!q.data?.ai.configured, retry: false });
  const [f, setF] = useState<Settings | null>(null);
  const [warn, setWarn] = useState(false);
  const [base, setBase] = useState<Settings | null>(null);
  // Follow the server (for example a switch changed on the Contacts page) unless there are unsaved edits here.
  useEffect(() => {
    if (!q.data) return;
    if (!f || !base || JSON.stringify(f) === JSON.stringify(base)) setF(q.data.settings);
    setBase(q.data.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  const save = useMutation({
    mutationFn: (b: object) => patch<Out>("/api/settings", b),
    onSuccess: (r) => { toast.ok("Settings saved."); setF(r.settings); qc.invalidateQueries(); },
    onError: toast.err,
  });
  const test = useMutation({ mutationFn: () => post("/api/ai/test"), onError: toast.err });
  if (!f || !q.data) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF({ ...f, [k]: v });
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);
  // only the fields changed on this page are sent, so a stale form can never undo a switch flipped elsewhere
  const rest = Object.fromEntries(Object.entries(f).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((q.data.settings as unknown as Record<string, unknown>)[k])));
  const submit = () => (f.mode === "auto" && q.data.settings.mode !== "auto" ? setWarn(true) : save.mutate(rest));
  const modelList = models.data?.models ?? [];

  return (
    <>
      <PageHeader title="Settings" sub="How the assistant talks and when it is allowed to send." actions={<Button primary busy={save.isPending} onClick={submit}>Save settings</Button>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-4 p-5">
          <h2 className="text-lg font-semibold">Reply mode</h2>
          {([["manual", "Manual", "You write every reply. The AI is never called."], ["draft", "AI draft", "The AI writes a draft and you approve each one."], ["auto", "Automatic", "The AI sends replies on its own to allowed contacts."]] as const).map(([v, t, d]) => (
            <label key={v} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${f.mode === v ? (v === "auto" ? "border-bad/70 bg-bad/10" : "border-violet bg-violet/10") : "border-line"}`}>
              <input type="radio" name="mode" className="mt-1" checked={f.mode === v} onChange={() => set("mode", v)} />
              <span><b>{t}</b> {v === "auto" && <Badge tone="bad">Sends from your account</Badge>}<span className="block text-sm text-mute">{d}</span></span>
            </label>
          ))}
          {f.mode === "auto" && (
            <div className="space-y-3 border-t border-line pt-4">
              <fieldset>
                <legend className="label">Who gets automatic replies</legend>
                {([[true, "Only allowlisted contacts", "People you switch on in Contacts."], [false, "Everyone", "Every private chat. Same as “Auto-reply to everyone” on the Contacts page."]] as const).map(([v, t, d]) => (
                  <label key={String(v)} className={`mb-2 flex cursor-pointer gap-3 rounded-xl border p-3 ${f.autoAllowlistOnly === v ? "border-violet bg-violet/10" : "border-line"}`}>
                    <input type="radio" name="who" className="mt-1" checked={f.autoAllowlistOnly === v} onChange={() => set("autoAllowlistOnly", v)} />
                    <span><b>{t}</b><span className="block text-sm text-mute">{d}</span></span>
                  </label>
                ))}
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Daily limit">{(id) => <input id={id} type="number" min={0} max={1000} className="input" value={f.dailyLimit} onChange={num("dailyLimit")} />}</Field>
                <Field label="Cooldown per contact (seconds)">{(id) => <input id={id} type="number" min={0} className="input" value={f.cooldownSeconds} onChange={num("cooldownSeconds")} />}</Field>
              </div>
            </div>
          )}
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound className="h-5 w-5 text-violet" />AI provider (Groq)</h2>
          <p className="text-sm text-mute">The API key lives only in the server environment (GROQ_API_KEY) and never reaches this page.</p>
          <p>{q.data.ai.configured ? <Badge tone="ok">Key set {q.data.ai.keyHint}</Badge> : <Badge tone="warn">No key yet</Badge>}</p>
          <Field label="Model" hint="Pick from the list or type a model id.">
            {(id) => (<><input id={id} list="models" className="input" value={f.model} onChange={(e) => set("model", e.target.value)} /><datalist id="models">{modelList.map((m) => <option key={m} value={m} />)}</datalist></>)}
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Creativity">{(id) => <input id={id} type="number" step="0.1" min={0} max={1.5} className="input" value={f.temperature} onChange={num("temperature")} />}</Field>
            <Field label="Max tokens">{(id) => <input id={id} type="number" min={32} max={1024} className="input" value={f.maxTokens} onChange={num("maxTokens")} />}</Field>
            <Field label="Max characters">{(id) => <input id={id} type="number" min={40} max={4000} className="input" value={f.maxChars} onChange={num("maxChars")} />}</Field>
          </div>
          <div className="flex items-center gap-3">
            <Button busy={test.isPending} disabled={!q.data.ai.configured} onClick={() => test.mutate()}>Test the connection</Button>
            {test.data && (test.data.ok ? <span className="flex items-center gap-1.5 text-sm text-ok"><CheckCircle2 className="h-4 w-4" />Works · {test.data.latencyMs} ms</span> : <span className="text-sm text-bad">{test.data.message}</span>)}
          </div>
        </section>

        <section className="card space-y-4 p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold">Personality</h2>
          <Field label="Instructions for the assistant" hint="Describe how you talk and what it may or may not promise.">{(id) => <textarea id={id} className="input min-h-[120px]" maxLength={4000} value={f.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />}</Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Language">{(id) => <select id={id} className="input" value={f.language} onChange={(e) => set("language", e.target.value as Settings["language"])}><option value="auto">Match the sender</option><option value="english">English</option><option value="hindi">Hindi</option><option value="hinglish">Hinglish</option></select>}</Field>
            <Field label="Tone">{(id) => <select id={id} className="input" value={f.tone} onChange={(e) => set("tone", e.target.value as Settings["tone"])}><option value="friendly">Friendly</option><option value="casual">Casual</option><option value="professional">Professional</option></select>}</Field>
            <Field label="Earlier messages used as context">{(id) => <input id={id} type="number" min={0} max={30} className="input" value={f.historyLimit} onChange={num("historyLimit")} />}</Field>
          </div>
        </section>

        <section className="card space-y-4 p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold">Your business</h2>
          <p className="text-sm text-mute">The assistant states product details, prices, steps and policies only from this section. Anything you leave out, it will not make up: it says it will check, or sends the person to a link.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business or brand name">{(id) => <input id={id} className="input" maxLength={80} value={f.business.name} onChange={(e) => set("business", { ...f.business, name: e.target.value })} />}</Field>
            <Field label="What you do (short)">{(id) => <textarea id={id} className="input min-h-[40px]" maxLength={1500} value={f.business.about} onChange={(e) => set("business", { ...f.business, about: e.target.value })} />}</Field>
          </div>
          <Field label="Facts the assistant may say" hint="One fact per line: products, prices, how to buy, install steps, refund rules, support hours.">
            {(id) => <textarea id={id} className="input min-h-[220px]" value={f.business.facts.join("\n")} onChange={(e) => set("business", { ...f.business, facts: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />}
          </Field>
          <div>
            <p className="label">Links it may share</p>
            <p className="hint mb-2">Add your download page, buy page and setup video link here. Only links from this list are ever shared.</p>
            <div className="space-y-2">
              {f.business.links.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <input aria-label="Link label" className="input !w-40 shrink-0" placeholder="Label" maxLength={60} value={l.label} onChange={(e) => set("business", { ...f.business, links: f.business.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <input aria-label="Link address" className="input" placeholder="https://" value={l.url} onChange={(e) => set("business", { ...f.business, links: f.business.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                  <button type="button" aria-label="Remove link" className="rounded-lg px-3 text-mute hover:text-bad" onClick={() => set("business", { ...f.business, links: f.business.links.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
            </div>
            <Button className="mt-2" onClick={() => set("business", { ...f.business, links: [...f.business.links, { label: "Setup video", url: "https://" }] })}>Add a link</Button>
          </div>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="text-lg font-semibold">Quiet hours and time zone</h2>
          <div className="flex items-center justify-between"><span>No automatic replies during quiet hours</span><Switch label="Quiet hours" checked={f.quietHours.enabled} onChange={(v) => set("quietHours", { ...f.quietHours, enabled: v })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">{(id) => <input id={id} type="time" className="input" value={f.quietHours.start} onChange={(e) => set("quietHours", { ...f.quietHours, start: e.target.value })} />}</Field>
            <Field label="Until">{(id) => <input id={id} type="time" className="input" value={f.quietHours.end} onChange={(e) => set("quietHours", { ...f.quietHours, end: e.target.value })} />}</Field>
          </div>
          <Field label="Time zone" hint="For example Asia/Kolkata.">{(id) => <input id={id} className="input" value={f.timezone} onChange={(e) => set("timezone", e.target.value)} />}</Field>
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="text-lg font-semibold">Privacy</h2>
          <Field label="Hold back messages that mention…" hint="Comma separated. The assistant never answers these on its own.">{(id) => <textarea id={id} className="input min-h-[90px]" value={f.sensitiveTerms.join(", ")} onChange={(e) => set("sensitiveTerms", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />}</Field>
          <Field label="Keep history for (days, 0 = until I delete it)">{(id) => <input id={id} type="number" min={0} max={3650} className="input" value={f.retentionDays} onChange={num("retentionDays")} />}</Field>
        </section>
      </div>

      <Modal open={warn} onClose={() => setWarn(false)} title="Turn on automatic replies?">
        <div className="space-y-3">
          <p className="flex gap-2 rounded-xl border border-bad/50 bg-bad/10 p-3 text-sm text-bad"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />The assistant will send messages from your personal Telegram account without asking you first. Contacts will believe the replies are from you.</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-mute">
            <li>It only answers allowlisted contacts while that option is on.</li>
            <li>Sensitive, unclear or suspicious messages are held for your review.</li>
            <li>A red bar stays on screen while it is active; “Emergency stop” turns it off at once.</li>
          </ul>
          <div className="flex justify-end gap-2 pt-2"><Button onClick={() => setWarn(false)}>Cancel</Button><Button danger busy={save.isPending} onClick={() => { setWarn(false); save.mutate({ ...rest, confirmAuto: true }); }}>I understand, turn it on</Button></div>
        </div>
      </Modal>
    </>
  );
}
