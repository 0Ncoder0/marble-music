import { EntityFactory } from '../scene/EntityFactory.js';
import type { SceneManager } from '../scene/SceneManager.js';
import type { ModeController } from './ModeController.js';
import type { AudioEngine } from '../audio/AudioEngine.js';
import type { CameraState, Entity } from '../scene/types.js';

export type ActiveTool = 'ball' | 'block' | 'music-block' | 'select';

/**
 * 统一键鼠输入控制器。
 * - 编辑态：键盘工具切换、Space/Esc 模式切换、实体放置/选中/拖拽/删除
 * - 播放态：Space/Esc 停止播放；所有编辑操作被 isLocked() 阻断
 * - 首次 keydown / mousedown 调用 audioEngine.tryResume()（T028）
 */
export class InputController {
  private _locked = false;
  private _activeTool: ActiveTool = 'select';

  private readonly _canvas: HTMLCanvasElement;
  private readonly _modeController: ModeController;
  private readonly _sceneManager: SceneManager;
  private _audioEngine: AudioEngine | null = null;
  private _getCameraState: (() => CameraState) | null = null;

  private _isDragging = false;
  private _dragEntityId: string | null = null;
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  /** 是否已向 AudioEngine 发出首次 resume 请求 */
  private _firstInteractionDone = false;

  constructor(
    canvas: HTMLCanvasElement,
    modeController: ModeController,
    sceneManager: SceneManager,
  ) {
    this._canvas = canvas;
    this._modeController = modeController;
    this._sceneManager = sceneManager;
    this._registerListeners();
  }

  /** 注入 AudioEngine（T028：首次交互时统一调用 tryResume）*/
  setAudioEngine(audioEngine: AudioEngine): void {
    this._audioEngine = audioEngine;
  }

  /** 注入相机状态 getter，用于屏幕坐标→世界坐标转换 */
  setCameraStateGetter(getter: () => CameraState): void {
    this._getCameraState = getter;
  }

  get activeTool(): ActiveTool {
    return this._activeTool;
  }

  /** 进入播放态时调用：阻断所有编辑操作，取消进行中的拖拽 */
  lockEditing(): void {
    this._locked = true;
    this._isDragging = false;
    this._dragEntityId = null;
  }

  /** 返回编辑态时调用：恢复编辑操作权限 */
  unlockEditing(): void {
    this._locked = false;
  }

  isLocked(): boolean {
    return this._locked;
  }

  /** 每帧调用（事件已在监听器中同步处理，此处为框架占位） */
  process(): void {
    // 事件通过 addEventListener 同步处理，无需额外 flush
  }

  // ──────────────────────── 私有辅助 ────────────────────────

  private _tryResumeAudio(): void {
    if (!this._firstInteractionDone && this._audioEngine) {
      this._audioEngine.tryResume();
      this._firstInteractionDone = true;
    }
  }

  /**
   * 将浏览器视口坐标（clientX/Y）转换为世界坐标（逆相机变换）。
   * 注：#main-canvas 在布局中始终位于视口 (0,0)，clientX/Y 等于画布本地坐标。
   * 使用 canvas.width/height 属性（稳定可靠），避免 getBoundingClientRect()
   * 在 Playwright 早期帧或 CSS 未完成时返回零尺寸导致的坐标偏差。
   */
  private _toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this._canvas.getBoundingClientRect();
    // 优先使用 getBoundingClientRect 获取位置（处理非 0,0 偏移），
    // 但以 canvas.width/height 计算比例（避免 CSS 尺寸与 attr 尺寸不一致）
    const cssW = rect.width > 0 ? rect.width : this._canvas.width;
    const cssH = rect.height > 0 ? rect.height : this._canvas.height;
    const scaleX = this._canvas.width / cssW;
    const scaleY = this._canvas.height / cssH;
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;

