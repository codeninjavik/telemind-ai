import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { get, post, toast } from "@/lib/api";
import { Badge, Button, Field, Modal, PageHeader } from "@/ui";

export default function Telegram() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tg"], queryFn: () => get("/api/telegram/status"), refetchInterval: 15000 });
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [revoke, setRevoke] = useState(true);
  const done = (msg?: string) => { if (msg) toast.ok(msg); qc.invalidateQueries(); };
  const request = useMutation({ mutationFn: () => post("/api/telegram/request-code", { phone: phone.replace(/[\s-]/g, "") }), onSuccess: () => done("Code sent in your Telegram app."), onError: toast.err });
  const verify = useMutation({
    mutationFn: (b: { code?: string; password?: string }) => post("/api/telegram/verify-code", b),
    onSuccess: (r) => { setCode(""); setPw(""); done(r.status === "connected" ? "Telegram connected." : undefined); },
    onError: toast.err,
  });
  const out = useMutation({ mutationFn: () => post("/api/telegram/disconnect", { revoke }), onSuccess: () => { setConfirm(false); done("Telegram disconnected."); }, onError: toast.err });
  const s = q.data;
  const tone = s?.status === "connected" ? "ok" : s?.status === "error" ? "bad" : "warn";
  return (
    <>
      <PageHeader title="Telegram connection" sub="Connect the personal account you own. TeleMind only reads and answers private chats with people." />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <section className="card p-5">
          <div className="mb-4 flex items-center gap-3"><h2 className="text-lg font-semibold">Status</h2><Badge tone={tone}>{s?.status?.replace("_", " ") ?? "…"}</Badge></div>
          {s && !s.apiConfigured && (
            <p className="mb-4 rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm text-warn">TG_API_ID and TG_API_HASH are not set on the server. Get them from my.telegram.org, then add them in Netlify under Environment variables and redeploy.</p>
          )}
          {s?.lastError && <p className="mb-4 text-sm text-bad">{s.lastError}</p>}

          {s?.status === "connected" ? (
            <div className="space-y-3">
              <p><span className="text-mute">Account:</span> <b>{s.accountName}</b>{s.username && <span className="text-mute"> @{s.username}</span>}</p>
              <Button danger onClick={() => setConfirm(true)}>Disconnect</Button>
            </div>
          ) : s?.status === "awaiting_code" ? (
            <form className="max-w-sm space-y-4" onSubmit={(e) => { e.preventDefault(); verify.mutate({ code }); }}>
              <p className="text-mute">Enter the login code Telegram sent to your other device{s.phoneHint ? ` (${s.phoneHint})` : ""}.</p>
              <Field label="Login code">{(id) => <input id={id} className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />}</Field>
              <div className="flex gap-2"><Button primary type="submit" busy={verify.isPending} disabled={code.length < 4}>Verify</Button><Button type="button" onClick={() => out.mutate()}>Start over</Button></div>
            </form>
          ) : s?.status === "awaiting_password" ? (
            <form className="max-w-sm space-y-4" onSubmit={(e) => { e.preventDefault(); verify.mutate({ password: pw }); }}>
              <p className="text-mute">This account has two-step verification. Enter its password.</p>
              <Field label="Two-step verification password">{(id) => <input id={id} type="password" className="input" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />}</Field>
              <Button primary type="submit" busy={verify.isPending} disabled={!pw}>Continue</Button>
            </form>
          ) : (
            <form className="max-w-sm space-y-4" onSubmit={(e) => { e.preventDefault(); request.mutate(); }}>
              <Field label="Phone number" hint="International format, for example +919876543210.">{(id) => <input id={id} className="input" inputMode="tel" autoComplete="tel" placeholder="+91…" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
              <Button primary type="submit" busy={request.isPending} disabled={!s?.apiConfigured || !/^\+\d{7,15}$/.test(phone.replace(/[\s-]/g, ""))}>Send login code</Button>
            </form>
          )}
        </section>
        <aside className="card h-fit p-5 text-sm">
          <div className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-ok" />How your login is protected</div>
          <ul className="list-disc space-y-1.5 pl-5 text-mute">
            <li>Only connect an account you own or are authorized to manage.</li>
            <li>The login code and password are used once and never stored or logged.</li>
            <li>The session is encrypted on the server and never sent to this page.</li>
            <li>You can disconnect and revoke the session any time.</li>
          </ul>
        </aside>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Disconnect Telegram?">
        <p className="text-mute">The assistant stops and the saved session is deleted.</p>
        <label className="mt-4 flex items-center gap-2"><input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} />Also log this session out of Telegram</label>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirm(false)}>Cancel</Button><Button danger busy={out.isPending} onClick={() => out.mutate()}>Disconnect</Button></div>
      </Modal>
    </>
  );
}
