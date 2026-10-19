import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History as HistoryIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { ago, del, get, toast } from "@/lib/api";
import { Badge, Button, Empty, Modal, PageHeader } from "@/ui";
import type { LogEntry } from "@server/types";

export default function HistoryPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ["history", page], queryFn: () => get<{ items: LogEntry[]; total: number; page: number; pageSize: number }>(`/api/history?page=${page}`) });
  const clear = useMutation({ mutationFn: () => del("/api/history"), onSuccess: () => { setConfirm(false); toast.ok("History deleted."); qc.invalidateQueries(); }, onError: toast.err });
  const pages = Math.max(1, Math.ceil((q.data?.total ?? 0) / 25));
  return (
    <>
      <PageHeader title="Reply history" sub="Every reply that was sent, failed or skipped, with what the AI drafted and what was finally sent."
        actions={<Button danger onClick={() => setConfirm(true)} disabled={!q.data?.total}><Trash2 className="h-4 w-4" />Delete history</Button>} />
      <div className="card divide-y divide-line">
        {!q.data?.items.length ? <Empty icon={<HistoryIcon className="h-8 w-8" />} title="Nothing here yet">Sent, skipped and failed replies are listed once the assistant has handled a message.</Empty> :
          q.data.items.map((e) => (
            <article key={e.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <b>{e.contact}</b>
                <Badge tone={e.status === "sent" ? "ok" : e.status === "failed" ? "bad" : "mute"}>{e.status}</Badge>
                <Badge tone={e.automatic ? "violet" : "blue"}>{e.automatic ? "automatic" : e.status === "sent" ? "approved by you" : e.mode}</Badge>
                <span className="ml-auto text-xs text-mute">{ago(e.at)}</span>
              </div>
              <p className="text-sm text-mute">They wrote: {e.incoming}</p>
              {e.final && <p className="rounded-xl bg-raised px-3 py-2 text-sm">{e.final}</p>}
              {e.draft && e.draft !== e.final && <p className="text-xs text-mute">AI draft was: {e.draft}</p>}
              {(e.reason || e.error) && <p className="text-xs text-warn">{e.reason ?? e.error}</p>}
            </article>
          ))}
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-mute">Page {page} of {pages}</span>
          <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Delete all history?">
        <p className="text-mute">This removes the saved conversations, reply log and statistics from this app. Your Telegram chats are not touched, and messages already answered will not be answered again.</p>
        <div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirm(false)}>Cancel</Button><Button danger busy={clear.isPending} onClick={() => clear.mutate()}>Delete</Button></div>
      </Modal>
    </>
  );
}
