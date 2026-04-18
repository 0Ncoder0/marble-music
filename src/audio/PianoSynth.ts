import { BASE_DECAY_S, VOLUME_DECAY_SCALE_S } from "../constants.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const ENHARMONICS: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Fb: "E",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
  Cb: "B"
};

/** 将音名转换为 MIDI 编号，再映射到频率（十二平均律）。*/
export function noteNameToFrequency(noteName: string): number {
  const match = /^([A-G][#b]?)(-?\d+)$/.exec(noteName.trim());
  if (!match) {
    throw new Error(`Invalid note name: "${noteName}"`);
  }

  let noteBase = match[1];
  const octave = parseInt(match[2], 10);

  // 还原等音异名
  if (noteBase in ENHARMONICS) {
    noteBase = ENHARMONICS[noteBase];
  }

  const semitone = NOTE_NAMES.indexOf(noteBase as (typeof NOTE_NAMES)[number]);
  if (semitone === -1) {
    throw new Error(`Unknown note base: "${noteBase}"`);
  }

  // C4 = MIDI 60；C0 = 12
  const midiNote = (octave + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

/**
 * 创建一个独立的钢琴音符 voice。
 * Attack: 8ms 线性上升至 volume
 * Decay: (BASE_DECAY_S + volume * VOLUME_DECAY_SCALE_S) 秒指数衰减至 0.001
 * 衰减结束后 stop() → disconnect() → 调用 onEnded
 */
export function createVoice(noteName: string, volume: number, audioCtx: AudioContext, onEnded: () => void): void {
  const freq = noteNameToFrequency(noteName);
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.value = freq;

  const attackDuration = 0.008; // 8ms
  const decayDuration = BASE_DECAY_S + volume * VOLUME_DECAY_SCALE_S;
  const stopTime = now + attackDuration + decayDuration;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + attackDuration);
  gain.gain.exponentialRampToValueAtTime(0.001, stopTime);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(stopTime);
  osc.addEventListener("ended", () => {
    osc.disconnect();
    gain.disconnect();
    onEnded();
  });
}

export class PianoSynth {
  noteNameToFrequency(noteName: string): number {
    return noteNameToFrequency(noteName);
  }

  createVoice(noteName: string, volume: number, audioCtx: AudioContext, onEnded: () => void): void {
    createVoice(noteName, volume, audioCtx, onEnded);
  }
}