    const cam = this._getCameraState?.() ?? { cx: 0, cy: 0, zoom: 1, followBallId: null };
    const worldX = (canvasX - this._canvas.width / 2) / cam.zoom + cam.cx;
    const worldY = (canvasY - this._canvas.height / 2) / cam.zoom + cam.cy;
    return { x: worldX, y: worldY };
  }

  /**
   * 实体命中检测（逆序遍历，优先检测最上层）。
   * Block 支持旋转，通过转换到本地坐标检测矩形边界。
   */
  private _hitTest(worldX: number, worldY: number): Entity | null {
    const entities = this._sceneManager.getScene().entities;
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.kind === 'ball') {
        if (Math.hypot(worldX - e.x, worldY - e.y) <= e.radius) return e;
      } else if (e.kind === 'block') {
        const dx = worldX - e.x;
        const dy = worldY - e.y;
        const cos = Math.cos(-e.rotation);
        const sin = Math.sin(-e.rotation);
        const lx = dx * cos - dy * sin;
        const ly = dx * sin + dy * cos;
        if (Math.abs(lx) <= e.width / 2 && Math.abs(ly) <= e.height / 2) return e;
      } else if (e.kind === 'music-block') {
        const dx = worldX - e.x;
        const dy = worldY - e.y;
        if (Math.abs(dx) <= e.width / 2 && Math.abs(dy) <= e.height / 2) return e;
      }
    }
    return null;
  }

  private _registerListeners(): void {
    window.addEventListener('keydown', this._onKeyDown.bind(this));
    window.addEventListener('mousedown', this._onMouseDown.bind(this));
    window.addEventListener('mousemove', this._onMouseMove.bind(this));
    window.addEventListener('mouseup', this._onMouseUp.bind(this));
    this._canvas.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
  }

  // ──────────────────────── 事件处理 ────────────────────────

  private _onKeyDown(e: KeyboardEvent): void {
    this._tryResumeAudio();

    // Space / Esc 在编辑态和播放态均响应（不受 isLocked 限制）
    if (e.code === 'Space') {
      e.preventDefault();
      if (this._modeController.mode === 'edit') {
        this._modeController.startPlay();
      } else {
        this._modeController.stopPlay();
      }
      return;
    }

    if (e.code === 'Escape') {
      if (this._modeController.mode === 'play') {
        this._modeController.stopPlay();
      } else {
        // 编辑态：取消当前工具选择（FR-009）
        this._activeTool = 'select';
      }
      return;
    }

    // 以下仅编辑态响应
    if (this._locked) return;

    switch (e.code) {
      case 'Digit1':
        this._activeTool = 'ball';
        break;
      case 'Digit2':
        this._activeTool = 'block';
        break;
      case 'Digit3':
        this._activeTool = 'music-block';
        break;
      case 'Delete':
      case 'Backspace': {
        const selectedId = this._sceneManager.getSelectedId();
        if (selectedId) {
          this._sceneManager.removeEntity(selectedId);
          // SceneManager.removeEntity 内部已清除 selectedBallId
        }
        break;
      }
    }
  }

  private _onMouseDown(e: MouseEvent): void {
    this._tryResumeAudio();

    if (e.button !== 0) return;
    if (this._locked) return;

    // 只处理落在主画布边界内的点击（通过坐标范围判断，比 target 检测更稳健）
    const rect = this._canvas.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      return;
    }

    const worldPos = this._toWorld(e.clientX, e.clientY);
    const hit = this._hitTest(worldPos.x, worldPos.y);

    if (hit) {
      // 点击已有实体：选中并准备拖拽
      this._sceneManager.setSelectedId(hit.id);
      this._isDragging = true;
      this._dragEntityId = hit.id;
      this._dragOffsetX = worldPos.x - hit.x;
      this._dragOffsetY = worldPos.y - hit.y;
    } else {
      // 点击空白区域：取消选中，若有工具则放置新实体
      this._sceneManager.setSelectedId(null);
      if (this._activeTool !== 'select') {
        const entity =
          this._activeTool === 'ball'
            ? EntityFactory.createBall(worldPos.x, worldPos.y)
            : this._activeTool === 'block'
              ? EntityFactory.createBlock(worldPos.x, worldPos.y)
              : EntityFactory.createMusicBlock(worldPos.x, worldPos.y);
        this._sceneManager.addEntity(entity);
        this._sceneManager.setSelectedId(entity.id);
      }
    }
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this._isDragging || !this._dragEntityId) return;
    if (this._locked) {
      // 播放态：取消拖拽（双重保险）
      this._isDragging = false;
      this._dragEntityId = null;
      return;
    }
    const worldPos = this._toWorld(e.clientX, e.clientY);
    this._sceneManager.updateEntity(this._dragEntityId, {
      x: worldPos.x - this._dragOffsetX,
      y: worldPos.y - this._dragOffsetY,
    });
  }

  private _onMouseUp(_e: MouseEvent): void {
    this._isDragging = false;
    this._dragEntityId = null;
  }

  private _onWheel(_e: WheelEvent): void {
    // Phase 4 (T051): 相机缩放
  }
}
