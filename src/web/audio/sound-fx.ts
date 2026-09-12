// Procedural Sound Effects Engine for Project Alisa Studio
// Hybrid Web Audio API + HTML5 Audio fallback for guaranteed crystal-clear playback on macOS (WebKit/Tauri) and all browsers.

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;

const STORAGE_KEY_ENABLED = 'alisa_sound_enabled';
const STORAGE_KEY_VOLUME = 'alisa_sound_volume';

// Global unlocker for browsers / WKWebView with strict autoplay policies
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  };
  ['click', 'keydown', 'pointerdown', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, unlockAudio, { once: true, passive: true });
  });
}

async function getAudioContext(): Promise<{ ctx: AudioContext; master: AudioNode } | null> {
  if (typeof window === 'undefined') return null;

  try {
    if (!audioCtx) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return null;
      audioCtx = new AudioContextClass();
    }

    if (audioCtx && !masterGain) {
      masterGain = audioCtx.createGain();
      const currentVol = Math.max(0.1, getSoundVolume() / 100);
      masterGain.gain.setValueAtTime(currentVol, audioCtx.currentTime);
      masterGain.connect(audioCtx.destination);
    }

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    if (!audioCtx || !masterGain) return null;
    return { ctx: audioCtx, master: masterGain };
  } catch (err) {
    console.warn('[Alisa Audio] Failed to initialize AudioContext:', err);
    return null;
  }
}

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(STORAGE_KEY_ENABLED);
  return stored === null ? true : stored === 'true';
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? 'true' : 'false');
}

export function getSoundVolume(): number {
  if (typeof window === 'undefined') return 85;
  const stored = localStorage.getItem(STORAGE_KEY_VOLUME);
  if (stored === null) return 85; // Default 85% for clear audibility
  const parsed = parseInt(stored, 10);
  return isNaN(parsed) ? 85 : Math.max(0, Math.min(100, parsed));
}

export function setSoundVolume(volumePercent: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(0, Math.min(100, Math.round(volumePercent)));
  localStorage.setItem(STORAGE_KEY_VOLUME, clamped.toString());

  if (audioCtx && masterGain) {
    try {
      masterGain.gain.setValueAtTime(clamped / 100, audioCtx.currentTime);
    } catch {
      // Ignore audio param timing errors
    }
  }
}

export function toggleSound(): boolean {
  const next = !isSoundEnabled();
  setSoundEnabled(next);
  if (next) {
    playChime('click', { force: true });
  }
  return next;
}

export type ChimeType = 'start' | 'success' | 'error' | 'click' | 'bubble';

/**
 * Fallback synthesizer using HTML5 Audio + in-memory 16-bit PCM WAV.
 * Guaranteed to produce audible sound even if WebKit Web Audio API is blocked or disabled.
 */
