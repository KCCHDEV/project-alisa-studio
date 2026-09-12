import React, { useEffect, useState, useRef } from 'react';
import { Volume2, VolumeX, Sparkles, Maximize2 } from 'lucide-react';
import { playChime, isSoundEnabled, toggleSound } from '../audio/sound-fx';
import { triggerConfetti } from './ConfettiCanvas';

export type ChibiScale = 'md' | 'lg' | 'xl';

export interface CompanionSuiteProps {
  status: 'idle' | 'thinking' | 'tool' | 'done' | 'error' | string;
  statusDetail?: string;
  busy: boolean;
  lastRunStatus?: string;
  companionPose: string;
  companionSrc: string;
  companionLabel: string;
  toolName?: string;
  activeGoal?: string;
  onToggleHide?: () => void;
  className?: string;
  isMini?: boolean;
  scale?: ChibiScale;
}

const IDLE_QUOTES = [
  'Ready for coding goals! ✦',
  'What should we build today, Senpai?',
  'Code softly, build seriously. 🌸',
  'Alisa Studio V2 is ready!',
  'Waiting for your instructions~',
];

const SCALE_CLASSES: Record<ChibiScale, { img: string; aura: string; bubble: string }> = {
  md: {
    img: 'h-40 w-40 sm:h-44 sm:w-44',
    aura: '-inset-6',
    bubble: 'max-w-xs text-xs',
  },
  lg: {
    img: 'h-52 w-52 sm:h-60 sm:w-60 md:h-64 md:w-64',
    aura: '-inset-8',
    bubble: 'max-w-sm text-xs sm:text-sm',
  },
  xl: {
    img: 'h-64 w-64 sm:h-72 sm:w-72 md:h-80 md:w-80',
    aura: '-inset-10',
    bubble: 'max-w-md text-sm sm:text-base',
  },
};

