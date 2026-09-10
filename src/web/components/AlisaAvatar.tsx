import React, { useState } from 'react';
import { Bot, Sparkles } from 'lucide-react';

interface AlisaAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  isThinking?: boolean;
}

export const AlisaAvatar: React.FC<AlisaAvatarProps> = ({
  size = 'md',
  className = '',
  isThinking = false,
}) => {
  const [imgError, setImgError] = useState(false);

  const sizeMap = {
    sm: 'w-7 h-7 rounded-lg',
    md: 'w-8 h-8 rounded-xl',
    lg: 'w-12 h-12 rounded-2xl',
  };

  const iconSizeMap = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-6 h-6',
  };

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 select-none overflow-visible ${sizeMap[size]} ${className}`}
    >
      {!imgError ? (
        <img
          src="./avatar.png"
          alt="Alisa"
          onError={() => setImgError(true)}
          className={`w-full h-full object-cover rounded-xl border border-[#38bdf8]/40 shadow-[0_0_10px_rgba(56,189,248,0.2)] transition-all ${
            isThinking ? 'ring-2 ring-[#ec4899] animate-pulse scale-105' : ''
          }`}
        />
      ) : (
        <div
          className={`w-full h-full flex items-center justify-center rounded-xl bg-gradient-to-br from-[#1e293b] via-[#161f2e] to-[#2e1065] border border-[#38bdf8]/30 shadow-[0_0_12px_rgba(56,189,248,0.15)]`}
        >
          {isThinking ? (
            <Sparkles className={`${iconSizeMap[size]} text-[#38bdf8] animate-pulse`} />
          ) : (
            <Bot className={`${iconSizeMap[size]} text-[#38bdf8]`} />
          )}
        </div>
      )}

      {/* Cyber ambient glow pip */}
      <span
        className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-[#0b0d10] ${
          isThinking
            ? 'w-2.5 h-2.5 bg-[#ec4899] animate-ping'
            : 'w-2 h-2 bg-[#38bdf8]'
        }`}
      />
    </div>
  );
};
