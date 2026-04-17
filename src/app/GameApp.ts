import { ModeController } from './ModeController.js';
import { InputController } from './InputController.js';
import { SceneManager } from '../scene/SceneManager.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { PredictionEngine } from '../physics/PredictionEngine.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { PianoSynth } from '../audio/PianoSynth.js';
import { CanvasRenderer } from '../ui/CanvasRenderer.js';
import { TimelineStaffRenderer } from '../ui/TimelineStaffRenderer.js';
import { PanelRenderer } from '../ui/PanelRenderer.js';
import { HudRenderer } from '../ui/HudRenderer.js';
import { PHYSICS_CONFIG } from '../constants.js';
import type { CameraState, Scene } from '../scene/types.js';

export class GameApp {
  private readonly _modeController: ModeController;
  private readonly _sceneManager: SceneManager;
  private readonly _inputController: InputController;
  private readonly _physicsWorld: PhysicsWorld;
  private readonly _predictionEngine: PredictionEngine;
  private readonly _audioEngine: AudioEngine;
  private readonly _audioCtx: AudioContext;
  private readonly _canvasRenderer: CanvasRenderer;
  private readonly _timelineRenderer: TimelineStaffRenderer;
  private readonly _panelRenderer: PanelRenderer;
  private readonly _hudRenderer: HudRenderer;
  private readonly _camera: CameraState;

  private _rafId = 0;
  private _lastTimestamp = 0;
  /** 进入播放态前的场景深拷贝快照，退出时用于恢复实体初始位置 */
  private _playSnapshot: Scene | null = null;

  private constructor(
    modeController: ModeController,
    sceneManager: SceneManager,
    inputController: InputController,
    physicsWorld: PhysicsWorld,
    predictionEngine: PredictionEngine,
    audioEngine: AudioEngine,
    audioCtx: AudioContext,
    canvasRenderer: CanvasRenderer,
    timelineRenderer: TimelineStaffRenderer,
    panelRenderer: PanelRenderer,
    hudRenderer: HudRenderer,
    camera: CameraState,
  ) {
    this._modeController = modeController;
    this._sceneManager = sceneManager;
    this._inputController = inputController;
    this._physicsWorld = physicsWorld;
    this._predictionEngine = predictionEngine;
    this._audioEngine = audioEngine;
    this._audioCtx = audioCtx;
    this._canvasRenderer = canvasRenderer;
    this._timelineRenderer = timelineRenderer;
    this._panelRenderer = panelRenderer;
    this._hudRenderer = hudRenderer;
    this._camera = camera;

    // 订阅模式变更（同步触发）
    this._modeController.onModeChange((mode) => {
      if (mode === 'play') {
        this._onEnterPlay();
      } else {
        this._onEnterEdit();
      }
    });
  }