export const CompanionSuite: React.FC<CompanionSuiteProps> = ({
  status,
  statusDetail,
  busy,
  lastRunStatus,
  companionPose,
  companionSrc,
  companionLabel,
  toolName,
  activeGoal,
  className = '',
  isMini = false,
  scale: propScale,
}) => {
  const [soundOn, setSoundOn] = useState(true);
  const [thought, setThought] = useState(IDLE_QUOTES[0]);
  const [currentScale, setCurrentScale] = useState<ChibiScale>(() => {
    if (propScale) return propScale;
    try {
      const stored = window.localStorage.getItem('alisa.chibiScale');
      if (stored === 'md' || stored === 'lg' || stored === 'xl') return stored;
    } catch { /* Ignore localStorage errors */ }
    return 'lg';
  });

  const prevBusyRef = useRef(busy);
  const prevStatusRef = useRef(status);

  useEffect(() => {
    setSoundOn(isSoundEnabled());
  }, []);

  const handleScaleChange = (nextScale: ChibiScale, e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentScale(nextScale);
    try {
      window.localStorage.setItem('alisa.chibiScale', nextScale);
    } catch { /* Ignore */ }
    playChime('click');
  };

  // Handle sound triggers on state changes
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    const prevStatus = prevStatusRef.current;
    prevBusyRef.current = busy;
    prevStatusRef.current = status;

    // Started running
    if (!wasBusy && busy) {
      playChime('start');
    }

    // Finished running successfully
    if (wasBusy && !busy && (lastRunStatus === 'completed' || status === 'idle' || status === 'done')) {
      playChime('success');
      triggerConfetti();
    }

    // Encountered error
    if (status === 'error' && prevStatus !== 'error') {
      playChime('error');
    }
  }, [busy, status, lastRunStatus]);

  // Update dynamic thought text
  useEffect(() => {
    if (statusDetail && (statusDetail.includes('OmniRoute') || statusDetail.includes('retry') || statusDetail.includes('ลองใหม่') || statusDetail.includes('stalled') || statusDetail.includes('ขัดข้อง'))) {
      setThought(statusDetail);
    } else if (status === 'error') {
      setThought(statusDetail || 'Uh-oh, encountered an error. Let me fix it! 🔍');
    } else if (busy) {
      if (toolName) {
        if (toolName.includes('file') || toolName.includes('patch')) {
          setThought(`Patching files with ${toolName}... 💻`);
        } else if (toolName.includes('terminal')) {
          setThought('Running shell command in terminal... ⚙️');
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
      // Pick a friendly idle quote
      const quote = IDLE_QUOTES[Math.floor(Math.random() * IDLE_QUOTES.length)];
      setThought(quote);
    }
  }, [status, statusDetail, busy, toolName, lastRunStatus]);

  const handleSoundToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = toggleSound();
    setSoundOn(next);
  };

  const handleMascotClick = () => {
    playChime('bubble');
    // Cycle to next thought
    const randomQuote = IDLE_QUOTES[Math.floor(Math.random() * IDLE_QUOTES.length)];
    setThought(randomQuote);
  };

  if (isMini) {
    return (
      <div
        className={`yurachi-companion-mini group relative flex items-center gap-2 cursor-pointer select-none ${className}`}
        onClick={handleMascotClick}
        title={`Alisa (${companionLabel}) - Click for reaction`}
      >
        <div className="relative">
          <img
            key={companionPose}
            src={companionSrc}
            alt={companionLabel}
            className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl object-contain border border-pink-500/35 bg-black/40 p-0.5 shadow-[0_0_12px_rgba(239,143,189,0.3)] transition-transform duration-300 group-hover:scale-110"
          />
          {busy && (
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-80" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-pink-500 shadow-[0_0_8px_#ec4899]" />
            </span>
          )}
        </div>
        <div className="hidden lg:flex flex-col">
          <span className="text-[11px] font-semibold text-pink-300 leading-tight">
            Yurachi
          </span>
          <span className="text-[9px] text-slate-500 uppercase tracking-wider font-mono">
            {companionLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={handleSoundToggle}
          className="ml-0.5 rounded-lg p-1.5 text-slate-500 hover:text-slate-200 hover:bg-white/5 transition"
          title={soundOn ? 'Sound effects on (click to mute)' : 'Sound muted (click to enable)'}
        >
          {soundOn ? <Volume2 className="h-3.5 w-3.5 text-pink-400" /> : <VolumeX className="h-3.5 w-3.5 text-slate-600" />}
        </button>
      </div>
    );
  }

  const activeScaleConfig = SCALE_CLASSES[currentScale];

  return (
    <div
      className={`yurachi-companion-suite flex flex-col items-center select-none ${className}`}
      aria-live="polite"
    >
      {/* Floating Thought Bubble */}
      <div className={`relative mb-4 animate-bounce-subtle cursor-pointer ${activeScaleConfig.bubble}`} onClick={handleMascotClick}>
        <div className="relative rounded-2xl border border-pink-500/25 bg-gradient-to-br from-pink-500/15 via-purple-500/10 to-sky-500/15 px-5 py-2.5 text-center font-medium text-pink-100 shadow-[0_6px_28px_rgba(239,143,189,0.25)] backdrop-blur-md transition-all hover:scale-105">
          <div className="flex items-center justify-center gap-2">
            <Sparkles className="h-4 w-4 text-pink-400 animate-pulse shrink-0" />
            <span className="leading-snug">{thought}</span>
          </div>
          {/* Bubble tail */}
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rotate-45 border-b border-r border-pink-500/25 bg-[#171426]" />
        </div>
      </div>

      {/* Mascot Image with Glowing Aura */}
      <div className="relative group cursor-pointer my-1" onClick={handleMascotClick}>
        <div className={`absolute ${activeScaleConfig.aura} rounded-full bg-gradient-to-r from-pink-500/25 via-purple-500/20 to-sky-500/25 blur-2xl opacity-75 transition duration-500 group-hover:opacity-100 group-hover:scale-110`} />
        <img
          key={companionPose}
          src={companionSrc}
          alt={`Alisa ${companionLabel}`}
          className={`relative ${activeScaleConfig.img} object-contain transition-transform duration-300 group-hover:scale-105 drop-shadow-[0_16px_36px_rgba(239,143,189,0.35)]`}
        />
      </div>

      {/* Caption & Controls (with Size Switcher) */}
      <div className="mt-4 flex items-center gap-2.5 rounded-full border border-white/[0.08] bg-black/50 px-4 py-1.5 text-[11px] text-slate-400 backdrop-blur-sm shadow-lg">
        <span className="font-bold text-pink-300 tracking-wide">YURACHI</span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-300 font-mono text-[10px] uppercase">{companionLabel}</span>
        <span className="text-slate-600">·</span>
        
        {/* Chibi Size Switcher */}
        <div className="flex items-center gap-1 rounded-full bg-white/5 p-0.5 border border-white/[0.06]" title="Adjust Chibi size">
          {(['md', 'lg', 'xl'] as ChibiScale[]).map(sc => (
            <button
              key={sc}
              type="button"
              onClick={(e) => handleScaleChange(sc, e)}
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-mono uppercase transition ${
                currentScale === sc
                  ? 'bg-pink-500/30 text-pink-200 font-bold border border-pink-500/40 shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {sc === 'md' ? 'M' : sc === 'lg' ? 'L' : 'XL'}
            </button>
          ))}
        </div>

        <span className="text-slate-600">·</span>
        <button
          type="button"
          onClick={handleSoundToggle}
          className="flex items-center gap-1 text-slate-400 hover:text-pink-300 transition"
          title={soundOn ? 'Sound effects enabled' : 'Sound effects muted'}
        >
          {soundOn ? (
            <>
              <Volume2 className="h-3.5 w-3.5 text-pink-400" />
              <span className="text-[10px]">Audio</span>
            </>
          ) : (
            <>
              <VolumeX className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-[10px] text-slate-500">Muted</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
