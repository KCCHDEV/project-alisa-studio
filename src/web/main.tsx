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
  const [stage, setStage] = useState('Initializing workspace...');
  const [progress, setProgress] = useState(18);
  const [exiting, setExiting] = useState(false);
  const [visible, setVisible] = useState(true);

  const dismiss = () => {
    if (exiting) return;
    setExiting(true);
    window.setTimeout(() => setVisible(false), 450);
  };

  useEffect(() => {
    const t1 = window.setTimeout(() => {
      setStage('Loading local configurations...');
      setProgress(45);
    }, 600);

    const t2 = window.setTimeout(() => {
      setStage('Connecting local AI engine...');
      setProgress(75);
    }, 1250);

    const t3 = window.setTimeout(() => {
      setStage('Workspace initialized · Ready');
      setProgress(100);
    }, 1850);

    const t4 = window.setTimeout(() => {
      setExiting(true);
    }, 2450);

    const t5 = window.setTimeout(() => {
      setVisible(false);
    }, 2900);

    const handleKeyDown = () => dismiss();
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      window.clearTimeout(t5);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (!visible) return null;
  return (
    <div
      className={`alisa-boot ${exiting ? 'alisa-boot-exiting' : ''}`}
      onClick={dismiss}
      role="dialog"
      aria-label="Starting Project Alisa Studio"
    >
      <div className="alisa-boot-ambient" />
      <div className="alisa-boot-inner">
        <div className="alisa-boot-avatar-wrap">
          <img
            src="./avatar.png"
            alt="Alisa"
            className="alisa-boot-avatar"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
          <div className="alisa-boot-avatar-ring" />
          <div className="alisa-boot-avatar-glow" />
        </div>

        <div className="alisa-boot-logo">
          PROJECT ALISA <span className="alisa-boot-accent">STUDIO</span>
        </div>
        <div className="alisa-boot-version">
          <span>V2.0.1</span>
          <span className="alisa-boot-dot">·</span>
          <span>AI CODING &amp; AUTOMATION WORKSPACE</span>
        </div>

        <div className="alisa-boot-progress-bar">
          <div
            className="alisa-boot-progress-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="alisa-boot-status">
          <span className="alisa-boot-beacon">
            <span className="alisa-boot-beacon-dot" />
            <span className="alisa-boot-beacon-ping" />
          </span>
          <span className="alisa-boot-stage-text">{stage}</span>
        </div>

        <div className="alisa-boot-skip-hint">
          Click anywhere or press any key to skip
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  isTauriEnvironment() ? <><App /><StartupOverlay /></> : <DesktopOnlyNotice />
);
