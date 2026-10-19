import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, BookOpen, History, Inbox as InboxIcon, LayoutDashboard, LogOut, Menu, PlugZap, Power, ShieldAlert, SlidersHorizontal, Sparkles, Users, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { get, post, setCsrf, toast } from "@/lib/api";
import { Button, Spinner, Toasts, cx } from "@/ui";
import Analytics from "@/pages/Analytics";
import Contacts from "@/pages/Contacts";
import HistoryPage from "@/pages/History";
import Inbox from "@/pages/Inbox";
import Login from "@/pages/Login";
import Overview from "@/pages/Overview";
import Rules from "@/pages/Rules";
import SettingsPage from "@/pages/Settings";
import Studio from "@/pages/Studio";
import Telegram from "@/pages/Telegram";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/inbox", label: "Inbox", icon: InboxIcon },
  { to: "/studio", label: "Reply Studio", icon: Wand2 },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/rules", label: "Automation Rules", icon: SlidersHorizontal },
  { to: "/history", label: "Reply History", icon: History },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/telegram", label: "Telegram", icon: PlugZap },
  { to: "/settings", label: "Settings", icon: BookOpen },
];

export default function App() {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: () => get("/api/session"), staleTime: Infinity, retry: false });
  useEffect(() => { setCsrf(session.data?.csrf ?? null); }, [session.data]);

  if (session.isLoading) return <div className="grid h-full place-items-center"><Spinner className="h-6 w-6" /></div>;
  if (session.isError) return <div className="grid h-full place-items-center p-6 text-center text-mute">Could not reach the server. Reload to try again.</div>;
  if (!session.data?.authenticated) return <><Login configured={session.data?.configured} onDone={(s) => { setCsrf(s.csrf); qc.setQueryData(["session"], s); }} /><Toasts /></>;
  return <><Shell onLogout={() => { setCsrf(null); qc.clear(); qc.setQueryData(["session"], { ...session.data, authenticated: false, csrf: null }); }} /><Toasts /></>;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="flex h-full">
      <aside className={cx("fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-panel p-4 transition-transform lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: "linear-gradient(135deg, rgb(var(--violet)), rgb(var(--blue)))" }}><Sparkles className="h-5 w-5" /></div>
            <span className="font-display text-lg font-bold">TeleMind AI</span>
          </div>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx("flex min-h-[42px] items-center gap-3 rounded-xl px-3 text-sm font-medium transition", isActive ? "bg-violet/15 text-ink" : "text-mute hover:bg-raised hover:text-ink")}>
              <n.icon className="h-[18px] w-[18px]" />{n.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={async () => { await post("/api/logout").catch(() => 0); onLogout(); }} className="btn mt-3"><LogOut className="h-4 w-4" />Sign out</button>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <StatusBar onMenu={() => setOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="mx-auto max-w-6xl">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/telegram" element={<Telegram />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Always visible: shows whether the assistant is running and in which mode, with the emergency stop. */
function StatusBar({ onMenu }: { onMenu: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["stats"], queryFn: () => get("/api/dashboard/stats"), refetchInterval: 8000 });
  const s = q.data;
  const refresh = () => qc.invalidateQueries();
  const start = useMutation({ mutationFn: () => post("/api/assistant/start"), onSuccess: () => { toast.ok("Assistant started."); refresh(); }, onError: toast.err });
  const stop = useMutation({ mutationFn: () => post("/api/assistant/emergency-stop"), onSuccess: () => { toast.ok("Assistant stopped. Automatic sending is off."); refresh(); }, onError: toast.err });
  const auto = s?.running && s.mode === "auto";
  return (
    <header className={cx("flex items-center gap-3 border-b px-4 py-2.5", auto ? "border-bad/60 bg-bad/10" : "border-line bg-panel")}>
      <button className="lg:hidden" onClick={onMenu} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
      <div className="flex min-w-0 flex-1 items-center gap-2.5" aria-live="polite">
        <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", auto ? "auto-dot" : s?.running ? "live-dot bg-ok" : "bg-mute")} />
        <span className="truncate text-sm font-semibold">
          {!s ? "Checking status…" : auto ? "AUTOMATIC REPLIES ARE ON: messages are sent without asking you" : s.running ? `Assistant on · ${s.mode === "draft" ? "AI drafts, you approve" : "manual"}` : "Assistant is off"}
        </span>
      </div>
      {s?.running ? (
        <Button danger busy={stop.isPending} onClick={() => stop.mutate()}><ShieldAlert className="h-4 w-4" />{auto ? "Emergency stop" : "Stop"}</Button>
      ) : (
        <Button primary busy={start.isPending} onClick={() => start.mutate()}><Power className="h-4 w-4" />Start assistant</Button>
      )}
    </header>
  );
}
