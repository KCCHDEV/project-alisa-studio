import React from 'react';
import {
  Sparkles,
  X,
  Rocket,
  Gamepad2,
  Bot,
  Layout,
  Puzzle,
  ArrowRight
} from 'lucide-react';

interface TemplateShowcaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (prompt: string) => void;
}

interface TemplateItem {
  id: string;
  title: string;
  category: string;
  description: string;
  badge: string;
  icon: React.ReactNode;
  prompt: string;
}

const TEMPLATES: TemplateItem[] = [
  {
    id: 'saas',
    title: 'Modern AI SaaS Dashboard',
    category: 'Full-Stack Web',
    description: 'React, Tailwind CSS, Lucide icons, responsive sidebar, stats widgets, and mock billing.',
    badge: 'Popular',
    icon: <Rocket className="h-5 w-5 text-sky-400" />,
    prompt: 'Build a complete, stunning Modern SaaS Dashboard in React and Tailwind CSS with responsive sidebar, KPI analytics cards, interactive charts, and sleek dark mode aesthetics.',
  },
  {
    id: 'game3d',
    title: '3D Interactive Three.js Game',
    category: 'Creative / WebGL',
    description: 'Interactive 3D scene with lighting, keyboard controls, particle effects, and physics.',
    badge: 'Creative',
    icon: <Gamepad2 className="h-5 w-5 text-purple-400" />,
    prompt: 'Create a lightweight 3D interactive Three.js mini-game directly in this project with keyboard movement, obstacle dodging, sound effects, and score tracking.',
  },
  {
    id: 'landing',
    title: 'High-Converting Landing Page',
    category: 'Marketing / Design',
    description: 'Hero section with gradient mesh, features grid, pricing table, FAQ, and footer.',
    badge: 'High Impact',
    icon: <Layout className="h-5 w-5 text-pink-400" />,
    prompt: 'Build a high-converting, ultra-modern landing page with animated hero section, glassmorphic feature cards, interactive pricing tiers, and FAQ accordion.',
  },
  {
    id: 'bot',
    title: 'AI Telegram / Discord Bot',
    category: 'Automation / Backend',
    description: 'Node.js / Bun bot architecture with command handlers, LLM streaming, and state store.',
    badge: 'Automation',
    icon: <Bot className="h-5 w-5 text-emerald-400" />,
    prompt: 'Scaffold an AI Assistant Bot in Bun / TypeScript with modular command routing, conversation memory, and integration with OpenAI / Claude APIs.',
  },
  {
    id: 'extension',
    title: 'Chrome Extension Manifest V3',
    category: 'Browser Extension',
    description: 'Modern popup interface, background service worker, and content script injection.',
    badge: 'Utility',
    icon: <Puzzle className="h-5 w-5 text-amber-400" />,
    prompt: 'Build a Chrome Extension (Manifest V3) with a beautiful dark-mode popup UI, tab scraper content script, and storage sync.',
  },
];

export const TemplateShowcaseModal: React.FC<TemplateShowcaseModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9992] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-3xl flex-col rounded-3xl border border-white/10 bg-[#0b0e17] shadow-2xl overflow-hidden p-6 md:p-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 rounded-xl p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-pink-500/20 bg-pink-500/10 px-3 py-1 text-[11px] font-semibold text-pink-300 mb-2">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Instant Vibe Coding Starters</span>
          </div>
          <h2 className="text-xl md:text-2xl font-bold text-slate-100 tracking-tight">
            Start a New Project with Alisa
          </h2>
          <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">
            Choose a template and Alisa will autonomously scaffold, design, and run your project in seconds.
          </p>
        </div>

        {/* Template Cards Grid */}
        <div className="grid gap-3.5 sm:grid-cols-2 md:grid-cols-3">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onSelectTemplate(t.prompt);
                onClose();
              }}
              className="group relative flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 text-left transition hover:border-pink-500/30 hover:bg-white/[0.05] hover:scale-[1.02] shadow-sm hover:shadow-lg"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/40 border border-white/10 shadow-inner group-hover:scale-110 transition-transform">
                    {t.icon}
                  </div>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] font-medium text-slate-400">
                    {t.badge}
                  </span>
                </div>
                <div className="font-semibold text-xs text-slate-200 group-hover:text-pink-200 transition-colors">
                  {t.title}
                </div>
                <div className="mt-1 text-[10px] leading-relaxed text-slate-400 line-clamp-2">
                  {t.description}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-1 text-[10px] font-medium text-pink-300 opacity-80 group-hover:opacity-100 transition-opacity">
                <span>Build with Alisa</span>
                <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
