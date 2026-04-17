import { PHYSICS_CONFIG, PREDICTION_MAX_STEPS } from '../constants.js';
import type { PredictedNote, AppMode } from '../scene/types.js';
import { TRAJECTORY_COLORS } from './CanvasRenderer.js';

// ─── 音名解析 ────────────────────────────────────────────────────────────────

const SEMITONES_FROM_C: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/**
 * 将音名字符串解析为相对 C4 的半音数。
 * C4 = 0，D4 = 2，C5 = 12，B3 = -1，等。
 * 解析失败时返回 0（映射到 C4 中央）。
 */
function noteNameToSemitoneFromC4(noteName: string): number {
  const match = noteName.match(/^([A-G])([#b]?)(\d+)$/);
  if (!match) return 0;

  const letter = match[1];
  const accidental = match[2];
  const octave = parseInt(match[3], 10);

  const semitonesFromC = SEMITONES_FROM_C[letter] ?? 0;
  const acc = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;

  // MIDI: C4 = 60 = (4+1)*12
  const midi = (octave + 1) * 12 + semitonesFromC + acc;
  const c4Midi = 60;
  return midi - c4Midi;
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const MAX_TIME_MS = PREDICTION_MAX_STEPS * PHYSICS_CONFIG.FIXED_DT_MS;

/** 每半音对应的纵轴像素数（值越大音符间距越大） */
const PIXELS_PER_SEMITONE = 2.5;

/** 显示音域：C4 上下各 14 个半音（约 C3 ~ B4），超出范围的音符依然绘制但会溢出 */
const SEMITONE_DISPLAY_RANGE = 14;

/** 五线谱轨道内 staff 的相对高度比例（0~1） */
const STAFF_HEIGHT_RATIO = 0.55;

/** 音符头椭圆的基础半径（像素） */
const NOTE_HEAD_BASE_R = 4;

// ─── 五线谱渲染器 ─────────────────────────────────────────────────────────────

export class TimelineStaffRenderer {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to get 2D context from timeline-canvas');
    this._ctx = ctx;
  }

  hide(): void {
    this._canvas.style.display = 'none';
  }

  show(): void {
    this._canvas.style.display = '';
  }

  /**
   * 渲染五线谱。
   * - play 态：清空后直接返回（不渲染）
   * - edit 态：按 ballId 分组，每组渲染一行谱线
   */
  render(predictedNotes: PredictedNote[], mode: AppMode): void {
    const { _canvas: canvas, _ctx: ctx } = this;
    const { width, height } = canvas;

    ctx.clearRect(0, 0, width, height);

    if (mode === 'play') return;

    // 收集所有出现的 ballId（保持稳定顺序）
    const ballIds = this._collectBallIds(predictedNotes);

    // 绘制背景
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    const trackCount = Math.max(1, ballIds.length);
    const trackHeight = height / trackCount;

    if (ballIds.length === 0) {
      // 没有任何球：显示一行空谱线
      this._drawStaffLines(ctx, 0, trackHeight, TRAJECTORY_COLORS[0]);
      return;
    }

    for (let i = 0; i < ballIds.length; i++) {
      const ballId = ballIds[i];
      const trackY = i * trackHeight;
      const color = TRAJECTORY_COLORS[i % TRAJECTORY_COLORS.length];
      const trackNotes = predictedNotes.filter((n) => n.ballId === ballId);

      this._drawTrack(ctx, trackY, trackHeight, ballId, trackNotes, color, width);
    }
  }

  // ─── 私有辅助 ───────────────────────────────────────────────────────────────

  private _collectBallIds(notes: PredictedNote[]): string[] {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const note of notes) {
      if (!seen.has(note.ballId)) {
        seen.add(note.ballId);
        ids.push(note.ballId);
      }
    }
    return ids;
  }

  private _drawTrack(
    ctx: CanvasRenderingContext2D,
    trackY: number,
    trackHeight: number,
    ballId: string,
    notes: PredictedNote[],
    color: string,
    canvasWidth: number,
  ): void {
    // 轨道分隔线
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, trackY);
    ctx.lineTo(canvasWidth, trackY);
    ctx.stroke();

    // 绘制五线谱线
    this._drawStaffLines(ctx, trackY, trackHeight, color);

    // 绘制球标识文字（左侧）
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.font = `10px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(ballId.slice(-4), 4, trackY + 2); // 显示 ID 末 4 位
    ctx.globalAlpha = 1;

    // 绘制音符头
    const staffCenter = trackY + trackHeight / 2;

    for (const note of notes) {
      const x = (note.timeMs / MAX_TIME_MS) * canvasWidth;
      const semitone = noteNameToSemitoneFromC4(note.noteName);
      // 音越高 → y 越小（Canvas Y 轴向下）
      const y = staffCenter - semitone * PIXELS_PER_SEMITONE;
      const rX = NOTE_HEAD_BASE_R + note.volume * 2;
      const rY = NOTE_HEAD_BASE_R * 0.65;
      const alpha = 0.4 + note.volume * 0.6;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, rX, rY, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private _drawStaffLines(
    ctx: CanvasRenderingContext2D,
    trackY: number,
    trackHeight: number,
    color: string,
  ): void {
    const staffHeight = trackHeight * STAFF_HEIGHT_RATIO;
    const staffTop = trackY + (trackHeight - staffHeight) / 2;
    const lineSpacing = staffHeight / 4; // 5 条线 = 4 段间距

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 0.8;

    for (let i = 0; i < 5; i++) {
      const lineY = staffTop + i * lineSpacing;
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(this._canvas.width, lineY);
      ctx.stroke();
    }

    ctx.restore();
  }
}
