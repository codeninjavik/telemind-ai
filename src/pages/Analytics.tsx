import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { get } from "@/lib/api";
import { PageHeader } from "@/ui";

interface A { points: { day: string; incoming: number; drafts: number; sentAuto: number; sentManual: number; skipped: number; aiFailed: number }[]; totals: Record<string, number>; avgGenerationMs: number | null }
const tip = { background: "rgb(29 29 40)", border: "1px solid rgb(44 44 60)", borderRadius: 12, color: "rgb(236 236 244)" };

export default function Analytics() {
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ["analytics", days], queryFn: () => get<A>(`/api/analytics?days=${days}`) });
  const a = q.data;
  const pts = a?.points.map((p) => ({ ...p, day: p.day.slice(5) })) ?? [];
  const empty = a && Object.values(a.totals).every((n) => n === 0);
  return (
    <>
      <PageHeader title="Analytics" sub="Counts come from what the app actually recorded." actions={
        <select aria-label="Period" className="input !w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Received", a?.totals.incoming], ["Drafts", a?.totals.drafts], ["Sent", a ? a.totals.sentAuto + a.totals.sentManual : undefined], ["Average AI time", a?.avgGenerationMs != null ? `${a.avgGenerationMs} ms` : "–"]].map(([l, v]) => (
          <div key={l as string} className="card p-4"><p className="font-display text-2xl font-bold">{v ?? "–"}</p><p className="text-sm text-mute">{l}</p></div>
        ))}
      </div>
      {empty && <p className="card mb-5 p-4 text-mute">No activity in this period yet. Charts fill in as messages arrive.</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-4"><h2 className="mb-3 font-semibold">Messages and drafts per day</h2>
          <div className="h-64"><ResponsiveContainer><LineChart data={pts}><CartesianGrid stroke="rgb(44 44 60)" vertical={false} /><XAxis dataKey="day" stroke="rgb(160 160 182)" fontSize={12} /><YAxis allowDecimals={false} stroke="rgb(160 160 182)" fontSize={12} /><Tooltip contentStyle={tip} /><Legend />
            <Line type="monotone" dataKey="incoming" name="Received" stroke="#2f6bff" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="drafts" name="Drafts" stroke="#8b5cf6" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></section>
        <section className="card p-4"><h2 className="mb-3 font-semibold">What happened to replies</h2>
          <div className="h-64"><ResponsiveContainer><BarChart data={pts}><CartesianGrid stroke="rgb(44 44 60)" vertical={false} /><XAxis dataKey="day" stroke="rgb(160 160 182)" fontSize={12} /><YAxis allowDecimals={false} stroke="rgb(160 160 182)" fontSize={12} /><Tooltip contentStyle={tip} cursor={{ fill: "rgb(255 255 255 / .04)" }} /><Legend />
            <Bar dataKey="sentManual" name="Sent by you" stackId="a" fill="#2f6bff" /><Bar dataKey="sentAuto" name="Sent automatically" stackId="a" fill="#8b5cf6" /><Bar dataKey="skipped" name="Skipped" stackId="a" fill="#6b6b85" /><Bar dataKey="aiFailed" name="AI errors" stackId="a" fill="#f87171" /></BarChart></ResponsiveContainer></div></section>
      </div>
    </>
  );
}
