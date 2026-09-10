import React, { useEffect, useState } from 'react';
import type { Schedule } from '../server/schedules';

interface PullRequest { number: number; title: string; url: string; headRefName: string; isDraft: boolean }
export function ProjectPanel({ apiBase, workspace, openSession }: { apiBase: string; workspace: string; openSession: (id: string) => void }) {
  const [section, setSection] = useState<'review' | 'schedules'>('review');
  const [git, setGit] = useState<{ branch: string; status: string; diff: string }>();
  const [pullRequests, setPullRequests] = useState<PullRequest[]>();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [minutes, setMinutes] = useState(60);
  const request = async (route: string, body?: unknown) => {
    const res = await fetch(`${apiBase}/api/${route}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };
  const perform = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (err) { setError(err instanceof Error ? err.message : 'Request failed'); }
    finally { setBusy(false); }
  };
  const refresh = () => perform(async () => {
    if (section === 'review') setGit(await request('git'));
    else setSchedules((await request('schedules')).schedules);
  });
  useEffect(() => { setGit(undefined); setPullRequests(undefined); refresh(); }, [workspace, section]);
  const control = 'rounded-lg border border-[#3b485b] bg-[#1b2533] px-3 py-2 text-xs text-[#dae2ed] hover:bg-[#29374a] disabled:opacity-40';
  const field = 'mt-1 w-full rounded-lg border border-[#3b485b] bg-[#101720] px-3 py-2 text-sm text-white';
  return <div className="h-full overflow-auto p-4 md:p-7">
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button className={control} aria-pressed={section === 'review'} onClick={() => setSection('review')}>Changes & pull requests</button>
        <button className={control} aria-pressed={section === 'schedules'} onClick={() => setSection('schedules')}>Schedules</button>
        <button className={`${control} ml-auto`} disabled={busy} onClick={refresh}>{busy ? 'Loading…' : 'Refresh'}</button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}
      {section === 'review' ? <>
        <header><h2 className="text-xl font-semibold text-white">Review your workspace</h2><p className="mt-1 text-sm text-[#96a6bb]">Inspect changes before committing. {git && `Branch: ${git.branch}`}</p></header>
        {git && <>
          <pre className="overflow-auto rounded-xl border border-[#2b394d] bg-[#101720] p-4 text-xs text-[#c4d0e0]">{git.status || 'Working tree is clean.'}</pre>
          {git.diff && <pre aria-label="Workspace diff" className="max-h-96 overflow-auto rounded-xl border border-[#2b394d] bg-[#101720] p-4 text-xs">{git.diff.split('\n').map((line, i) => <div key={i} className={line.startsWith('+') ? 'text-green-300' : line.startsWith('-') ? 'text-red-300' : 'text-[#c4d0e0]'}>{line || ' '}</div>)}</pre>}
          <p className="text-xs text-[#96a6bb]">Diff includes staged and unstaged tracked changes. New files appear in the status list; open them in Files.</p>
        </>}
        <div className="flex items-center justify-between"><h3 className="font-semibold text-white">Open pull requests</h3><button className={control} disabled={busy} onClick={() => perform(async () => setPullRequests((await request('pull-requests')).pullRequests))}>Load from GitHub</button></div>
        <p className="text-xs text-[#96a6bb]">Uses your existing GitHub CLI login and this repository’s remote.</p>
        {pullRequests?.length === 0 && <p className="text-sm text-[#96a6bb]">No open pull requests.</p>}
        {pullRequests?.map(pr => <a key={pr.number} href={/^https:\/\//.test(pr.url) ? pr.url : undefined} target="_blank" rel="noreferrer" className="block rounded-xl border border-[#2b394d] p-4 hover:bg-[#1b2533]"><span className="text-sm text-white">#{pr.number} {pr.title}</span><span className="mt-1 block text-xs text-[#96a6bb]">{pr.headRefName} · {pr.isDraft ? 'Draft' : 'Open'} ↗</span></a>)}
      </> : <>
        <header><h2 className="text-xl font-semibold text-white">Scheduled checks</h2><p className="mt-1 text-sm text-[#96a6bb]">Read-only agent tasks, saved as chats. Runs while the backend is open, using your saved provider and model. API usage is billed by your provider.</p></header>
        <form className="space-y-3 rounded-xl border border-[#2b394d] p-4" onSubmit={e => { e.preventDefault(); perform(async () => { setSchedules((await request('schedules', { name, prompt, intervalMinutes: minutes })).schedules); setName(''); setPrompt(''); }); }}>
          <label className="block text-xs text-[#acbad0]">Name<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} className={field} placeholder="Daily code review" /></label>
          <label className="block text-xs text-[#acbad0]">Task<textarea required maxLength={20000} value={prompt} onChange={e => setPrompt(e.target.value)} className={field} placeholder="Read recent source changes and report potential bugs. Do not edit files." rows={3} /></label>
          <div className="flex flex-wrap items-end gap-3"><label className="text-xs text-[#acbad0]">Every (minutes)<input type="number" min={15} max={43200} required value={minutes} onChange={e => setMinutes(Number(e.target.value))} className={field} /></label><button disabled={busy} className={control}>Create schedule</button></div>
        </form>
        {!schedules.length && <p className="text-sm text-[#96a6bb]">No scheduled checks yet. Create one above.</p>}
        {schedules.map(item => <article key={item.id} className="space-y-2 rounded-xl border border-[#2b394d] p-4">
          <div className="flex justify-between gap-3"><h3 className="font-medium text-white">{item.name}</h3><span className="text-xs text-[#96a6bb]">{item.status === 'running' ? 'Running' : item.enabled ? 'Active' : 'Paused'}</span></div>
          <p className="whitespace-pre-wrap text-sm text-[#acbad0]">{item.prompt}</p>
          <p className="text-xs text-[#96a6bb]">Every {item.intervalMinutes} minutes · {item.enabled ? `Next: ${new Date(item.nextRunAt).toLocaleString()}` : 'Not scheduled'}</p>
          {item.error && <p className="text-xs text-red-300">{item.error}</p>}
          <div className="flex gap-2">
            {item.lastSessionId && <button className={control} onClick={() => openSession(item.lastSessionId!)}>Open result</button>}
            <button className={control} disabled={busy || item.status === 'running'} onClick={() => perform(async () => setSchedules((await request('schedules', { id: item.id, action: item.enabled ? 'pause' : 'resume' })).schedules))}>{item.enabled ? 'Pause' : 'Resume'}</button>
            <button className={control} disabled={busy || item.status === 'running'} onClick={() => perform(async () => setSchedules((await request('schedules', { id: item.id, action: 'delete' })).schedules))}>Remove schedule</button>
          </div>
        </article>)}
      </>}
    </div>
  </div>;
}
