import React, { useState } from 'react';
import { Check, Copy, Terminal, FileCode2 } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isDiff = language.toLowerCase() === 'diff';

  if (isDiff) {
    const diffLines = code.split('\n');
    return (
      <div className="code-block my-3 overflow-hidden border border-[#1a1a1a] bg-[#080808]">
        <div className="flex items-center justify-between border-b border-[#1a1a1a] bg-transparent px-3.5 py-1.5 text-xs text-[#666]">
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-[#38bdf8]">
            <FileCode2 className="h-3.5 w-3.5" /> diff
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[#8fa0b5] hover:bg-[#1f2735] hover:text-white transition"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 text-[#d4d8e0]">
          {diffLines.map((line, lineIndex) => {
            const isAdd = line.startsWith('+');
            const isDel = line.startsWith('-');
            const isHunk = line.startsWith('@@');
            const cls = isAdd
              ? 'diff-add block border-l border-emerald-400/60 px-1 text-emerald-300'
              : isDel
              ? 'diff-remove block border-l border-rose-400/60 px-1 text-rose-300'
              : isHunk
              ? 'text-[#8da4c6] block font-semibold'
              : 'block';
            return (
              <code key={`diff-${lineIndex}`} className={cls}>
                {line || ' '}
              </code>
            );
          })}
        </pre>
      </div>
    );
  }

  return (
    <div className="code-block my-3 overflow-hidden border border-[#1a1a1a] bg-[#080808]">
      <div className="flex items-center justify-between border-b border-[#1a1a1a] bg-transparent px-3.5 py-1.5 text-xs text-[#666]">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-[#7dd3fc]">
          <Terminal className="h-3.5 w-3.5" />
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[#8fa0b5] hover:bg-[#1f2735] hover:text-white transition"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-xs leading-5 text-[#e2e8f0]">
        <code>{code}</code>
      </pre>
    </div>
  );
};

function formatInlineText(text: string): React.ReactNode[] {
  // Parses inline code `...`, bold **...**, italic *...*, and links [text](url)
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="font-mono text-[12px] font-medium text-[#9bc2ff]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={i} className="italic text-[#cbd5e1]">
          {part.slice(1, -1)}
        </em>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="text-[#38bdf8] underline decoration-[#38bdf8]/40 hover:decoration-[#38bdf8] transition"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  if (!content) return null;

  // Split by fenced code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className={`space-y-2 text-sm leading-6 text-[#e2e8f0] ${className}`}>
      {parts.map((part, index) => {
        if (part.startsWith('```')) {
          const firstLineEnd = part.indexOf('\n');
          const header = firstLineEnd !== -1 ? part.slice(3, firstLineEnd).trim() : '';
          const body = firstLineEnd !== -1 ? part.slice(firstLineEnd + 1, -3) : part.slice(3, -3);
          return <CodeBlock key={`block-${index}`} language={header} code={body} />;
        }

        // Parse regular prose lines (headings, blockquotes, lists, paragraphs)
        const lines = part.split('\n');
        return (
          <div key={`prose-${index}`} className="space-y-1.5">
            {lines.map((line, lineIdx) => {
              const trimmed = line.trim();
              if (!trimmed) {
                return <div key={lineIdx} className="h-2" />;
              }

              // Headings
              if (trimmed.startsWith('### ')) {
                return (
                  <h4 key={lineIdx} className="mt-3 text-sm font-semibold tracking-tight text-[#f1f5f9]">
                    {formatInlineText(trimmed.slice(4))}
                  </h4>
                );
              }
              if (trimmed.startsWith('## ')) {
                return (
                  <h3 key={lineIdx} className="mt-4 text-base font-semibold tracking-tight text-white border-b border-[#242b38] pb-1">
                    {formatInlineText(trimmed.slice(3))}
                  </h3>
                );
              }
              if (trimmed.startsWith('# ')) {
                return (
                  <h2 key={lineIdx} className="mt-4 text-lg font-bold tracking-tight text-white border-b border-[#2d3748] pb-1">
                    {formatInlineText(trimmed.slice(2))}
                  </h2>
                );
              }

              // Horizontal rule
              if (/^(\*\*\*|---|___)$/.test(trimmed)) {
                return <hr key={lineIdx} className="my-3 border-[#262f3d]" />;
              }

              // Blockquotes
              if (trimmed.startsWith('> ')) {
                return (
                  <blockquote
                    key={lineIdx}
                    className="border-l border-[#31527d] px-3 py-1.5 text-xs italic text-[#777]"
                  >
                    {formatInlineText(trimmed.slice(2))}
                  </blockquote>
                );
              }

              // Bullet list
              if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                return (
                  <div key={lineIdx} className="flex items-start gap-2 pl-2">
                    <span className="mt-1 text-[#6da8ff]">›</span>
                    <span className="flex-1">{formatInlineText(trimmed.slice(2))}</span>
                  </div>
                );
              }

              // Numbered list
              const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
              if (numMatch) {
                return (
                  <div key={lineIdx} className="flex items-start gap-2 pl-2">
                    <span className="font-mono text-xs font-semibold text-[#818cf8] shrink-0 mt-0.5">
                      {numMatch[1]}.
                    </span>
                    <span className="flex-1">{formatInlineText(numMatch[2])}</span>
                  </div>
                );
              }

              // Standard paragraph
              return (
                <p key={lineIdx} className="leading-6">
                  {formatInlineText(line)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