function playWavFallback(type: ChimeType, volumePercent: number): void {
  if (typeof window === 'undefined') return;
  try {
    const sampleRate = 22050;
    const vol = Math.max(0.15, Math.min(1.0, volumePercent / 100));

    let freqList: { freq: number; dur: number; offset: number }[] = [];
    if (type === 'start') {
      freqList = [
        { freq: 659.25, dur: 0.11, offset: 0.00 }, // E5
        { freq: 830.61, dur: 0.11, offset: 0.08 }, // G#5
        { freq: 987.77, dur: 0.13, offset: 0.16 }, // B5
        { freq: 1318.51, dur: 0.28, offset: 0.24 }, // E6
      ];
    } else if (type === 'success') {
      freqList = [
        { freq: 523.25, dur: 0.12, offset: 0.00 }, // C5
        { freq: 659.25, dur: 0.12, offset: 0.09 }, // E5
        { freq: 783.99, dur: 0.14, offset: 0.18 }, // G5
        { freq: 1046.50, dur: 0.38, offset: 0.27 }, // C6
        { freq: 1318.51, dur: 0.32, offset: 0.34 }, // E6
      ];
    } else if (type === 'error') {
      freqList = [
        { freq: 369.99, dur: 0.18, offset: 0.00 },
        { freq: 293.66, dur: 0.32, offset: 0.15 },
      ];
    } else if (type === 'bubble') {
      freqList = [
        { freq: 500, dur: 0.08, offset: 0.00 },
        { freq: 980, dur: 0.12, offset: 0.05 },
      ];
    } else {
      // click
      freqList = [{ freq: 880, dur: 0.05, offset: 0.00 }];
    }

    const totalDuration = Math.max(...freqList.map(f => f.offset + f.dur)) + 0.06;
    const numSamples = Math.floor(sampleRate * totalDuration);
    const buffer = new Uint8Array(44 + numSamples * 2);
    const view = new DataView(buffer.buffer);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + numSamples * 2, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // 1 channel (mono)
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // 16-bit
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, numSamples * 2, true);

    const samples = new Float32Array(numSamples);
    for (const note of freqList) {
      const startSample = Math.floor(note.offset * sampleRate);
      const noteSampleCount = Math.floor(note.dur * sampleRate);
      for (let i = 0; i < noteSampleCount && startSample + i < numSamples; i++) {
        const t = i / sampleRate;
        const env = Math.sin((i / noteSampleCount) * Math.PI); // half-sine envelope
        const s = Math.sin(2 * Math.PI * note.freq * t) * env * vol * 0.85;
        samples[startSample + i] += s;
      }
    }

    for (let i = 0; i < numSamples; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      const intVal = clamped < 0 ? clamped * 32768 : clamped * 32767;
      view.setInt16(44 + i * 2, intVal, true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = Math.max(0.1, Math.min(1.0, vol));
    audio.play().catch(e => console.warn('[Alisa Audio] Fallback audio playback failed:', e));
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  } catch (err) {
    console.warn('[Alisa Audio] Error generating fallback WAV:', err);
  }
}

/**
 * Play a synthesized chime with boosted gain and guaranteed playback
 */
export async function playChime(
  type: ChimeType,
  options?: { force?: boolean; volume?: number }
): Promise<void> {
  const enabled = isSoundEnabled();
  if (!options?.force && !enabled) return;

  const currentVol = options?.volume ?? (options?.force && getSoundVolume() === 0 ? 80 : getSoundVolume());
  const volMultiplier = Math.max(0.15, currentVol / 100);

  try {
    const soundNode = await getAudioContext();
    if (!soundNode || soundNode.ctx.state !== 'running') {
      // AudioContext unavailable or couldn't resume — play immediate HTML5 Audio fallback
      playWavFallback(type, currentVol);
      return;
    }

    const { ctx, master } = soundNode;
    if (masterGain) {
      masterGain.gain.setValueAtTime(volMultiplier, ctx.currentTime);
    }

    // 25ms lookahead buffer so WebKit never drops the note attack
    const startTime = ctx.currentTime + 0.025;

    switch (type) {
      case 'start': {
        const notes = [
          { freq: 659.25, time: 0.00 }, // E5
          { freq: 830.61, time: 0.08 }, // G#5
          { freq: 987.77, time: 0.16 }, // B5
          { freq: 1318.51, time: 0.24 }, // E6
        ];

        notes.forEach(({ freq, time }) => {
          const t = startTime + time;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, t);

          const subOsc = ctx.createOscillator();
          const subGain = ctx.createGain();
          subOsc.type = 'sine';
          subOsc.frequency.setValueAtTime(freq * 0.5, t);

          const peak = 0.65;
          gain.gain.setValueAtTime(0.001, t);
          gain.gain.linearRampToValueAtTime(peak, t + 0.02);
          gain.gain.linearRampToValueAtTime(0.0001, t + 0.38);

          subGain.gain.setValueAtTime(0.001, t);
          subGain.gain.linearRampToValueAtTime(peak * 0.4, t + 0.02);
          subGain.gain.linearRampToValueAtTime(0.0001, t + 0.30);

          osc.connect(gain);
          subOsc.connect(subGain);
          gain.connect(master);
          subGain.connect(master);

          osc.start(t);
          subOsc.start(t);
          osc.stop(t + 0.40);
          subOsc.stop(t + 0.32);
        });
        break;
      }

      case 'success': {
        const notes = [
          { freq: 523.25, time: 0.00, dur: 0.25 },
          { freq: 659.25, time: 0.09, dur: 0.28 },
          { freq: 783.99, time: 0.18, dur: 0.32 },
          { freq: 1046.50, time: 0.28, dur: 0.60 },
          { freq: 1318.51, time: 0.35, dur: 0.55 },
        ];

        notes.forEach(({ freq, time, dur }) => {
          const t = startTime + time;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, t);

          const peak = 0.65;
          gain.gain.setValueAtTime(0.001, t);
          gain.gain.linearRampToValueAtTime(peak, t + 0.02);
          gain.gain.linearRampToValueAtTime(0.0001, t + dur);

          osc.connect(gain);
          gain.connect(master);

          osc.start(t);
          osc.stop(t + dur + 0.02);
        });
        break;
      }

      case 'error': {
        const notes = [369.99, 293.66];
        notes.forEach((freq, index) => {
          const t = startTime + index * 0.15;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';

          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1100, t);

          osc.frequency.setValueAtTime(freq, t);

          const peak = 0.55;
          gain.gain.setValueAtTime(0.001, t);
          gain.gain.linearRampToValueAtTime(peak, t + 0.02);
          gain.gain.linearRampToValueAtTime(0.0001, t + 0.35);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(master);

          osc.start(t);
          osc.stop(t + 0.38);
        });
        break;
      }

      case 'bubble': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(450, startTime);
        try {
          osc.frequency.exponentialRampToValueAtTime(1200, startTime + 0.08);
        } catch {
          osc.frequency.linearRampToValueAtTime(1200, startTime + 0.08);
        }

        const peak = 0.7;
        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(peak, startTime + 0.02);
        gain.gain.linearRampToValueAtTime(0.0001, startTime + 0.18);

        osc.connect(gain);
        gain.connect(master);

        osc.start(startTime);
        osc.stop(startTime + 0.20);
        break;
      }

      case 'click': {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, startTime);
        try {
          osc.frequency.exponentialRampToValueAtTime(350, startTime + 0.035);
        } catch {
          osc.frequency.linearRampToValueAtTime(350, startTime + 0.035);
        }

        const peak = 0.5;
        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(peak, startTime + 0.008);
        gain.gain.linearRampToValueAtTime(0.0001, startTime + 0.05);

        osc.connect(gain);
        gain.connect(master);

        osc.start(startTime);
        osc.stop(startTime + 0.06);
        break;
      }
    }
  } catch (err) {
    console.warn('[Alisa Audio] Web Audio failed, falling back to HTML5 Audio:', err);
    playWavFallback(type, currentVol);
  }
}
