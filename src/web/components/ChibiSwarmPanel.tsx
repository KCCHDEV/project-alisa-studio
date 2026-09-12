import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Volume2,
  VolumeX,
  Volume1,
  Sparkles,
  Users,
  Bot,
  Check,
  RotateCcw,
  X,
  Minus,
  Maximize2,
  Minimize2,
  Search,
  FileCode2,
  Hammer,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  Settings2,
  Sliders,
  Play,
} from 'lucide-react';
import {
  playChime,
  isSoundEnabled,
  setSoundEnabled,
  toggleSound,
  getSoundVolume,
  setSoundVolume,
  type ChimeType,
} from '../audio/sound-fx';
import { triggerConfetti } from './ConfettiCanvas';
import type { SwarmAgent, SwarmAgentRole } from '../../core/types';

export interface ChibiSwarmPanelProps {
  status: 'idle' | 'thinking' | 'tool' | 'done' | 'error' | string;
  statusDetail?: string;
  busy: boolean;
  lastRunStatus?: string;
  companionPose: string;
  companionSrc: string;
  companionLabel: string;
  toolName?: string;
  activeGoal?: string;
  swarmEnabled: boolean;
  swarmAgents: SwarmAgent[];
  swarmPhase?: string;
  docked?: boolean;
  onToggleSwarm?: () => void;
  onOpenSwarmInspector?: () => void;
  onOpenSettings?: () => void;
  onClose?: () => void;
  className?: string;
}

const IDLE_QUOTES = [
  'Ready for coding goals! ✦',
  'What should we build today, Senpai?',
  'Code softly, build seriously. 🌸',
  'Alisa Studio V2 is ready!',
  'Waiting for your instructions~',
  'I am watching the swarm for you! 🐝',
];

const SWARM_ROLES: { role: SwarmAgentRole; label: string; desc: string; icon: React.FC<{ className?: string }> }[] = [
  { role: 'explorer', label: 'Explorer', desc: 'Scan & Recon', icon: Search },
  { role: 'planner', label: 'Planner', desc: 'Plan & Checks', icon: FileCode2 },
  { role: 'builder', label: 'Builder', desc: 'Code & Execute', icon: Hammer },
  { role: 'reviewer', label: 'Reviewer', desc: 'Verify & Audit', icon: CheckCircle2 },
];

