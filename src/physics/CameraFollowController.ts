import { FOLLOW_LERP } from '../constants.js';
import type { CameraState, Vec2 } from '../scene/types.js';

/**
 * 相机跟随控制器 — US4 T050
 *
 * C5 门禁：followBallId 仅在 resolveCameraTarget()（startPlay 时）设置，播放中不重判。
 *
 * 手动操作策略：applyManualPan / applyZoom 直接修改相机状态，不清除 followBallId。
 * 若处于跟随状态，跟随 lerp 每帧仍继续生效（手动平移量被逐渐吸收）。
 * 允许简单实现："手动操作直接改相机状态，不强制恢复跟随"符合 tasks.md 约束。
 */
export class CameraFollowController {
  private readonly _state: CameraState;

  constructor(initialCx = 0, initialCy = 0, initialZoom = 1) {
    this._state = {
      cx: initialCx,
      cy: initialCy,
      zoom: initialZoom,
      followBallId: null,
    };
  }

  getCameraState(): CameraState {
    return this._state;
  }

  /**
   * C5 门禁：仅在 startPlay() 时调用一次。
   * 若 selectedBallId 存在则启用跟随，否则 followBallId 保持 null（不跟随）。
   */
  resolveCameraTarget(selectedBallId: string | null): void {
    this._state.followBallId = selectedBallId;
  }

  /**
   * 每帧调用（仅播放态有意义；编辑态 followBallId 为 null，安全跳过）。
   * 使用 FOLLOW_LERP 平滑插值追踪目标球位置。
   */
  update(ballPositions: Map<string, Vec2>): void {
    if (!this._state.followBallId) return;
    const pos = ballPositions.get(this._state.followBallId);
    if (!pos) return;

    this._state.cx += (pos.x - this._state.cx) * FOLLOW_LERP;
    this._state.cy += (pos.y - this._state.cy) * FOLLOW_LERP;
  }

  /**
   * 手动平移（dx/dy 为世界坐标增量）。
   * 规格：直接修改 cx/cy，不清除 followBallId。
   */
  applyManualPan(dx: number, dy: number): void {
    this._state.cx += dx;
    this._state.cy += dy;
  }

  /** 缩放，限制在 [0.2, 5.0] */
  applyZoom(delta: number): void {
    this._state.zoom = Math.max(0.2, Math.min(5.0, this._state.zoom + delta));
  }

  /** 停止跟随（play → edit 时调用） */
  stopFollow(): void {
    this._state.followBallId = null;
  }
}
