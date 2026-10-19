import { Sparkles } from "lucide-react";
import { useState } from "react";
import { post } from "@/lib/api";
import { Button, Field } from "@/ui";

export default function Login({ configured, onDone }: { configured?: { password: boolean; secret: boolean }; onDone: (s: any) => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = configured?.password && configured?.secret;
  return (
    <div className="grid min-h-full place-items-center p-4" style={{ background: "radial-gradient(900px 500px at 15% -10%, rgb(var(--violet) / .22), transparent), radial-gradient(700px 450px at 100% 110%, rgb(var(--blue) / .2), transparent)" }}>
      <form
        className="card rise w-full max-w-sm p-7"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setErr("");
          try { onDone(await post("/api/login", { password: pw })); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
        }}
      >
        <div className="mb-5 grid h-11 w-11 place-items-center rounded-xl text-white" style={{ background: "linear-gradient(135deg, rgb(var(--violet)), rgb(var(--blue)))" }}><Sparkles className="h-6 w-6" /></div>
        <h1 className="text-2xl font-bold">TeleMind AI</h1>
        <p className="mb-5 mt-1 text-mute">Sign in to manage your Telegram assistant.</p>
        {!ready && (
          <p className="mb-4 rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm text-warn">
            The server is not set up yet. Add ADMIN_PASSWORD and APP_SECRET (16+ characters) in Netlify, under Site configuration, Environment variables, then redeploy.
          </p>
        )}
        <Field label="Password">{(id) => <input id={id} type="password" autoComplete="current-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />}</Field>
        {err && <p role="alert" className="mt-3 text-sm text-bad">{err}</p>}
        <Button primary type="submit" busy={busy} disabled={!pw || !ready} className="mt-5 w-full">Sign in</Button>
      </form>
    </div>
  );
}
