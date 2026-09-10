import React, { useState } from 'react';

interface AlisaLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  textClassName?: string;
}

export const AlisaLogo: React.FC<AlisaLogoProps> = ({
  size = 32,
  className = '',
  showText = false,
  textClassName = '',
}) => {
  const [imgError, setImgError] = useState(false);

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {!imgError ? (
        <img
          src="./avatar.png"
          alt="Project Alisa Studio"
          onError={() => setImgError(true)}
          className="shrink-0 rounded-xl object-cover border border-[#38bdf8]/40 shadow-[0_2px_10px_rgba(56,189,248,0.25)] transition hover:scale-105"
          style={{ width: `${size}px`, height: `${size}px` }}
        />
      ) : (
        <svg
          width={size}
          height={size}
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="shrink-0 drop-shadow-[0_2px_8px_rgba(56,189,248,0.25)]"
        >
          <defs>
            <linearGradient id="alisa-grad-primary" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#818cf8" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
          </defs>
          <rect
            x="3"
            y="3"
            width="34"
            height="34"
            rx="10"
            fill="#131720"
            stroke="url(#alisa-grad-primary)"
            strokeWidth="1.75"
          />
          <path
            d="M20 9L29 27H23.8L22 22.8H18L16.2 27H11L20 9Z"
            fill="url(#alisa-grad-primary)"
          />
          <path
            d="M20 14.5L21.4 19.2H18.6L20 14.5Z"
            fill="#131720"
          />
          <circle cx="28.5" cy="11.5" r="2" fill="#38bdf8" />
          <circle cx="11.5" cy="28.5" r="1.5" fill="#ec4899" />
        </svg>
      )}

      {showText && (
        <div className={`flex flex-col leading-tight ${textClassName}`}>
          <span className="font-semibold tracking-tight text-white font-sans text-sm">
            Project Alisa
          </span>
          <span className="text-[10px] tracking-wider uppercase font-mono text-[#7f8da0]">
            Studio
          </span>
        </div>
      )}
    </div>
  );
};
