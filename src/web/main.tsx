import React from 'react';
import ReactDOM from 'react-dom/client';
import { useEffect, useState } from 'react';
import { isTauriEnvironment } from './desktop.ts';
import App from './AppV2.tsx';
import './index.css';

function DesktopOnlyNotice() {
  return (
    <main className="flex h-full items-center justify-center bg-[#0b0d12] px-6 text-center text-slate-200">
      <div className="max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl">
        <div className="mb-3 text-lg font-semibold">Project Alisa Studio V2</div>
        <p className="text-sm leading-6 text-slate-400">This application runs inside the Tauri desktop app. Please launch it with <code className="rounded bg-black/30 px-1.5 py-1 text-sky-200">bun run app</code>.</p>
      </div>
    </main>
  );
}

function StartupOverlay() {
  const [stage, setStage] = useState('starting workspace');
  const [exiting, setExiting] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const stageTimer = window.setTimeout(() => setStage('connecting local engine'), 180);
    const finishTimer = window.setTimeout(() => setStage('ready'), 360);
    const exitTimer = window.setTimeout(() => setExiting(true), 520);
    const hideTimer = window.setTimeout(() => setVisible(false), 740);
    return () => {
      window.clearTimeout(stageTimer);
      window.clearTimeout(finishTimer);
      window.clearTimeout(exitTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;
  return (
    <div className={'alisa-boot ' + (exiting ? 'alisa-boot-exiting' : '')} aria-hidden="true">
      <div className="alisa-boot-inner">
        <div className="alisa-boot-logo">ALISA <span>CODE</span></div>
        <div className="alisa-boot-version">V2 · DESKTOP CODING WORKSPACE</div>
        <div className="alisa-boot-status"><span>●</span>{stage}<i /></div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  isTauriEnvironment() ? <><App /><StartupOverlay /></> : <DesktopOnlyNotice />
);
