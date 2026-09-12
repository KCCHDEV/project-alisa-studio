import React, { useState, useRef } from 'react';
import {
  Globe,
  RotateCw,
  Smartphone,
  Tablet,
  Monitor,
  ExternalLink,
  X,
  Eye
} from 'lucide-react';

interface LiveWebPreviewProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPort?: number;
}

export const LiveWebPreview: React.FC<LiveWebPreviewProps> = ({
  isOpen,
  onClose,
  defaultPort = 3000,
}) => {
  const [url, setUrl] = useState(`http://localhost:${defaultPort}`);
  const [inputUrl, setInputUrl] = useState(`http://localhost:${defaultPort}`);
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [key, setKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  if (!isOpen) return null;

  const handleRefresh = () => {
    setLoading(true);
    setKey(prev => prev + 1);
  };

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let finalUrl = inputUrl.trim();
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `http://${finalUrl}`;
    }
    setUrl(finalUrl);
    setInputUrl(finalUrl);
    handleRefresh();
  };

  const getDeviceWidth = () => {
    switch (device) {
      case 'mobile':
        return '375px';
      case 'tablet':
        return '768px';
      default:
        return '100%';
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-[990] flex w-full max-w-2xl flex-col border-l border-white/10 bg-[#090c14] shadow-2xl backdrop-blur-xl transition-all">
      {/* Header / Address Bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-2.5 bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 border border-sky-500/20">
            <Eye className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-semibold text-slate-200">Live Web Preview</span>
        </div>

        {/* Viewport switcher */}
        <div className="flex items-center rounded-lg border border-white/10 bg-black/40 p-0.5">
          <button
            type="button"
            onClick={() => setDevice('desktop')}
            className={`rounded-md p-1 transition ${
              device === 'desktop' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-500 hover:text-slate-200'
            }`}
            title="Desktop view"
          >
            <Monitor className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setDevice('tablet')}
            className={`rounded-md p-1 transition ${
              device === 'tablet' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-500 hover:text-slate-200'
            }`}
            title="Tablet view (768px)"
          >
            <Tablet className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setDevice('mobile')}
            className={`rounded-md p-1 transition ${
              device === 'mobile' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-500 hover:text-slate-200'
            }`}
            title="Mobile view (375px)"
          >
            <Smartphone className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
            title="Open in external browser"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
            title="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* URL bar */}
      <form onSubmit={handleNavigate} className="flex items-center gap-2 border-b border-white/[0.06] bg-black/30 px-4 py-1.5">
        <Globe className="h-3.5 w-3.5 text-slate-500 shrink-0" />
        <input
          type="text"
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          placeholder="http://localhost:3000"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-slate-200 placeholder-slate-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleRefresh}
          className={`rounded-md p-1 text-slate-400 hover:text-slate-200 transition ${
            loading ? 'animate-spin text-sky-400' : ''
          }`}
          title="Reload preview"
        >
          <RotateCw className="h-3 w-3" />
        </button>
      </form>

      {/* Iframe Viewport Container */}
      <div className="flex-1 overflow-auto bg-[#05070a] p-3 flex justify-center items-start">
        <div
          className="h-full overflow-hidden rounded-xl border border-white/10 bg-white transition-all shadow-2xl flex flex-col"
          style={{ width: getDeviceWidth(), maxWidth: '100%' }}
        >
          <iframe
            ref={iframeRef}
            key={key}
            src={url}
            onLoad={() => setLoading(false)}
            title="Local Preview"
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          />
        </div>
      </div>
    </div>
  );
};
