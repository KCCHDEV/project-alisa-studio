import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, GitMerge, Loader2, MessageSquarePlus, Trash2, X } from 'lucide-react';
import type { ChangedFileDiff, DiffAnnotation, WorktreeRecord } from '../orchestrator-types';
import { API_BASE } from './WorktreeTile.tsx';

type DiffLine = { kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'; text: string; line?: number };

function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      newLine = match ? Number(match[1]) : 0;
      lines.push({ kind: 'hunk', text: raw });
      continue;
    }
    if (raw.startsWith('diff --git') || raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('new file') || raw.startsWith('deleted file') || raw.startsWith('similarity ') || raw.startsWith('rename ')) {
      lines.push({ kind: 'meta', text: raw });
      continue;
    }
    if (raw.startsWith('\\')) {
      lines.push({ kind: 'meta', text: raw });
      continue;
    }
    if (raw.startsWith('+')) {
      lines.push({ kind: 'add', text: raw.slice(1), line: newLine });
      newLine += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      lines.push({ kind: 'del', text: raw.slice(1) });
      continue;
    }
    lines.push({ kind: 'ctx', text: raw.slice(1), line: newLine });
    newLine += 1;
  }
  return lines;
}

const LINE_TONE: Record<DiffLine['kind'], string> = {
  add: 'bg-emerald-300/[0.09] text-emerald-100',
  del: 'bg-rose-300/[0.09] text-rose-100',
  ctx: 'text-slate-300',
  hunk: 'bg-sky-300/[0.07] text-sky-200',
  meta: 'text-slate-600',
};

interface ReviewModalProps {
  record: WorktreeRecord;
  sessionId: string;
  onClose: () => void;
  onMerged: () => void;
  onSendNotes: (record: WorktreeRecord, prompt: string) => void;
}

