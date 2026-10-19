import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { del, get, patch, post, toast } from "@/lib/api";
import { Badge, Button, Empty, Field, Modal, PageHeader, Switch } from "@/ui";
import type { Rule } from "@server/types";

const TYPES = [
  { v: "skip_keywords", label: "Never answer messages containing…", help: "The assistant skips the message and records why." },
  { v: "approval_keywords", label: "Always ask me when a message contains…", help: "A draft is written, but it is never sent automatically." },
  { v: "approved_contacts_only", label: "Automatic replies only for allowlisted contacts", help: "Everyone else still gets a draft for approval." },
  { v: "quiet_hours", label: "Quiet hours (no automatic replies)", help: "Uses the time zone from Settings." },
  { v: "daily_limit", label: "Daily limit of automatic replies", help: "The lowest limit between this rule and Settings applies." },
  { v: "faq", label: "Approved answers", help: "Facts the AI may rely on, such as opening hours or a fixed price." },
  { v: "tone", label: "Tone for every reply", help: "Overrides the default tone unless a contact has its own." },
] as const;

const summary = (r: Rule) => {
  const c: any = r.config;
  if (c.keywords) return c.keywords.join(", ");
  if (c.answers) return `${c.answers.length} answer${c.answers.length === 1 ? "" : "s"}`;
  if (c.start) return `${c.start} to ${c.end}`;
  if (c.limit !== undefined) return `${c.limit} per day`;
  if (c.tone) return c.tone;
  return "";
};

export default function Rules() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["rules"], queryFn: () => get<Rule[]>("/api/rules") });
  const [open, setOpen] = useState(false);
  const inv = () => qc.invalidateQueries({ queryKey: ["rules"] });
  const toggle = useMutation({ mutationFn: (r: { id: string; enabled: boolean }) => patch(`/api/rules/${r.id}`, { enabled: r.enabled }), onSuccess: inv, onError: toast.err });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/rules/${id}`), onSuccess: inv, onError: toast.err });
  return (
    <>
      <PageHeader title="Automation rules" sub="Rules decide when the assistant stays quiet, asks you first, or may answer on its own." actions={<Button primary onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New rule</Button>} />
      <div className="card divide-y divide-line">
        {!q.data?.length ? <Empty icon={<SlidersHorizontal className="h-8 w-8" />} title="No rules yet">Without rules the assistant uses your Settings only. Sensitive messages such as one-time codes and card numbers are always held back.</Empty> :
          q.data.map((r) => (
            <div key={r.id} className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1"><p className="font-semibold">{r.name} <Badge tone="violet">{TYPES.find((t) => t.v === r.type)?.label.split("…")[0]}</Badge></p><p className="truncate text-sm text-mute">{summary(r)}</p></div>
              <Switch label={`Enable ${r.name}`} checked={r.enabled} onChange={(v) => toggle.mutate({ id: r.id, enabled: v })} />
              <button aria-label={`Delete ${r.name}`} className="rounded-lg p-2 text-mute hover:text-bad" onClick={() => remove.mutate(r.id)}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
      </div>
      <NewRule open={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); inv(); }} />
    </>
  );
}

function NewRule({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<string>("skip_keywords");
  const [name, setName] = useState("");
  const [list, setList] = useState("");
  const [start, setStart] = useState("22:00");
  const [end, setEnd] = useState("08:00");
  const [limit, setLimit] = useState(10);
  const [tone, setTone] = useState("friendly");
  const t = TYPES.find((x) => x.v === type)!;
  const split = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter(Boolean);
  const config = () => {
    if (type === "skip_keywords" || type === "approval_keywords") return { keywords: split(list, /[,\n]/) };
    if (type === "faq") return { answers: split(list, /\n/) };
    if (type === "quiet_hours") return { start, end };
    if (type === "daily_limit") return { limit };
    if (type === "tone") return { tone };
    return {};
  };
  const save = useMutation({ mutationFn: () => post("/api/rules", { name: name || t.label.split("…")[0], type, config: config(), enabled: true }), onSuccess: () => { toast.ok("Rule saved."); setList(""); setName(""); onSaved(); }, onError: toast.err });
  return (
    <Modal open={open} onClose={onClose} title="New rule">
      <div className="space-y-4">
        <Field label="Rule type" hint={t.help}>{(id) => <select id={id} className="input" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select>}</Field>
        <Field label="Name (optional)">{(id) => <input id={id} className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        {(type === "skip_keywords" || type === "approval_keywords") && <Field label="Words or phrases" hint="Separate with commas or new lines.">{(id) => <textarea id={id} className="input min-h-[80px]" value={list} onChange={(e) => setList(e.target.value)} />}</Field>}
        {type === "faq" && <Field label="Answers, one per line" hint="Example: We are open 10am to 7pm, Monday to Saturday.">{(id) => <textarea id={id} className="input min-h-[110px]" value={list} onChange={(e) => setList(e.target.value)} />}</Field>}
        {type === "quiet_hours" && <div className="grid grid-cols-2 gap-3"><Field label="From">{(id) => <input id={id} type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />}</Field><Field label="Until">{(id) => <input id={id} type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field></div>}
        {type === "daily_limit" && <Field label="Replies per day">{(id) => <input id={id} type="number" min={0} max={1000} className="input" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />}</Field>}
        {type === "tone" && <Field label="Tone">{(id) => <select id={id} className="input" value={tone} onChange={(e) => setTone(e.target.value)}><option value="friendly">Friendly</option><option value="casual">Casual</option><option value="professional">Professional</option></select>}</Field>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary busy={save.isPending} onClick={() => save.mutate()}>Save rule</Button></div>
      </div>
    </Modal>
  );
}
