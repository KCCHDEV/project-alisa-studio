import React, { useEffect, useState, useMemo } from 'react';
import {
  X,
  Columns,
  Rows,
  Trash2,
  Check,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

interface DiffViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string | null;
  changedFiles: string[];
  onSelectFile: (file: string) => void;
  onDiscardFile: (file: string) => Promise<void>;
}

interface DiffLine {
  type: 'add' | 'del' | 'normal';
  content: string;
  leftLineNum?: number;
  rightLineNum?: number;
}

interface SideBySideRow {
  left: { lineNum?: number; content: string; type: 'del' | 'normal' | 'empty' };
  right: { lineNum?: number; content: string; type: 'add' | 'normal' | 'empty' };
}

export const DiffViewerModal: React.FC<DiffViewerModalProps> = ({
  isOpen,
  onClose,
  filePath,
  changedFiles,
  onSelectFile,
  onDiscardFile,
}) => {
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<{
    filePath: string;
    diff: string;
    original: string | null;
    modified: string | null;
  } | null>(null);
  const [discarding, setDiscarding] = useState(false);

  useEffect(() => {
    if (!isOpen || !filePath) return;
    let active = true;
    setLoading(true);
    setError(null);

    fetch(`http://127.0.0.1:3101/api/git/file-diff?file=${encodeURIComponent(filePath)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load file diff');
        return res.json();
      })
      .then(data => {
        if (active) {
          setDiffData(data);
          setLoading(false);
        }
      })
      .catch(err => {
        if (active) {
          setError(err.message || 'Unable to load diff');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, filePath]);

  // Compute stats and parsed lines
  const { unifiedLines, sideBySideRows, additions, deletions } = useMemo(() => {
    if (!diffData) {
      return { unifiedLines: [], sideBySideRows: [], additions: 0, deletions: 0 };
    }

    const origLines = (diffData.original ?? '').split('\n');
    const modLines = (diffData.modified ?? '').split('\n');

    // If we have raw git diff, parse it
    const diffRaw = diffData.diff;
    let addCount = 0;
    let delCount = 0;
    const uLines: DiffLine[] = [];

    if (diffRaw) {
      const lines = diffRaw.split('\n');
      let leftNum = 1;
      let rightNum = 1;

      for (const line of lines) {
        if (line.startsWith('@@')) {
          // Hunk header e.g. @@ -1,4 +1,15 @@
          const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (match) {
            leftNum = parseInt(match[1], 10);
            rightNum = parseInt(match[2], 10);
          }
          uLines.push({ type: 'normal', content: line });
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          addCount++;
          uLines.push({ type: 'add', content: line.slice(1), rightLineNum: rightNum++ });
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          delCount++;
          uLines.push({ type: 'del', content: line.slice(1), leftLineNum: leftNum++ });
        } else if (!line.startsWith('diff --git') && !line.startsWith('index ') && !line.startsWith('---') && !line.startsWith('+++')) {
          uLines.push({
            type: 'normal',
            content: line.startsWith(' ') ? line.slice(1) : line,
            leftLineNum: leftNum++,
            rightLineNum: rightNum++,
          });
        }
      }
    } else {
      // Fallback: new untracked file or identical
      if (diffData.original === null && diffData.modified !== null) {
        addCount = modLines.length;
        modLines.forEach((line, idx) => {
          uLines.push({ type: 'add', content: line, rightLineNum: idx + 1 });
        });
      } else {
        modLines.forEach((line, idx) => {
          uLines.push({ type: 'normal', content: line, leftLineNum: idx + 1, rightLineNum: idx + 1 });
        });
      }
    }

    // Build side-by-side rows from unified lines or full files
    const sRows: SideBySideRow[] = [];
    let i = 0;
    while (i < uLines.length) {
      const curr = uLines[i];
      if (curr.type === 'normal') {
        sRows.push({
          left: { lineNum: curr.leftLineNum, content: curr.content, type: 'normal' },
          right: { lineNum: curr.rightLineNum, content: curr.content, type: 'normal' },
        });
        i++;
      } else if (curr.type === 'del') {
        // Look ahead for matching addition
        if (i + 1 < uLines.length && uLines[i + 1].type === 'add') {
          const next = uLines[i + 1];
          sRows.push({
            left: { lineNum: curr.leftLineNum, content: curr.content, type: 'del' },
            right: { lineNum: next.rightLineNum, content: next.content, type: 'add' },
          });
          i += 2;
        } else {
          sRows.push({
            left: { lineNum: curr.leftLineNum, content: curr.content, type: 'del' },
            right: { content: '', type: 'empty' },
          });
          i++;
        }
      } else if (curr.type === 'add') {
        sRows.push({
          left: { content: '', type: 'empty' },
          right: { lineNum: curr.rightLineNum, content: curr.content, type: 'add' },
        });
        i++;
      } else {
        i++;
      }
    }

    return {
      unifiedLines: uLines,
      sideBySideRows: sRows,
      additions: addCount,
      deletions: delCount,
    };
  }, [diffData]);

  if (!isOpen || !filePath) return null;

  const currentIndex = changedFiles.indexOf(filePath);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < changedFiles.length - 1 && currentIndex !== -1;

  const handleDiscard = async () => {
    if (!window.confirm(`Discard all local modifications to "${filePath}"?`)) return;
    setDiscarding(true);
    try {
      await onDiscardFile(filePath);
      onClose();
    } catch (e: any) {
      alert(e?.message || 'Failed to discard changes');
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 md:p-6"
      onClick={onClose}
    >
      <div
        className="relative flex h-full max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl border border-white/10 bg-[#0c0f17] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-5 py-3.5 bg-white/[0.02]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300 border border-sky-500/20">
              <FileCode2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-xs font-semibold text-slate-200">
                  {filePath}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.05]">
                  <span className="text-emerald-400">+{additions}</span>
                  <span className="text-rose-400">-{deletions}</span>
                </span>
              </div>
              <div className="text-[10px] text-slate-500">
                File {currentIndex + 1} of {changedFiles.length || 1} modified files
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center rounded-xl border border-white/10 bg-black/40 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition ${
                  viewMode === 'split'
                    ? 'bg-sky-500/20 text-sky-200 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Side by side comparison"
              >
                <Columns className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Side-by-Side</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('unified')}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition ${
                  viewMode === 'unified'
                    ? 'bg-sky-500/20 text-sky-200 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Unified diff list"
              >
                <Rows className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Unified</span>
              </button>
            </div>

            {/* Prev / Next navigation */}
            {changedFiles.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={() => hasPrev && onSelectFile(changedFiles[currentIndex - 1])}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
                  title="Previous modified file"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={() => hasNext && onSelectFile(changedFiles[currentIndex + 1])}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
                  title="Next modified file"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
              title="Close diff modal (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-auto bg-[#07090e] font-mono text-xs leading-relaxed select-text">
          {loading ? (
            <div className="flex h-64 items-center justify-center gap-3 text-slate-400">
              <RefreshCw className="h-5 w-5 animate-spin text-sky-400" />
              <span>Loading diff...</span>
            </div>
          ) : error ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-rose-300">
              <AlertCircle className="h-6 w-6" />
              <span>{error}</span>
            </div>
          ) : viewMode === 'split' ? (
            <div className="min-w-full">
              {/* Split Header */}
              <div className="sticky top-0 z-10 grid grid-cols-2 border-b border-white/10 bg-[#090c14] text-[11px] font-semibold text-slate-400">
                <div className="border-r border-white/10 px-4 py-1.5 text-rose-300/80 bg-rose-500/[0.03]">
                  ORIGINAL (HEAD)
                </div>
                <div className="px-4 py-1.5 text-emerald-300/80 bg-emerald-500/[0.03]">
                  MODIFIED (WORKING TREE)
                </div>
              </div>

              {sideBySideRows.length === 0 ? (
                <div className="p-8 text-center text-slate-500">No modifications found.</div>
              ) : (
                sideBySideRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-2 hover:bg-white/[0.02]">
                    {/* Left side */}
                    <div
                      className={`flex min-w-0 border-r border-white/10 ${
                        row.left.type === 'del'
                          ? 'bg-rose-500/15 text-rose-200'
                          : row.left.type === 'empty'
                          ? 'bg-black/40'
                          : 'text-slate-300'
                      }`}
                    >
                      <span className="w-12 shrink-0 select-none pr-3 text-right text-[10px] text-slate-600 border-r border-white/[0.04] py-0.5">
                        {row.left.lineNum ?? ''}
                      </span>
                      <span className="w-4 shrink-0 text-center select-none text-rose-400 py-0.5">
                        {row.left.type === 'del' ? '-' : ''}
                      </span>
                      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all py-0.5 pr-2 font-mono">
                        {row.left.content}
                      </pre>
                    </div>

                    {/* Right side */}
                    <div
                      className={`flex min-w-0 ${
                        row.right.type === 'add'
                          ? 'bg-emerald-500/15 text-emerald-200'
                          : row.right.type === 'empty'
                          ? 'bg-black/40'
                          : 'text-slate-300'
                      }`}
                    >
                      <span className="w-12 shrink-0 select-none pr-3 text-right text-[10px] text-slate-600 border-r border-white/[0.04] py-0.5">
                        {row.right.lineNum ?? ''}
                      </span>
                      <span className="w-4 shrink-0 text-center select-none text-emerald-400 py-0.5">
                        {row.right.type === 'add' ? '+' : ''}
                      </span>
                      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all py-0.5 pr-2 font-mono">
                        {row.right.content}
                      </pre>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            /* Unified Mode */
            <div className="min-w-full">
              {unifiedLines.length === 0 ? (
                <div className="p-8 text-center text-slate-500">No modifications found.</div>
              ) : (
                unifiedLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`flex min-w-0 ${
                      line.type === 'add'
                        ? 'bg-emerald-500/15 text-emerald-200'
                        : line.type === 'del'
                        ? 'bg-rose-500/15 text-rose-200'
                        : line.content.startsWith('@@')
                        ? 'bg-sky-500/10 text-sky-300 font-semibold'
                        : 'text-slate-300 hover:bg-white/[0.02]'
                    }`}
                  >
                    <span className="w-12 shrink-0 select-none pr-2 text-right text-[10px] text-slate-600 border-r border-white/[0.04] py-0.5">
                      {line.leftLineNum ?? ''}
                    </span>
                    <span className="w-12 shrink-0 select-none pr-2 text-right text-[10px] text-slate-600 border-r border-white/[0.04] py-0.5">
                      {line.rightLineNum ?? ''}
                    </span>
                    <span
                      className={`w-5 shrink-0 text-center select-none py-0.5 font-bold ${
                        line.type === 'add' ? 'text-emerald-400' : line.type === 'del' ? 'text-rose-400' : 'text-slate-600'
                      }`}
                    >
                      {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                    </span>
                    <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all py-0.5 pr-2 font-mono">
                      {line.content}
                    </pre>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex shrink-0 items-center justify-between border-t border-white/[0.08] px-5 py-3 bg-white/[0.02]">
          <button
            type="button"
            disabled={discarding}
            onClick={handleDiscard}
            className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 transition disabled:opacity-50"
            title="Revert this file to HEAD"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{discarding ? 'Discarding...' : 'Discard File Changes'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 border border-sky-500/30 px-4 py-1.5 text-xs font-medium transition"
            >
              <Check className="h-3.5 w-3.5" />
              <span>Keep &amp; Close</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