export function WorktreeReviewModal(props: ReviewModalProps) {
  const { record, sessionId, onClose, onMerged, onSendNotes } = props;
  const [files, setFiles] = useState<ChangedFileDiff[]>([]);
  const [annotations, setAnnotations] = useState<DiffAnnotation[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [commitMessage, setCommitMessage] = useState(`wip: ${record.title}`);
  const [draft, setDraft] = useState<{ file: string; line: number } | null>(null);
  const [draftText, setDraftText] = useState('');
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [diffResponse, annotationResponse] = await Promise.all([
        fetch(`${API_BASE}/api/worktrees/diff?id=${encodeURIComponent(record.id)}`, { headers: { Origin: window.location.origin } }),
        fetch(`${API_BASE}/api/worktrees/annotations?id=${encodeURIComponent(record.id)}`, { headers: { Origin: window.location.origin } }),
      ]);
      const diffPayload = await diffResponse.json() as any;
      if (!diffResponse.ok) throw new Error(diffPayload?.error || 'Unable to load the diff');
      const annotationPayload = await annotationResponse.json() as any;
      const loaded: ChangedFileDiff[] = diffPayload.files ?? [];
      setFiles(loaded);
      setAnnotations(annotationResponse.ok ? (annotationPayload.annotations ?? []) : []);
      setSelected(current => (current && loaded.some(file => file.path === current) ? current : (loaded[0]?.path ?? '')));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the diff');
    } finally {
      setLoading(false);
    }
  }, [record.id]);

  useEffect(() => { void load(); }, [load]);

  const activeFile = useMemo(() => files.find(file => file.path === selected), [files, selected]);
  const lines = useMemo(() => (activeFile ? parseDiff(activeFile.diff) : []), [activeFile]);
  const notesByLine = useMemo(() => {
    const map = new Map<string, DiffAnnotation[]>();
    for (const note of annotations) {
      if (note.filePath !== activeFile?.path) continue;
      const key = `${note.line}`;
      map.set(key, [...(map.get(key) ?? []), note]);
    }
    return map;
  }, [annotations, activeFile]);
  const openNotes = annotations.filter(note => !note.resolved);

  const post = useCallback(async (route: string, body: Record<string, unknown>) => {
    const response = await fetch(`${API_BASE}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as any;
    if (!response.ok) throw new Error(payload?.error || 'Request failed');
    return payload;
  }, []);

  const addAnnotation = useCallback(async () => {
    if (!draft || !draftText.trim()) return;
    setBusy(true);
    try {
      await post('/api/worktrees/annotate', {
        action: 'add',
        worktreeId: record.id,
        filePath: draft.file,
        line: draft.line,
        comment: draftText.trim(),
      });
      setDraft(null);
      setDraftText('');
      await load();
      setNotice('Note added');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add the note');
    } finally {
      setBusy(false);
    }
  }, [draft, draftText, post, record.id, load]);

  const toggleResolved = useCallback(async (note: DiffAnnotation) => {
    setBusy(true);
    try {
      await post('/api/worktrees/annotate', { action: 'update', id: note.id, resolved: !note.resolved });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update the note');
    } finally {
      setBusy(false);
    }
  }, [post, load]);

  const deleteAnnotation = useCallback(async (note: DiffAnnotation) => {
    setBusy(true);
    try {
      await post('/api/worktrees/annotate', { action: 'delete', id: note.id });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the note');
    } finally {
      setBusy(false);
    }
  }, [post, load]);

  const commit = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await post('/api/worktrees/commit', { id: record.id, message: commitMessage });
      setNotice('Committed in the worktree');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to commit');
    } finally {
      setBusy(false);
    }
  }, [commitMessage, post, record.id, load]);

  const merge = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const result = await post('/api/worktrees/merge', { id: record.id });
      if (result.conflicted) setError(`Merge produced conflicts in ${record.branch}. Resolve them in the main workspace.`);
      else if (result.alreadyUpToDate) setNotice('Already up to date');
      else setNotice('Merged into the main workspace');
      onMerged();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to merge');
    } finally {
      setBusy(false);
    }
  }, [post, record.id, record.branch, onMerged, load]);

  const sendNotes = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/worktrees/annotations?id=${encodeURIComponent(record.id)}`, { headers: { Origin: window.location.origin } });
      const payload = await response.json() as { prompt?: string };
      if (!payload.prompt) throw new Error('There are no open notes to send');
      onSendNotes(record, payload.prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send notes');
    } finally {
      setBusy(false);
    }
  }, [record, onSendNotes]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex h-[min(88vh,900px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f131b] shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-slate-100">{record.title}</h2>
            <p className="truncate text-[11px] text-slate-500">{record.branch} · base {record.baseRef} · {files.length} file{files.length === 1 ? '' : 's'} changed · {openNotes.length} open note{openNotes.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/[0.06] hover:text-slate-200" title="Close"><X className="h-4 w-4" /></button>
        </header>

        {error && <div className="shrink-0 border-b border-rose-300/20 bg-rose-300/10 px-4 py-2 text-[11px] text-rose-200">{error}</div>}
        {notice && !error && <div className="shrink-0 border-b border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-[11px] text-emerald-200">{notice}</div>}

        <div className="flex min-h-0 flex-1">
          <aside className="tab-scroll w-56 shrink-0 overflow-y-auto border-r border-white/[0.08] p-2">
            {loading && <p className="px-2 py-3 text-[11px] text-slate-500">Loading diff…</p>}
            {!loading && !files.length && <p className="px-2 py-3 text-[11px] text-slate-500">No changes yet. Start the agent to produce a diff.</p>}
            {files.map(file => {
              const notes = annotations.filter(note => note.filePath === file.path && !note.resolved).length;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelected(file.path)}
                  className={'mb-1 flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] transition ' + (file.path === selected ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:bg-white/[0.04]')}
                >
                  <span className="min-w-0 flex-1 truncate" title={file.path}>{file.path}</span>
                  {notes > 0 && <span className="shrink-0 rounded-full bg-amber-300/15 px-1.5 text-[9px] text-amber-200">{notes}</span>}
                  <span className="shrink-0 text-[9px] text-emerald-300">+{file.additions}</span>
                  <span className="shrink-0 text-[9px] text-rose-300">−{file.deletions}</span>
                </button>
              );
            })}
          </aside>

          <section className="tab-scroll min-w-0 flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
            {!activeFile && <p className="px-3 py-6 text-center text-slate-600">Select a file to see the changes.</p>}
            {activeFile?.binary && <p className="px-3 py-6 text-center text-slate-600">Binary file — no textual diff.</p>}
            {activeFile && !activeFile.binary && lines.map((entry, index) => {
              const notes = entry.line !== undefined ? notesByLine.get(String(entry.line)) ?? [] : [];
              const isAddable = entry.kind === 'add' || entry.kind === 'ctx';
              return (
                <div key={`${index}-${entry.text}`}>
                  <div className={'group flex items-start gap-2 px-1 ' + (LINE_TONE[entry.kind] ?? LINE_TONE.ctx)}>
                    <span className="w-10 shrink-0 select-none text-right text-slate-700">{entry.line ?? ''}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{entry.text || ' '}</span>
                    {isAddable && entry.line !== undefined && (
                      <button
                        type="button"
                        onClick={() => { setDraft({ file: activeFile.path, line: entry.line! }); setDraftText(''); setTimeout(() => draftRef.current?.focus(), 0); }}
                        className="shrink-0 rounded p-0.5 text-slate-700 opacity-0 transition hover:text-amber-200 focus:opacity-100 group-hover:opacity-100"
                        title="Leave a review note on this line"
                      >
                        <MessageSquarePlus className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {notes.map(note => (
                    <div key={note.id} className="mx-1 mb-1 rounded-lg border border-amber-300/20 bg-amber-300/[0.07] px-2 py-1.5 font-sans">
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 text-[11px] text-amber-100">{note.comment}</p>
                        <button type="button" disabled={busy} onClick={() => void toggleResolved(note)} className="shrink-0 rounded p-0.5 text-amber-300/70 hover:text-emerald-200" title={note.resolved ? 'Reopen' : 'Mark as done'}><CheckCircle2 className="h-3.5 w-3.5" /></button>
                        <button type="button" disabled={busy} onClick={() => void deleteAnnotation(note)} className="shrink-0 rounded p-0.5 text-amber-300/70 hover:text-rose-200" title="Delete note"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      {note.resolved && <span className="mt-1 inline-block text-[10px] text-emerald-300">resolved</span>}
                    </div>
                  ))}
                </div>
              );
            })}

            {draft && (
              <div className="sticky bottom-2 mx-1 mt-2 rounded-xl border border-amber-300/25 bg-[#141922] p-2 font-sans shadow-lg">
                <p className="mb-1 text-[10px] text-amber-200">Note on {draft.file} line {draft.line}</p>
                <textarea
                  ref={draftRef}
                  value={draftText}
                  onChange={event => setDraftText(event.target.value)}
                  rows={3}
                  placeholder="What should the agent fix here?"
                  className="w-full resize-y rounded-lg border border-white/10 bg-black/30 p-2 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-amber-300/40"
                />
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button type="button" disabled={busy || !draftText.trim()} onClick={() => void addAnnotation()} className="rounded-lg bg-amber-300/80 px-2 py-1 text-[11px] font-semibold text-[#171923] disabled:opacity-40">Add note</button>
                  <button type="button" onClick={() => { setDraft(null); setDraftText(''); }} className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-400">Cancel</button>
                </div>
              </div>
            )}
          </section>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/[0.08] px-4 py-3">
          <input
            value={commitMessage}
            onChange={event => setCommitMessage(event.target.value)}
            placeholder="Commit message"
            className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-white/25"
          />
          <button type="button" disabled={busy || !commitMessage.trim()} onClick={() => void commit()} className="flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-white/[0.06] disabled:opacity-40">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Commit
          </button>
          <button type="button" disabled={busy || !openNotes.length} onClick={() => void sendNotes()} className="flex items-center gap-1 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2.5 py-1.5 text-[11px] text-amber-200 hover:bg-amber-300/20 disabled:opacity-40">
            <MessageSquarePlus className="h-3 w-3" /> Send {openNotes.length} note{openNotes.length === 1 ? '' : 's'} to agent
          </button>
          <button type="button" disabled={busy} onClick={() => void merge()} className="flex items-center gap-1 rounded-lg bg-emerald-300/80 px-2.5 py-1.5 text-[11px] font-semibold text-[#171923] hover:bg-emerald-300 disabled:opacity-40">
            <GitMerge className="h-3 w-3" /> Merge into main
          </button>
          <span className="ml-auto text-[10px] text-slate-600">session {sessionId.slice(0, 8)}</span>
        </footer>
      </div>
    </div>
  );
}