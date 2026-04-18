import { BASE_DECAY_S, VOLUME_DECAY_SCALE_S } from "../constants.js";
import type { Scene, CameraState, PredictionResult, Vec2, CollisionEvent } from "../scene/types.js";

const GRID_SIZE = 40;
const BALL_COLOR = "#4a90d9";
const BLOCK_COLOR = "#888888";
const MUSIC_BLOCK_COLOR = "#7b5ea7";
const SELECTED_COLOR = "#f5c518";
const RIPPLE_COLOR_RGB = "247, 185, 24"; // 金黄色，与选中高亮呼应

interface Ripple {
  x: number;
  y: number;
  volume: number;
  baseRadius: number;
  createdAt: number;
  duration: number; // ms
}

/** 预测轨迹颜色池（与 TimelineStaffRenderer 颜色保持一致） */
export const TRAJECTORY_COLORS = [
  "#4a90d9", // 蓝（单球默认）
  "#e67e22", // 橙
  "#2ecc71", // 绿
  "#e74c3c", // 红
  "#9b59b6" // 紫
];

export class CanvasRenderer {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D;
  private _predictionEnabled = true;

  /** L6: 活跃的脉冲环列表 */
  private readonly _activeRipples: Ripple[] = [];
  /** L6: 音乐方块位置缓存（上一帧渲染时更新），供 processCollisionEffects 查找 */
  private readonly _musicBlockPositions = new Map<string, { x: number; y: number }>();

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to get 2D context from canvas");
    this._ctx = ctx;
  }

  /**
   * L6: 处理碰撞事件，创建脉冲环动画实例。
   * 由 GameApp 在 AudioEngine.processCollisions 之后（仅 play 态）调用。
   * 衰减时长与 PianoSynth voice 衰减公式同源。
   */
  processCollisionEffects(events: CollisionEvent[]): void {
    if (events.length === 0) return;
    const now = performance.now();
    for (const event of events) {
      const pos = this._musicBlockPositions.get(event.musicBlockId);
      if (!pos) continue;
      const duration = (BASE_DECAY_S + event.volume * VOLUME_DECAY_SCALE_S) * 1000;
      this._activeRipples.push({
        x: pos.x,
        y: pos.y,
        volume: event.volume,
        baseRadius: 20 + event.volume * 20,
        createdAt: now,
        duration
      });
    }
  }

  disablePredictionLayer(): void {
    this._predictionEnabled = false;
  }

  enablePredictionLayer(): void {
    this._predictionEnabled = true;
  }

  /** T070: 退出播放态时清除所有残留脉冲环，防止编辑态仍显示播放特效 */
  clearRipples(): void {
    this._activeRipples.length = 0;
  }

  render(scene: Scene, cameraState: CameraState, predictionResult: PredictionResult | null, physicsPositions?: Map<string, Vec2>): void {
    const { _canvas: canvas, _ctx: ctx } = this;
    const { width, height } = canvas;

    ctx.clearRect(0, 0, width, height);

    ctx.save();

    // 应用相机变换：平移到中心，缩放，再偏移到相机位置
    ctx.translate(width / 2, height / 2);
    ctx.scale(cameraState.zoom, cameraState.zoom);
    ctx.translate(-cameraState.cx, -cameraState.cy);

    // L0: 背景网格
    this._drawGrid(ctx, cameraState, width, height);

    // L1: 静态方块（灰色）
    for (const entity of scene.entities) {
      if (entity.kind === "block") {
        ctx.save();
        ctx.translate(entity.x, entity.y);
        ctx.rotate(entity.rotation);
        ctx.fillStyle = BLOCK_COLOR;
        ctx.fillRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 1;
        ctx.strokeRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);
        ctx.restore();
      }
    }

    // L2: 音乐方块（紫色 + 中心白色音名文字），同时更新位置缓存供 L6 使用
    this._musicBlockPositions.clear();
    for (const entity of scene.entities) {
      if (entity.kind === "music-block") {
        this._musicBlockPositions.set(entity.id, { x: entity.x, y: entity.y });
        ctx.save();
        ctx.translate(entity.x, entity.y);
        ctx.fillStyle = MUSIC_BLOCK_COLOR;
        ctx.fillRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);
        ctx.strokeStyle = "#5a3a87";
        ctx.lineWidth = 1;
        ctx.strokeRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);

        ctx.fillStyle = "#ffffff";
        ctx.font = `${Math.max(10, entity.height * 0.6)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(entity.noteName, 0, 0);
        ctx.restore();
      }
    }

    // L3: 小球（多球使用颜色池区分）
    let ballIndex = 0;
    for (const entity of scene.entities) {
      if (entity.kind === "ball") {
        const pos = physicsPositions?.get(entity.id);
        const bx = pos?.x ?? entity.x;
        const by = pos?.y ?? entity.y;
        const ballColor = TRAJECTORY_COLORS[ballIndex % TRAJECTORY_COLORS.length];
        const isSelected = entity.id === scene.selectedBallId;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, entity.radius, 0, Math.PI * 2);
        ctx.fillStyle = ballColor;
        ctx.fill();
        ctx.strokeStyle = isSelected ? SELECTED_COLOR : "#2a60a9";
        ctx.lineWidth = isSelected ? 2 : 1.5;
        ctx.stroke();

        // 多球时在球旁显示编号标识（与 TimelineStaffRenderer 谱线颜色一致）
        if (scene.entities.filter(e => e.kind === "ball").length > 1) {
          ctx.fillStyle = "#ffffff";
          ctx.font = `bold ${Math.max(9, entity.radius * 0.7)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(ballIndex + 1), bx, by);
        }

        ctx.restore();
        ballIndex++;
      }
    }

    // L4: 选中高亮（虚线黄色轮廓）
    if (scene.selectedBallId) {
      const selected = scene.entities.find(e => e.id === scene.selectedBallId);
      if (selected) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = SELECTED_COLOR;
        ctx.lineWidth = 2;

        if (selected.kind === "ball") {
          ctx.beginPath();
          ctx.arc(selected.x, selected.y, selected.radius + 4, 0, Math.PI * 2);
          ctx.stroke();
        } else if (selected.kind === "block") {
          ctx.translate(selected.x, selected.y);
          ctx.rotate(selected.rotation);
          ctx.strokeRect(-selected.width / 2 - 4, -selected.height / 2 - 4, selected.width + 8, selected.height + 8);
        } else if (selected.kind === "music-block") {
          // MusicBlock 选中高亮：虚线矩形轮廓
          ctx.translate(selected.x, selected.y);
          ctx.strokeRect(-selected.width / 2 - 4, -selected.height / 2 - 4, selected.width + 8, selected.height + 8);

          // 在实体左上角额外标注当前音名（防遮挡中心文字）
          ctx.setLineDash([]);
          ctx.fillStyle = SELECTED_COLOR;
          ctx.font = "11px sans-serif";
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillText(selected.noteName, -selected.width / 2 - 4, -selected.height / 2 - 6);
        }
        ctx.restore();
      }
    }

    // L5: 预测线（虚线，仅编辑态且有预测结果时渲染 — T037）
    if (this._predictionEnabled && predictionResult) {
      this._drawPredictionTrajectories(ctx, predictionResult.trajectories);
    }

    // L6: 音乐活动脉冲环特效（T068）
    this._drawRipples(ctx);

    ctx.restore();
  }

  /** L6: 绘制并更新活跃脉冲环，完成的环从数组移除 */
  private _drawRipples(ctx: CanvasRenderingContext2D): void {
    if (this._activeRipples.length === 0) return;
    const now = performance.now();

    ctx.save();
    ctx.setLineDash([]);

    let i = this._activeRipples.length - 1;
    while (i >= 0) {
      const ripple = this._activeRipples[i];
      const elapsed = now - ripple.createdAt;
      if (elapsed >= ripple.duration) {
        this._activeRipples.splice(i, 1);
        i--;
        continue;
      }

      const progress = elapsed / ripple.duration;
      // 透明度：从 volume 线性衰减到 0
      const alpha = (1 - progress) * Math.min(1, ripple.volume + 0.3);
      // 半径：从 baseRadius 扩散到 baseRadius * 3
      const radius = ripple.baseRadius * (1 + progress * 2);

      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${RIPPLE_COLOR_RGB}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 2 * (1 - progress * 0.5);
      ctx.stroke();

      i--;
    }

    ctx.restore();
  }

  /** L5: 绘制各球的预测轨迹（虚线，半透明） */
  private _drawPredictionTrajectories(ctx: CanvasRenderingContext2D, trajectories: Map<string, { x: number; y: number }[]>): void {
    const ballIds = [...trajectories.keys()];
    if (ballIds.length === 0) return;

    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1.5;

    ballIds.forEach((ballId, idx) => {
      const points = trajectories.get(ballId);
      if (!points || points.length < 2) return;

      // 多球时使用颜色池区分，与小球本体颜色一致（Phase 4 单色，Phase 6 引入多色）
      ctx.strokeStyle = TRAJECTORY_COLORS[idx % TRAJECTORY_COLORS.length];

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    });

    ctx.restore();
  }

  private _drawGrid(ctx: CanvasRenderingContext2D, camera: CameraState, viewW: number, viewH: number): void {
    const step = GRID_SIZE;
    const left = camera.cx - viewW / (2 * camera.zoom);
    const top = camera.cy - viewH / (2 * camera.zoom);
    const right = camera.cx + viewW / (2 * camera.zoom);
    const bottom = camera.cy + viewH / (2 * camera.zoom);

    ctx.save();
    ctx.strokeStyle = "rgba(200,200,200,0.3)";
    ctx.lineWidth = 0.5 / camera.zoom;

    const startX = Math.floor(left / step) * step;
    const startY = Math.floor(top / step) * step;

    for (let x = startX; x <= right; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    for (let y = startY; y <= bottom; y += step) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
