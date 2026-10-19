import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { useToasts } from "@/lib/api";

export const cx = clsx;

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("h-4 w-4 animate-spin", className)} aria-label="Loading" />;
}

export function Button({ primary, danger, busy, className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean; busy?: boolean }) {
  return (
    <button {...p} disabled={p.disabled || busy} className={cx("btn", primary && "btn-primary", danger && "btn-danger", className)}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Badge({ tone = "mute", children }: { tone?: "mute" | "ok" | "warn" | "bad" | "violet" | "blue"; children: ReactNode }) {
  const t = { mute: "text-mute bg-raised", ok: "text-ok bg-ok/10", warn: "text-warn bg-warn/10", bad: "text-bad bg-bad/10", violet: "text-violet bg-violet/15", blue: "text-blue bg-blue/15" }[tone];
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", t)}>{children}</span>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx("relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-50", checked ? "border-transparent bg-violet" : "border-line bg-raised")}>
      <span className={cx("absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-mute">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 text-violet">{icon}</div>
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="max-w-md text-mute">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="card rise max-h-[90dvh] w-full max-w-lg overflow-y-auto p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-mute hover:text-ink"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { items, drop } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" role="status" aria-live="polite">
      {items.map((t) => (
        <button key={t.id} onClick={() => drop(t.id)} className={cx("card rise pointer-events-auto px-4 py-3 text-left text-sm", t.kind === "err" ? "border-bad/60" : "border-ok/50")}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
