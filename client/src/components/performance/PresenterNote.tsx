/**
 * Presenter notes: admins write one per section per country + period; everyone
 * else reads them. Shown on the page, on each slide and in the PDF.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";
import { usePerformanceContext } from "./PerformanceContext";

export default function PresenterNote({ sectionId, presentation }: { sectionId: string; presentation?: boolean }) {
  const ctx = usePerformanceContext();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const note = ctx?.noteFor(sectionId);
  const save = trpc.country.savePresenterNote.useMutation({
    onSuccess: () => {
      if (ctx) void utils.country.presenterNotes.invalidate({ country: ctx.country, periodKey: ctx.periodKey });
      setEditing(false);
    },
  });

  useEffect(() => {
    if (editing) setDraft(note?.body ?? "");
  }, [editing, note?.body]);

  if (!ctx) return null;
  if (!note && !ctx.canEdit) return null;

  if (editing && ctx.canEdit) {
    return (
      <div className="perf-no-print rounded-lg border border-[#7f1d1d]/30 bg-[#7f1d1d]/5 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#7f1d1d]">Presenter notes — {ctx.country}, this period</p>
        <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} maxLength={4000} placeholder="What should the presenter say about this section? Leave empty to remove the note." />
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={() => save.mutate({ country: ctx.country, periodKey: ctx.periodKey, sectionId, body: draft })} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save note"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          {save.error && <span className="text-xs text-red-700">{save.error.message}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-[#7f1d1d]/30 bg-[#7f1d1d]/5 p-3", presentation && "text-lg")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7f1d1d]">Presenter notes</p>
          {note ? (
            <>
              <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{note.author}, {new Date(note.updatedAt).toLocaleString()}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No presenter note for this section yet.</p>
          )}
        </div>
        {ctx.canEdit && !presentation && (
          <Button variant="ghost" size="sm" className="perf-no-print" onClick={() => setEditing(true)}><Pencil />{note ? "Edit" : "Add note"}</Button>
        )}
      </div>
    </div>
  );
}
