import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { useState } from "react";
import { ago, get, patch, toast } from "@/lib/api";
import { Badge, Button, Empty, Field, Modal, PageHeader, Switch } from "@/ui";
import { Link } from "react-router-dom";
import type { Contact } from "@server/types";

type Row = Contact & { paused: boolean };

export default function Contacts() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["contacts"], queryFn: () => get<Row[]>("/api/contacts") });
  const [find, setFind] = useState("");
  const [edit, setEdit] = useState<Row | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const cfg = useQuery({ queryKey: ["settings"], queryFn: () => get<{ settings: { mode: string; autoAllowlistOnly: boolean } }>("/api/settings") });
  const everyone = cfg.data ? !cfg.data.settings.autoAllowlistOnly : false;
  const setEveryone = useMutation({
    mutationFn: (on: boolean) => patch("/api/settings", { autoAllowlistOnly: !on }),
    onSuccess: (_r, on) => { setConfirmAll(false); toast.ok(on ? "Automatic replies are now allowed for everyone." : "Automatic replies are limited to the contacts you allow."); qc.invalidateQueries({ queryKey: ["settings"] }); },
    onError: toast.err,
  });
  const save = useMutation({
    mutationFn: ({ id, ...b }: { id: number } & Record<string, unknown>) => patch(`/api/contacts/${id}`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts"] }),
    onError: toast.err,
  });
  const rows = (q.data ?? []).filter((c) => (c.name + (c.username ?? "")).toLowerCase().includes(find.toLowerCase()));
  return (
    <>
      <PageHeader title="Contacts" sub="Decide who the assistant may answer automatically, and how it should talk to each person." />
      <section className={`card mb-5 flex flex-wrap items-center gap-4 p-4 ${everyone ? "border-bad/60 bg-bad/10" : ""}`}>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold">Auto-reply to everyone</p>
          <p className="text-sm text-mute">{everyone ? "On: every private chat can get automatic replies, no need to allow people one by one. Blocked contacts, sensitive messages, cooldown and limits still apply." : "Off: only the contacts you switch on below get automatic replies. Everyone else gets a draft for you to approve."}</p>
          {cfg.data && cfg.data.settings.mode !== "auto" && <p className="mt-1 text-sm text-warn">This only matters in Automatic mode. The current mode is “{cfg.data.settings.mode === "draft" ? "AI draft" : "Manual"}”. Change it in <Link to="/settings" className="underline">Settings</Link>.</p>}
        </div>
        <Switch label="Auto-reply to everyone" checked={everyone} disabled={!cfg.data || setEveryone.isPending} onChange={(v) => (v ? setConfirmAll(true) : setEveryone.mutate(false))} />
      </section>
      <div className="card">
        <div className="border-b border-line p-3"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-mute" /><input className="input !pl-9" placeholder="Search contacts" aria-label="Search contacts" value={find} onChange={(e) => setFind(e.target.value)} /></div></div>
        {!rows.length ? <Empty icon={<Users className="h-8 w-8" />} title="No contacts yet">People appear here after they message you.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-mute"><tr><th className="px-4 py-3 font-medium">Contact</th><th className="px-3 font-medium">Last message</th><th className="px-3 font-medium">Auto-reply allowed</th><th className="px-3 font-medium">Assistant</th><th /></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.peerId} className="border-t border-line">
                    <td className="px-4 py-3"><b>{c.name}</b>{c.username && <span className="text-mute"> @{c.username}</span>}<div className="mt-0.5 flex gap-1.5">{c.blocked && <Badge tone="bad">Blocked</Badge>}{c.paused && <Badge>Paused</Badge>}</div></td>
                    <td className="px-3 text-mute">{ago(c.lastInteraction)}</td>
                    <td className="px-3"><Switch label={`Allow automatic replies to ${c.name}`} checked={everyone || c.allowlisted} disabled={everyone} onChange={(v) => save.mutate({ id: c.peerId, allowlisted: v })} /></td>
                    <td className="px-3"><Switch label={`Assistant on for ${c.name}`} checked={c.automation} onChange={(v) => save.mutate({ id: c.peerId, automation: v })} /></td>
                    <td className="px-3 text-right"><Button className="!min-h-[34px]" onClick={() => setEdit(c)}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Modal open={confirmAll} onClose={() => setConfirmAll(false)} title="Auto-reply to everyone?">
        <p className="text-mute">In Automatic mode the assistant will answer <b>anyone</b> who writes to you privately, including people you do not know, as if it were you.</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mute"><li>Blocked contacts and paused chats are still skipped.</li><li>Sensitive, suspicious or unclear messages are still held for you.</li><li>Cooldown, daily limit and quiet hours still apply.</li></ul>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirmAll(false)}>Cancel</Button><Button danger busy={setEveryone.isPending} onClick={() => setEveryone.mutate(true)}>Turn on for everyone</Button></div>
      </Modal>
      {edit && <EditModal c={edit} onClose={() => setEdit(null)} onSave={(b) => { save.mutate({ id: edit.peerId, ...b }); setEdit(null); }} />}
    </>
  );
}

function EditModal({ c, onClose, onSave }: { c: Row; onClose: () => void; onSave: (b: object) => void }) {
  const [language, setLanguage] = useState(c.language ?? "");
  const [tone, setTone] = useState(c.tone ?? "");
  const [instructions, setInstructions] = useState(c.instructions);
  const [notes, setNotes] = useState(c.notes);
  return (
    <Modal open onClose={onClose} title={c.name}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reply language">{(id) => <select id={id} className="input" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="">Default</option><option value="english">English</option><option value="hindi">Hindi</option><option value="hinglish">Hinglish</option></select>}</Field>
          <Field label="Tone">{(id) => <select id={id} className="input" value={tone} onChange={(e) => setTone(e.target.value)}><option value="">Default</option><option value="friendly">Friendly</option><option value="casual">Casual</option><option value="professional">Professional</option></select>}</Field>
        </div>
        <Field label="Instructions for the AI" hint="For example: “This is my manager. Be formal and brief.”">{(id) => <textarea id={id} className="input min-h-[80px]" maxLength={1500} value={instructions} onChange={(e) => setInstructions(e.target.value)} />}</Field>
        <Field label="Private notes" hint="Only you see these.">{(id) => <textarea id={id} className="input min-h-[70px]" maxLength={3000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button primary onClick={() => onSave({ language: language || null, tone: tone || null, instructions, notes })}>Save changes</Button></div>
      </div>
    </Modal>
  );
}
