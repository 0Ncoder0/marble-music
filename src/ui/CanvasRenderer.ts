import type { Scene, CameraState, PredictionResult, Vec2 } from '../scene/types.js';

const GRID_SIZE = 40;
const BALL_COLOR = '#4a90d9';
const BLOCK_COLOR = '#888888';
const MUSIC_BLOCK_COLOR = '#7b5ea7';
const SELECTED_COLOR = '#f5c518';

/** 预测轨迹颜色池（与 TimelineStaffRenderer 颜色保持一致） */
export const TRAJECTORY_COLORS = [
  '#4a90d9', // 蓝（单球默认）
  '#e67e22', // 橙
  '#2ecc71', // 绿
  '#e74c3c', // 红
  '#9b59b6', // 紫
];

export class CanvasRenderer {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D;
  private _predictionEnabled = true;

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to get 2D context from canvas');
    this._ctx = ctx;
  }

  disablePredictionLayer(): void {
    this._predictionEnabled = false;
  }

  enablePredictionLayer(): void {
    this._predictionEnabled = true;
  }

  render(
    scene: Scene,
    cameraState: CameraState,
    predictionResult: PredictionResult | null,
    physicsPositions?: Map<string, Vec2>,
  ): void {
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
      if (entity.kind === 'block') {
        ctx.save();
        ctx.translate(entity.x, entity.y);
        ctx.rotate(entity.rotation);
        ctx.fillStyle = BLOCK_COLOR;
        ctx.fillRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.strokeRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);
        ctx.restore();
      }
    }

    // L2: 音乐方块（紫色 + 中心白色音名文字）
    for (const entity of scene.entities) {
      if (entity.kind === 'music-block') {
        ctx.save();
        ctx.translate(entity.x, entity.y);
        ctx.fillStyle = MUSIC_BLOCK_COLOR;
        ctx.fillRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);
        ctx.strokeStyle = '#5a3a87';
        ctx.lineWidth = 1;
        ctx.strokeRect(-entity.width / 2, -entity.height / 2, entity.width, entity.height);

        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.max(10, entity.height * 0.6)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(entity.noteName, 0, 0);
        ctx.restore();
      }
    }

    // L3: 小球（蓝色圆形）——播放态使用 physicsPositions，编辑态使用 entity 坐标
    for (const entity of scene.entities) {
      if (entity.kind === 'ball') {
        const pos = physicsPositions?.get(entity.id);
        const bx = pos?.x ?? entity.x;
        const by = pos?.y ?? entity.y;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, entity.radius, 0, Math.PI * 2);
        ctx.fillStyle = BALL_COLOR;
        ctx.fill();
        ctx.strokeStyle = '#2a60a9';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    }

    // L4: 选中高亮（虚线黄色轮廓）
    if (scene.selectedBallId) {
      const selected = scene.entities.find((e) => e.id === scene.selectedBallId);
      if (selected) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = SELECTED_COLOR;
        ctx.lineWidth = 2;

        if (selected.kind === 'ball') {
          ctx.beginPath();
          ctx.arc(selected.x, selected.y, selected.radius + 4, 0, Math.PI * 2);
          ctx.stroke();
        } else if (selected.kind === 'block' || selected.kind === 'music-block') {
          ctx.translate(selected.x, selected.y);
          if (selected.kind === 'block') ctx.rotate(selected.rotation);
          ctx.strokeRect(
            -selected.width / 2 - 4,
            -selected.height / 2 - 4,
            selected.width + 8,
            selected.height + 8,
          );
        }
        ctx.restore();
      }
    }

    // L5: 预测线（虚线，仅编辑态且有预测结果时渲染 — T037）
    if (this._predictionEnabled && predictionResult) {
      this._drawPredictionTrajectories(ctx, predictionResult.trajectories);
    }

    // L6: 音乐活动脉冲特效（stub — Phase 8 T068 填充）

    ctx.restore();
  }

  /** L5: 绘制各球的预测轨迹（虚线，半透明） */
  private _drawPredictionTrajectories(
    ctx: CanvasRenderingContext2D,
    trajectories: Map<string, { x: number; y: number }[]>,
  ): void {
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

  private _drawGrid(
    ctx: CanvasRenderingContext2D,
    camera: CameraState,
    viewW: number,
    viewH: number,
  ): void {
    const step = GRID_SIZE;
    const left = camera.cx - viewW / (2 * camera.zoom);
    const top = camera.cy - viewH / (2 * camera.zoom);
    const right = camera.cx + viewW / (2 * camera.zoom);
    const bottom = camera.cy + viewH / (2 * camera.zoom);

    ctx.save();
    ctx.strokeStyle = 'rgba(200,200,200,0.3)';
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