  /**
   * 工厂方法：初始化所有子系统，建立 AudioContext 授权逻辑。
   */
  static async create(): Promise<GameApp> {
    const mainCanvas = document.getElementById('main-canvas') as HTMLCanvasElement;
    const hudContainer = document.getElementById('hud-container') as HTMLElement;
    const panelContainer = document.getElementById('panel-container') as HTMLElement;
    const timelineCanvasEl = document.getElementById('timeline-canvas') as HTMLCanvasElement;

    // 设置主画布像素尺寸与 CSS 布局一致
    mainCanvas.width = window.innerWidth;
    mainCanvas.height = window.innerHeight - 120;

    // 设置 timeline canvas 尺寸
    timelineCanvasEl.width = window.innerWidth;
    timelineCanvasEl.height = 120;

    const modeController = new ModeController();
    const sceneManager = new SceneManager();
    const physicsWorld = new PhysicsWorld();
    const synth = new PianoSynth();

    // AudioContext 初始通常为 suspended（浏览器自动播放策略）
    const audioCtx = new AudioContext();
    const audioEngine = new AudioEngine(audioCtx, synth);

    const canvasRenderer = new CanvasRenderer(mainCanvas);
    const timelineRenderer = new TimelineStaffRenderer(timelineCanvasEl);
    const panelRenderer = new PanelRenderer(panelContainer);
    const hudRenderer = new HudRenderer(hudContainer);

    // 创建 PredictionEngine（T034）
    const predictionEngine = new PredictionEngine(sceneManager);

    // T035: 将预测引擎注入 SceneManager，使场景变更自动触发 markDirty()
    sceneManager.setPredictionEngine(predictionEngine);

    // 共享相机状态（US4 CameraFollowController 接管前作为固定相机）
    const camera: CameraState = { cx: 0, cy: 0, zoom: 1, followBallId: null };

    const inputController = new InputController(mainCanvas, modeController, sceneManager);
    inputController.setAudioEngine(audioEngine);
    inputController.setCameraStateGetter(() => camera);
    inputController.setPanelRenderer(panelRenderer);

    // AudioContext 再次被挂起时通过 tryResume() 重试
    audioCtx.addEventListener('statechange', () => {
      if (audioCtx.state === 'suspended') {
        audioEngine.tryResume();
      }
      hudRenderer.update(modeController.mode, undefined, audioCtx.state === 'suspended');
    });

    const app = new GameApp(
      modeController,
      sceneManager,
      inputController,
      physicsWorld,
      predictionEngine,
      audioEngine,
      audioCtx,
      canvasRenderer,
      timelineRenderer,
      panelRenderer,
      hudRenderer,
      camera,
    );

    // 初始 HUD
    hudRenderer.update('edit', undefined, audioCtx.state === 'suspended');

    // 启动时触发一次预测（场景初始为空，结果为空轨迹，但使 Timeline 正确显示空谱线）
    predictionEngine.invalidate();

    // 窗口缩放时同步 canvas 像素尺寸
    window.addEventListener('resize', () => {
      mainCanvas.width = window.innerWidth;
      mainCanvas.height = window.innerHeight - 120;
      timelineCanvasEl.width = window.innerWidth;
      timelineCanvasEl.height = 120;
    });

    return app;
  }

  start(): void {
    this._lastTimestamp = performance.now();
    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }

  stop(): void {
    cancelAnimationFrame(this._rafId);
  }

  // ──────────────────────────────────────────────────────────────
  // 模式切换序列（严格按 plan.md / GDD 06 顺序）
  // ──────────────────────────────────────────────────────────────

  /** Edit → Play（T027 + T036 + T045） */
  private _onEnterPlay(): void {
    // 步骤 1: 锁定编辑输入
    this._inputController.lockEditing();
    // 步骤 2: 隐藏右侧面板（T045）
    this._panelRenderer.hide();
    // 步骤 3: 隐藏底部 Timeline（T039）
    this._timelineRenderer.hide();
    // 步骤 4: 停止预测线渲染（T036）
    this._canvasRenderer.disablePredictionLayer();
    // 步骤 5: 停止预测计算（T036）
    this._predictionEngine.pause();
    // 步骤 6: CameraFollowController.resolveCameraTarget() — Phase 6 (T052) stub

    // 步骤 7: 快照当前场景（退出播放时恢复实体位置），加载到物理引擎并启动
    this._playSnapshot = JSON.parse(JSON.stringify(this._sceneManager.getScene())) as Scene;
    this._physicsWorld.loadScene(this._sceneManager.getScene());
    this._physicsWorld.start();

    // 步骤 8: AudioEngine 进入监听态（内部调用 tryResume()）
    this._audioEngine.listen();

    this._hudRenderer.update('play', undefined, this._audioCtx.state === 'suspended');
  }

  /** Play → Edit（T027 + T036 + T045） */
  private _onEnterEdit(): void {
    // 步骤 1: 停止物理步进
    this._physicsWorld.stop();
    // 步骤 2: 停止新触发（已发声 voice 自然衰减）
    this._audioEngine.stopListening();
    // 步骤 3: 解锁编辑输入
    this._inputController.unlockEditing();
    // 步骤 4: 显示右侧面板（T045）
    this._panelRenderer.show();
    // 步骤 5: 恢复预测计算（T036）
    this._predictionEngine.resume();
    // 步骤 6: 显示底部 Timeline（T039）
    this._timelineRenderer.show();
    // 步骤 7: 强制触发一次预测重算（T036），跳过去抖
    this._predictionEngine.invalidate();
    // 步骤 8: LocalSaveRepository.forceSave() — Phase 7 stub

    // 恢复实体位置到播放前快照
    if (this._playSnapshot) {
      this._sceneManager.loadScene(this._playSnapshot);
      this._playSnapshot = null;
    }

    this._canvasRenderer.enablePredictionLayer();
    this._hudRenderer.update('edit', undefined, this._audioCtx.state === 'suspended');
  }