export const ChibiSwarmPanel: React.FC<ChibiSwarmPanelProps> = ({
  status,
  statusDetail,
  busy,
  lastRunStatus,
  companionPose,
  companionSrc,
  companionLabel,
  toolName,
  activeGoal,
  swarmEnabled,
  swarmAgents,
  swarmPhase,
  docked = false,
  onToggleSwarm,
  onOpenSwarmInspector,
  onOpenSettings,
  onClose,
  className = '',
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [soundOn, setSoundOn] = useState(true);
  const [volume, setVolume] = useState<number>(85);
  const [showVolumePopup, setShowVolumePopup] = useState(false);
  const [thought, setThought] = useState(IDLE_QUOTES[0]);
  const [sizeScale, setSizeScale] = useState<'sm' | 'md' | 'lg'>('md');

  const prevBusyRef = useRef(busy);
  const prevStatusRef = useRef(status);

  useEffect(() => {
    setSoundOn(isSoundEnabled());
    setVolume(getSoundVolume());
  }, []);

  const toggleCollapse = () => {
    setCollapsed(prev => !prev);
    playChime('click');
  };

  const cycleSizeScale = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSizeScale(prev => {
      if (prev === 'sm') return 'md';
      if (prev === 'md') return 'lg';
      return 'sm';
    });
    playChime('click');
  };

  // Sound triggers
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    const prevStatus = prevStatusRef.current;
    prevBusyRef.current = busy;
    prevStatusRef.current = status;

    if (!wasBusy && busy) playChime('start');
    if (wasBusy && !busy && (lastRunStatus === 'completed' || status === 'idle' || status === 'done')) {
      playChime('success');
      triggerConfetti();
    }
    if (status === 'error' && prevStatus !== 'error') playChime('error');
  }, [busy, status, lastRunStatus]);

  // Active swarm role
  const activeWorker = useMemo(() => {
    if (!swarmEnabled || !swarmAgents.length) return null;
    return swarmAgents.find(a => a.status === 'working') || swarmAgents.at(-1);
  }, [swarmEnabled, swarmAgents]);

  // Dynamic thought text
  useEffect(() => {
    if (statusDetail && (statusDetail.includes('OmniRoute') || statusDetail.includes('retry') || statusDetail.includes('ลองใหม่') || statusDetail.includes('stalled') || statusDetail.includes('ขัดข้อง'))) {
      setThought(statusDetail);
    } else if (status === 'error') {
      setThought(statusDetail || 'Uh-oh, encountered an error. Let me fix it! 🔍');
    } else if (busy) {
      if (swarmEnabled && activeWorker) {
        setThought(`${activeWorker.label}: ${activeWorker.detail || 'Working...'} 🐝`);
      } else if (toolName) {
        if (toolName.includes('file') || toolName.includes('patch')) {
          setThought(`Patching files with ${toolName}... 💻`);
        } else if (toolName.includes('terminal')) {
          setThought('Running command in terminal... ⚙️');
        } else {
          setThought(`Executing ${toolName}... ✦`);
        }
      } else if (status === 'thinking') {
        setThought('Thinking through the best approach... 💭');
      } else {
        setThought('Working on your goal... 🚀');
      }
    } else if (lastRunStatus === 'completed') {
      setThought('Goal completed! Everything looks great! ✨');
    } else {
      const quote = IDLE_QUOTES[Math.floor(Math.random() * IDLE_QUOTES.length)];
      setThought(quote);
    }
  }, [status, statusDetail, busy, toolName, lastRunStatus, swarmEnabled, activeWorker]);

  const handleMascotClick = () => {
    playChime('bubble');
    const quote = IDLE_QUOTES[Math.floor(Math.random() * IDLE_QUOTES.length)];
    setThought(quote);
  };

  const handleSoundToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = toggleSound();
    setSoundOn(next);
  };

  const handleVolumeChange = (newVal: number) => {
    setVolume(newVal);
    setSoundVolume(newVal);
  };

  // Determine effective chibi image: if swarm worker active, use related pose
  const effectiveSrc = useMemo(() => {
    if (swarmEnabled && activeWorker?.status === 'working') {
      if (activeWorker.role === 'builder') return './yurachi-chibi-coding.webp';
      if (activeWorker.role === 'reviewer') return './yurachi-chibi-review.webp';
      if (activeWorker.role === 'explorer' || activeWorker.role === 'planner') return './yurachi-chibi-thinking.webp';
    }
    return companionSrc;
  }, [swarmEnabled, activeWorker, companionSrc]);

  // If minimized / collapsed state
  if (collapsed) {
    if (docked) {
      return (
        <div
          className={`shrink-0 w-full border-t border-white/[0.08] bg-gradient-to-r from-[#0c0e18] via-[#101322] to-[#0c0e18] px-3 py-2 flex items-center justify-between select-none shadow-lg ${className}`}
        >
          <div className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1 group" onClick={toggleCollapse}>
            <div className="relative shrink-0" onClick={handleMascotClick}>
              <img
                key={companionPose}
                src={effectiveSrc}
                alt="Alisa Chibi"
                className="h-8 w-8 rounded-full object-contain border border-pink-400/50 bg-pink-500/10 p-0.5 shadow-[0_0_10px_rgba(239,143,189,0.35)] transition-transform group-hover:scale-110"
              />
              {busy && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-80" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-pink-500 shadow-[0_0_6px_#ec4899]" />
                </span>
              )}
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-pink-300">Yurachi</span>
                {swarmEnabled && (
                  <span className="rounded bg-violet-500/20 px-1 py-0.2 text-[8px] font-mono font-semibold text-violet-300 border border-violet-500/30">
                    SWARM
                  </span>
                )}
              </div>
              <span className="truncate text-[10px] text-slate-400">
                {busy ? (activeWorker ? `${activeWorker.label}: active` : companionLabel) : 'Companion Ready'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleSoundToggle}
              className="rounded p-1 text-slate-400 hover:text-pink-300 hover:bg-white/5 transition"
              title={soundOn ? `Sound on (${volume}%)` : 'Muted'}
            >
              {soundOn ? <Volume2 className="h-3.5 w-3.5 text-pink-400" /> : <VolumeX className="h-3.5 w-3.5 text-slate-600" />}
            </button>
            <button
              type="button"
              onClick={toggleCollapse}
              className="rounded p-1 text-slate-400 hover:text-white hover:bg-white/10 transition"
              title="Expand Yurachi companion"
            >
              <ChevronUp className="h-4 w-4 text-pink-300" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`fixed bottom-24 right-6 z-30 flex items-center gap-2.5 rounded-full border border-pink-500/40 bg-[#101322]/95 p-1.5 pr-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-md transition-all duration-300 hover:scale-105 select-none ${className}`}
      >
        <button
          type="button"
          onClick={handleMascotClick}
          className="relative group cursor-pointer"
          title="Click to interact with Yurachi"
        >
          <img
            key={companionPose}
            src={effectiveSrc}
            alt="Alisa Chibi"
            className="h-10 w-10 rounded-full object-contain border border-pink-400/50 bg-pink-500/10 p-0.5 shadow-[0_0_14px_rgba(239,143,189,0.35)] transition-transform group-hover:scale-110"
          />
          {busy && (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-80" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-pink-500 shadow-[0_0_8px_#ec4899]" />
            </span>
          )}
        </button>

        <div className="flex flex-col cursor-pointer" onClick={toggleCollapse}>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-pink-300">Yurachi</span>
            {swarmEnabled && (
              <span className="rounded bg-violet-500/20 px-1.5 py-0.2 text-[8px] font-mono font-semibold text-violet-300 border border-violet-500/30">
                SWARM
              </span>
            )}
          </div>
          <span className="max-w-[140px] truncate text-[10px] text-slate-400">
            {busy ? (activeWorker ? activeWorker.label : companionLabel) : 'Companion Ready'}
          </span>
        </div>

        <button
          type="button"
          onClick={toggleCollapse}
          className="ml-1 rounded-lg p-1 text-slate-400 hover:text-white hover:bg-white/10 transition"
          title="Expand Chibi & Swarm Panel"
        >
          <ChevronUp className="h-4 w-4 text-pink-300" />
        </button>
      </div>
    );
  }

  // Visual image dimensions
  const imageDimensions = docked
    ? (sizeScale === 'lg' ? 'h-32 w-32' : sizeScale === 'sm' ? 'h-20 w-20' : 'h-26 w-26')
    : (sizeScale === 'lg' ? 'h-48 w-48' : sizeScale === 'sm' ? 'h-28 w-28' : 'h-38 w-38');

  const containerClasses = docked
    ? `shrink-0 w-full border-t border-white/[0.1] bg-gradient-to-b from-[#101322]/95 to-[#0b0d17]/98 shadow-[0_-8px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-all duration-300 select-none overflow-hidden ${className}`
    : `fixed bottom-24 right-6 z-30 flex flex-col w-[310px] sm:w-[330px] rounded-2xl border border-pink-500/30 bg-[#0e111f]/95 shadow-[0_20px_60px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-all duration-300 select-none overflow-hidden ${className}`;

  return (
    <div
      className={containerClasses}
      role="complementary"
      aria-label="Yurachi Chibi & Agent Swarm Panel"
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="relative flex h-2 w-2 items-center justify-center">
            <span className="h-2 w-2 rounded-full bg-pink-400 inline-block animate-pulse" />
          </div>
          <span className="font-bold text-pink-300 tracking-wider text-[11px]">
            YURACHI
          </span>
          {swarmEnabled && (
            <span className="rounded border border-violet-500/40 bg-violet-500/20 px-1.5 py-0.2 text-[8px] font-mono font-semibold text-violet-200">
              SWARM
            </span>
          )}
        </div>

        <div className="relative flex items-center gap-0.5">
          {/* Sizing scale toggle */}
          <button
            type="button"
            onClick={cycleSizeScale}
            className="rounded p-1 text-slate-400 hover:text-pink-300 hover:bg-white/5 transition"
            title={`Scale size: ${sizeScale.toUpperCase()} (click to cycle)`}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>

          {/* Sound & Volume control with popover toggle */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowVolumePopup(v => !v)}
              className={`rounded p-1 transition ${
                soundOn ? 'text-pink-400 hover:bg-pink-500/10' : 'text-slate-500 hover:text-slate-300'
              }`}
              title={`Sound FX: ${soundOn ? `${volume}%` : 'Muted'} (Click for volume slider)`}
            >
              {soundOn ? (volume > 50 ? <Volume2 className="h-3.5 w-3.5" /> : <Volume1 className="h-3.5 w-3.5" />) : <VolumeX className="h-3.5 w-3.5" />}
            </button>

            {/* Quick Volume Slider Popover */}
            {showVolumePopup && (
              <div className="absolute right-0 bottom-full mb-2 z-50 w-52 rounded-xl border border-pink-500/30 bg-[#121526] p-3 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-pink-200 flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-pink-400" />
                    Volume Control
                  </span>
                  <span className="text-[11px] font-mono font-bold text-pink-300">{soundOn ? `${volume}%` : 'Muted'}</span>
                </div>

                <div className="space-y-2">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={soundOn ? volume : 0}
                    onChange={e => {
                      const v = Number(e.target.value);
                      if (!soundOn) setSoundOn(true);
                      handleVolumeChange(v);
                    }}
                    className="w-full accent-pink-400 h-1.5 bg-white/10 rounded cursor-pointer"
                  />

                  <div className="flex items-center justify-between pt-1 border-t border-white/[0.08]">
                    <button
                      type="button"
                      onClick={() => {
                        const next = toggleSound();
                        setSoundOn(next);
                      }}
                      className="text-[10px] text-slate-400 hover:text-pink-300 font-medium"
                    >
                      {soundOn ? 'Mute' : 'Unmute'}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!soundOn || volume === 0) {
                          const newVol = volume === 0 ? 85 : volume;
                          setSoundOn(true);
                          setSoundEnabled(true);
                          setVolume(newVol);
                          setSoundVolume(newVol);
                        }
                        void playChime('start', { force: true });
                      }}
                      className="flex items-center gap-1 text-[10px] text-pink-300 hover:text-pink-200 font-medium bg-pink-500/15 px-2 py-0.5 rounded border border-pink-500/30 active:scale-95 transition"
                    >
                      <Play className="h-2.5 w-2.5 fill-current" /> Test
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Settings shortcut button */}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded p-1 text-slate-400 hover:text-sky-300 hover:bg-white/5 transition"
              title="Open Settings (Audio & Workspace)"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Collapse button */}
          <button
            type="button"
            onClick={toggleCollapse}
            className="rounded p-1 text-slate-400 hover:text-white hover:bg-white/5 transition"
            title={docked ? 'Collapse to bottom bar' : 'Minimize to corner widget'}
          >
            {docked ? <ChevronDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
          </button>

          {/* Close button if provided */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 transition"
              title="Hide Yurachi"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Chibi Visual Area with Holographic Pedestal */}
      <div className="flex flex-col items-center p-2.5 pb-2">
        {/* Thought Bubble */}
        <div
          className="relative mb-2 w-full animate-bounce-subtle cursor-pointer"
          onClick={handleMascotClick}
          title="Click to interact with Yurachi"
        >
          <div className="relative rounded-xl border border-pink-500/30 bg-gradient-to-br from-pink-500/15 via-purple-500/10 to-indigo-500/10 px-3 py-1.5 text-center text-xs font-medium text-pink-100 shadow-[0_4px_16px_rgba(239,143,189,0.2)] backdrop-blur-md transition-all hover:scale-[1.02] hover:border-pink-400/50">
            <div className="flex items-center justify-center gap-1.5">
              <Sparkles className="h-3 w-3 text-pink-400 animate-pulse shrink-0" />
              <span className="line-clamp-2 leading-relaxed text-[11px] font-medium">{thought}</span>
            </div>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2 w-2 rotate-45 border-b border-r border-pink-500/30 bg-[#121426]" />
          </div>
        </div>

        {/* Mascot Image with Holographic Aura Pedestal */}
        <div className="relative group cursor-pointer my-0.5 flex flex-col items-center" onClick={handleMascotClick}>
          {/* Ambient Glowing Aura */}
          <div className="absolute -inset-3 rounded-full bg-gradient-to-r from-pink-500/25 via-purple-500/20 to-sky-500/25 blur-xl opacity-80 transition duration-500 group-hover:opacity-100 group-hover:scale-110" />

          {/* Chibi Mascot Illustration */}
          <img
            key={companionPose}
            src={effectiveSrc}
            alt={`Alisa ${companionLabel}`}
            className={`relative ${imageDimensions} object-contain transition-transform duration-300 group-hover:scale-105 drop-shadow-[0_10px_24px_rgba(239,143,189,0.35)]`}
          />

          {/* Holographic Pedestal Glow */}
          <div className="h-1.5 w-20 rounded-full bg-gradient-to-r from-pink-500/40 via-purple-400/60 to-pink-500/40 blur-[2px] shadow-[0_0_12px_rgba(236,72,153,0.5)] -mt-1" />
        </div>

        {/* Live Status Pill */}
        <div className="mt-1.5 flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-0.5">
          <span className={`h-1.5 w-1.5 rounded-full ${busy ? 'bg-pink-400 animate-ping' : 'bg-emerald-400'}`} />
          <span className="text-[9px] font-mono font-medium tracking-wide text-slate-300">
            {busy ? (activeWorker ? `${activeWorker.label.toUpperCase()} RUNNING` : companionLabel.toUpperCase()) : 'COMPANION READY'}
          </span>
        </div>
      </div>

      {/* Agent Swarm Section with 2x2 Grid */}
      <div className="border-t border-white/[0.08] bg-black/30 p-2.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
            <Users className="h-3.5 w-3.5 text-violet-300" />
            <span>Agent Swarm</span>
          </div>

          <div className="flex items-center gap-1.5">
            {onOpenSwarmInspector && (
              <button
                type="button"
                onClick={onOpenSwarmInspector}
                className="text-[9px] font-medium text-pink-300/80 hover:text-pink-200 hover:underline transition"
                title="Inspect detailed agent execution log"
              >
                Inspect ↑
              </button>
            )}
            {onToggleSwarm ? (
              <button
                type="button"
                onClick={onToggleSwarm}
                className={`rounded-full px-2 py-0.5 text-[9px] font-mono transition ${
                  swarmEnabled
                    ? 'bg-violet-500/30 text-violet-200 border border-violet-500/40 font-semibold'
                    : 'bg-white/5 text-slate-500 hover:text-slate-300'
                }`}
              >
                {swarmEnabled ? 'ENABLED' : 'OFF'}
              </button>
            ) : (
              <span className="text-[10px] text-slate-500">
                {swarmEnabled ? 'Active' : 'Disabled'}
              </span>
            )}
          </div>
        </div>

        {swarmEnabled ? (
          <div className="space-y-1.5">
            {/* 2x2 Swarm Roles Grid - Super readable in 310px width */}
            <div className="grid grid-cols-2 gap-1.5">
              {SWARM_ROLES.map(({ role, label, desc, icon: IconComponent }) => {
                const agent = swarmAgents.find(a => a.role === role);
                const isWorking = agent?.status === 'working';
                const isDone = agent?.status === 'done';
                const isError = agent?.status === 'error';

                return (
                  <div
                    key={role}
                    className={`flex items-center gap-2 rounded-xl border p-1.5 transition ${
                      isWorking
                        ? 'border-pink-500/60 bg-pink-500/15 text-pink-200 shadow-[0_0_12px_rgba(239,143,189,0.3)] animate-pulse-slow'
                        : isDone
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : isError
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                        : 'border-white/[0.06] bg-white/[0.02] text-slate-400'
                    }`}
                    title={`${label} (${desc}): ${agent?.status || 'waiting'}`}
                  >
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
                      isWorking
                        ? 'bg-pink-500/30 text-pink-200'
                        : isDone
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-white/[0.05] text-slate-400'
                    }`}>
                      <IconComponent className="h-3 w-3" />
                    </div>

                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold leading-tight truncate">{label}</span>
                        <span className={`text-[8px] font-mono font-bold uppercase ${
                          isWorking ? 'text-pink-300' : isDone ? 'text-emerald-300' : isError ? 'text-rose-300' : 'text-slate-600'
                        }`}>
                          {isWorking ? '● RUN' : isDone ? '✓ DONE' : isError ? '× ERR' : '○ WAIT'}
                        </span>
                      </div>
                      <span className="text-[8px] text-slate-500 truncate">{desc}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Live Swarm Phase Detail */}
            {swarmPhase && (
              <div className="truncate rounded-lg bg-black/40 border border-white/[0.06] px-2.5 py-1 text-[9px] text-pink-300 font-mono flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-pink-400 animate-ping" />
                <span className="truncate">{swarmPhase}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 p-2.5 text-center text-[10px] text-slate-500 bg-white/[0.01]">
            <span>4-Stage: Explorer → Planner → Builder → Reviewer</span>
            {onToggleSwarm && (
              <button
                type="button"
                onClick={onToggleSwarm}
                className="mt-1.5 block mx-auto text-pink-300 hover:text-pink-200 hover:underline font-semibold text-[10px]"
              >
                + Enable Agent Swarm Pipeline
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