  // ──────────────────────────────────────────────────────────────
  // 主循环（帧序 1~10）
  // ──────────────────────────────────────────────────────────────

  private _loop(timestamp: number): void {
    this._lastTimestamp = timestamp;

    // 帧序步骤 1: 输入处理（事件驱动）
    this._inputController.process();

    // 帧序步骤 2: ModeController.flushPending() — 已通过 onModeChange 同步处理

    // 帧序步骤 3: [仅 edit] PredictionEngine 由 markDirty() + setTimeout 去抖驱动，
    // 不需要在帧序中额外调用（T035）

    const mode = this._modeController.mode;

    // 帧序步骤 4: [仅 play] PhysicsWorld.step(FIXED_DT_MS)
    if (mode === 'play') {
      this._physicsWorld.step(PHYSICS_CONFIG.FIXED_DT_MS);

      // 将物理引擎中小球的实时位置同步到 SceneManager 实体（供 CanvasRenderer 渲染正确位置）
      const ballPositions = this._physicsWorld.getBallPositions();
      const scene = this._sceneManager.getScene();
      for (const entity of scene.entities) {
        if (entity.kind === 'ball') {
          const pos = ballPositions.get(entity.id);
          if (pos) {
            entity.x = pos.x;
            entity.y = pos.y;
          }
        }
      }
    }

    // 帧序步骤 5: [仅 play] AudioEngine.processCollisions()
    if (mode === 'play') {
      const events = this._physicsWorld.getCollisionEvents();
      this._audioEngine.processCollisions(events);
    }

    // 帧序步骤 6: CameraFollowController.update() — Phase 6 (T052) stub

    // 帧序步骤 7: CanvasRenderer.render()（T037: 传入 predictionResult）
    this._canvasRenderer.render(
      this._sceneManager.getScene(),
      this._camera,
      this._predictionEngine.getLatestResult(),
    );

    // 帧序步骤 8: TimelineStaffRenderer.render()（T039）
    const predResult = this._predictionEngine.getLatestResult();
    this._timelineRenderer.render(predResult?.predictedNotes ?? [], mode);

    // 帧序步骤 9: PanelRenderer.update() + HudRenderer.update()（T045）
    const selectedId = this._sceneManager.getSelectedId();
    const selectedEntity = selectedId
      ? (this._sceneManager.getScene().entities.find((e) => e.id === selectedId) ?? null)
      : null;
    this._panelRenderer.update(selectedEntity, this._inputController.activeTool);
    // HUD 每帧更新（audio state 可能变化）
    this._hudRenderer.update(mode, undefined, this._audioCtx.state === 'suspended');

    // 帧序步骤 10: LocalSaveRepository.tick() — Phase 7 (T062) stub

    // ── E2E 专用调试状态（window.__debugState，每帧写入）──────────
    const scene = this._sceneManager.getScene();
    window.__debugState = {
      mode,
      audioEngine: {
        activeVoiceCount: this._audioEngine.activeVoiceCount,
        totalCollisionEventsReceived: this._audioEngine.totalCollisionEventsReceived,
      },
      entityCount: scene.entities.length,
      entities: scene.entities.map((e) => ({
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
      })),
      physicsRunning: mode === 'play',
      prediction: predResult
        ? {
            noteCount: predResult.predictedNotes.length,
            trajBallCount: predResult.trajectories.size,
            computedAt: predResult.computedAt,
            lastComputeMs: this._predictionEngine.lastComputeMs,
            notes: predResult.predictedNotes.map((n) => ({
              timeMs: n.timeMs,
              noteName: n.noteName,
              ballId: n.ballId,
              musicBlockId: n.musicBlockId,
            })),
          }
        : null,
    };

    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }
}
