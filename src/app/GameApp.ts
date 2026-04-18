import { ModeController } from "./ModeController.js";
import { InputController } from "./InputController.js";
import { SceneManager } from "../scene/SceneManager.js";
import { PhysicsWorld } from "../physics/PhysicsWorld.js";
import { PredictionEngine } from "../physics/PredictionEngine.js";
import { CameraFollowController } from "../physics/CameraFollowController.js";
import { AudioEngine } from "../audio/AudioEngine.js";
import { PianoSynth } from "../audio/PianoSynth.js";
import { CanvasRenderer } from "../ui/CanvasRenderer.js";
import { TimelineStaffRenderer } from "../ui/TimelineStaffRenderer.js";
import { PanelRenderer } from "../ui/PanelRenderer.js";
import { HudRenderer } from "../ui/HudRenderer.js";
import { LocalSaveRepository } from "../persistence/LocalSaveRepository.js";
import { createEmptyScene } from "../persistence/SceneSerializer.js";
import { PHYSICS_CONFIG } from "../constants.js";
import type { Scene, SaveStatus } from "../scene/types.js";

/** FPS 滑动窗口大小（帧数） */
const FPS_WINDOW = 60;

export class GameApp {
  private readonly _modeController: ModeController;
  private readonly _sceneManager: SceneManager;
  private readonly _inputController: InputController;
  private readonly _physicsWorld: PhysicsWorld;
  private readonly _predictionEngine: PredictionEngine;
  private readonly _cameraController: CameraFollowController;
  private readonly _audioEngine: AudioEngine;
  private readonly _audioCtx: AudioContext;
  private readonly _canvasRenderer: CanvasRenderer;
  private readonly _timelineRenderer: TimelineStaffRenderer;
  private readonly _panelRenderer: PanelRenderer;
  private readonly _hudRenderer: HudRenderer;
  private readonly _localSaveRepo: LocalSaveRepository;

  private _rafId = 0;
  private _lastTimestamp = 0;
  private _currentSaveStatus: SaveStatus = "idle";
  /** 进入播放态前的场景深拷贝快照，退出时用于恢复实体初始位置 */
  private _playSnapshot: Scene | null = null;
  /** T070: 防重入守卫，防止 ModeController 回调触发递归切换 */
  private _modeSwitching = false;

  /** 调试模式（?debug=1） */
  private _debugMode = false;

  /** FPS 滑动窗口帧时间戳（ms），最多保留 FPS_WINDOW 帧 */
  private readonly _fpsTimestamps: number[] = [];
  /** 当前滑动平均 FPS */
  private _fps = 60;

  /** 最近 1 秒碰撞计数（用于 collisionsPerSec） */
  private _collisionCountBucket = 0;
  private _collisionsPerSec = 0;
  private _lastCollisionSecTimestamp = 0;

  private constructor(
    modeController: ModeController,
    sceneManager: SceneManager,
    inputController: InputController,
    physicsWorld: PhysicsWorld,
    predictionEngine: PredictionEngine,
    cameraController: CameraFollowController,
    audioEngine: AudioEngine,
    audioCtx: AudioContext,
    canvasRenderer: CanvasRenderer,
    timelineRenderer: TimelineStaffRenderer,
    panelRenderer: PanelRenderer,
    hudRenderer: HudRenderer,
    localSaveRepo: LocalSaveRepository
  ) {
    this._modeController = modeController;
    this._sceneManager = sceneManager;
    this._inputController = inputController;
    this._physicsWorld = physicsWorld;
    this._predictionEngine = predictionEngine;
    this._cameraController = cameraController;
    this._audioEngine = audioEngine;
    this._audioCtx = audioCtx;
    this._canvasRenderer = canvasRenderer;
    this._timelineRenderer = timelineRenderer;
    this._panelRenderer = panelRenderer;
    this._hudRenderer = hudRenderer;
    this._localSaveRepo = localSaveRepo;

    // 订阅模式变更（同步触发）
    this._modeController.onModeChange(mode => {
      if (mode === "play") {
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
    const mainCanvas = document.getElementById("main-canvas") as HTMLCanvasElement;
    const hudContainer = document.getElementById("hud-container") as HTMLElement;
    const panelContainer = document.getElementById("panel-container") as HTMLElement;
    const timelineCanvasEl = document.getElementById("timeline-canvas") as HTMLCanvasElement;

    // 设置主画布像素尺寸与 CSS 布局一致
    mainCanvas.width = window.innerWidth - 200;
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

    // T052: 创建 CameraFollowController（US4）
    const cameraController = new CameraFollowController();

    // T060/T061: 创建 LocalSaveRepository，尝试恢复场景
    const localSaveRepo = new LocalSaveRepository();

    const inputController = new InputController(mainCanvas, modeController, sceneManager);
    inputController.setAudioEngine(audioEngine);
    // 使用 cameraController 的 getCameraState() 作为 getter，确保总是读到最新相机状态
    inputController.setCameraStateGetter(() => cameraController.getCameraState());
    inputController.setCameraController(cameraController);
    inputController.setPanelRenderer(panelRenderer);

    // AudioContext 再次被挂起时通过 tryResume() 重试
    audioCtx.addEventListener("statechange", () => {
      if (audioCtx.state === "suspended") {
        audioEngine.tryResume();
      }
      hudRenderer.update(modeController.mode, undefined, audioCtx.state === "suspended");
    });

    const app = new GameApp(
      modeController,
      sceneManager,
      inputController,
      physicsWorld,
      predictionEngine,
      cameraController,
      audioEngine,
      audioCtx,
      canvasRenderer,
      timelineRenderer,
      panelRenderer,
      hudRenderer,
      localSaveRepo
    );

    // T063: 订阅保存状态变更，实时更新 HUD 右上角
    localSaveRepo.onStatusChange(status => {
      app._currentSaveStatus = status;
      hudRenderer.update(modeController.mode, status, audioCtx.state === "suspended");
    });

    // T061: 初始化时尝试恢复场景
    const restoredScene = localSaveRepo.load();
    if (restoredScene !== null) {
      sceneManager.loadScene(restoredScene);
    } else {
      const loadError = localSaveRepo.getLoadError();
      if (loadError !== null) {
        // 存档损坏或版本过高：载入空场景 + 显示错误提示
        sceneManager.loadScene(createEmptyScene());
        const errorMsg = loadError === "version-too-high" ? "存档版本过高，已载入空场景" : "存档损坏，已载入空场景";
        hudRenderer.showLoadError(errorMsg);
      }
      // loadError === null 且 restoredScene === null：无存档，保留默认空场景
    }

    // T061/FR-032: 恢复成功后立即触发一次预测重算
    predictionEngine.invalidate();

    // T069: 检测 ?debug=1 并启用调试面板
    const debugMode = new URLSearchParams(location.search).has("debug");
    if (debugMode) {
      hudRenderer.enableDebugPanel(hudContainer);
    }
    app._debugMode = debugMode;

    // 初始 HUD
    hudRenderer.update("edit", undefined, audioCtx.state === "suspended");

    // T064: 注册页面生命周期事件（visibilitychange + beforeunload）
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        localSaveRepo.forceSave(sceneManager.getScene());
      }
    });
    window.addEventListener("beforeunload", () => {
      localSaveRepo.forceSave(sceneManager.getScene());
    });

    // T062: 订阅 SceneManager.onChange，每次场景变更触发节流保存
    sceneManager.onChange(() => {
      if (modeController.mode === "edit") {
        localSaveRepo.save(sceneManager.getScene());
      }
    });

    // 窗口缩放时同步 canvas 像素尺寸
    window.addEventListener("resize", () => {
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

  /** Edit → Play（T027 + T036 + T045 + T052） */
  private _onEnterPlay(): void {
    if (this._modeSwitching) return; // T070: 防重入
    this._modeSwitching = true;
    try {
      this._onEnterPlayImpl();
    } finally {
      this._modeSwitching = false;
    }
  }

  private _onEnterPlayImpl(): void {
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
    // 步骤 6: C5 门禁 — 判定跟随目标（T052）
    // 仅此时读取 selectedBallId，播放中不重判
    this._cameraController.resolveCameraTarget(this._sceneManager.getSelectedId());

    // 步骤 7: 快照当前场景（退出播放时恢复实体位置），加载到物理引擎并启动
    this._playSnapshot = JSON.parse(JSON.stringify(this._sceneManager.getScene())) as Scene;
    this._physicsWorld.loadScene(this._sceneManager.getScene());
    this._physicsWorld.start();

    // 步骤 8: AudioEngine 进入监听态（内部调用 tryResume()）
    this._audioEngine.listen();

    this._hudRenderer.update("play", undefined, this._audioCtx.state === "suspended");
  }

  /** Play → Edit（T027 + T036 + T045 + T052） */
  private _onEnterEdit(): void {
    if (this._modeSwitching) return; // T070: 防重入
    this._modeSwitching = true;
    try {
      this._onEnterEditImpl();
    } finally {
      this._modeSwitching = false;
    }
  }

  private _onEnterEditImpl(): void {
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
    // 步骤 8: T062 强制保存（不受节流延迟约束，FR-030）
    this._localSaveRepo.forceSave(this._sceneManager.getScene());

    // T052: 停止相机跟随
    this._cameraController.stopFollow();

    // T070: 清除播放中累积的脉冲环动画
    this._canvasRenderer.clearRipples();

    // 恢复实体位置到播放前快照
    if (this._playSnapshot) {
      this._sceneManager.loadScene(this._playSnapshot);
      this._playSnapshot = null;
    }

    this._canvasRenderer.enablePredictionLayer();
    this._hudRenderer.update("edit", undefined, this._audioCtx.state === "suspended");
  }

  // ──────────────────────────────────────────────────────────────
  // 主循环（帧序 1~10）
  // ──────────────────────────────────────────────────────────────

  private _loop(timestamp: number): void {
    // T069: FPS 滑动窗口计算
    this._fpsTimestamps.push(timestamp);
    if (this._fpsTimestamps.length > FPS_WINDOW) {
      this._fpsTimestamps.shift();
    }
    if (this._fpsTimestamps.length >= 2) {
      const elapsed = this._fpsTimestamps[this._fpsTimestamps.length - 1] - this._fpsTimestamps[0];
      this._fps = ((this._fpsTimestamps.length - 1) / elapsed) * 1000;
    }

    // T069: 碰撞率（每秒刷新一次）
    if (this._lastCollisionSecTimestamp === 0) {
      this._lastCollisionSecTimestamp = timestamp;
    }
    if (timestamp - this._lastCollisionSecTimestamp >= 1000) {
      this._collisionsPerSec = this._collisionCountBucket;
      this._collisionCountBucket = 0;
      this._lastCollisionSecTimestamp = timestamp;
    }

    this._lastTimestamp = timestamp;

    // 帧序步骤 1: 输入处理（事件驱动）
    this._inputController.process();

    // 帧序步骤 2: ModeController.flushPending() — 已通过 onModeChange 同步处理

    // 帧序步骤 3: [仅 edit] PredictionEngine 由 markDirty() + setTimeout 去抖驱动，
    // 不需要在帧序中额外调用（T035）

    const mode = this._modeController.mode;

    // 帧序步骤 4: [仅 play] PhysicsWorld.step(FIXED_DT_MS)
    if (mode === "play") {
      this._physicsWorld.step(PHYSICS_CONFIG.FIXED_DT_MS);

      // 将物理引擎中小球的实时位置同步到 SceneManager 实体（供 CanvasRenderer 渲染正确位置）
      const ballPositions = this._physicsWorld.getBallPositions();
      const scene = this._sceneManager.getScene();
      for (const entity of scene.entities) {
        if (entity.kind === "ball") {
          const pos = ballPositions.get(entity.id);
          if (pos) {
            entity.x = pos.x;
            entity.y = pos.y;
          }
        }
      }
    }

    // 帧序步骤 5: [仅 play] AudioEngine.processCollisions() + L6 脉冲特效（T068）
    if (mode === "play") {
      const events = this._physicsWorld.getCollisionEvents();
      this._audioEngine.processCollisions(events);
      // T068: 将碰撞事件传给 CanvasRenderer 创建脉冲环动画
      if (events.length > 0) {
        this._canvasRenderer.processCollisionEffects(events);
        // T069: 累计碰撞计数（每秒刷新）
        this._collisionCountBucket += events.length;
      }
    }

    // 帧序步骤 6: CameraFollowController.update()（T052）
    // 编辑态 followBallId 为 null，安全跳过；播放态使用物理引擎最新位置
    this._cameraController.update(this._physicsWorld.getBallPositions());

    // 帧序步骤 7: CanvasRenderer.render()（T037: 传入 predictionResult）
    this._canvasRenderer.render(this._sceneManager.getScene(), this._cameraController.getCameraState(), this._predictionEngine.getLatestResult());

    // 帧序步骤 8: TimelineStaffRenderer.render()（T039）
    const predResult = this._predictionEngine.getLatestResult();
    this._timelineRenderer.render(predResult?.predictedNotes ?? [], mode);

    // 帧序步骤 9: PanelRenderer.update() + HudRenderer.update()（T045）
    const selectedId = this._sceneManager.getSelectedId();
    const selectedEntity = selectedId ? (this._sceneManager.getScene().entities.find(e => e.id === selectedId) ?? null) : null;
    this._panelRenderer.update(selectedEntity, this._inputController.activeTool);
    // HUD 每帧更新（audio state 可能变化）
    this._hudRenderer.update(mode, undefined, this._audioCtx.state === "suspended");

    // 帧序步骤 10: LocalSaveRepository.tick()（T062）
    this._localSaveRepo.tick();

    // ── E2E 专用调试状态（window.__debugState，每帧写入）──────────
    const scene = this._sceneManager.getScene();
    const cam = this._cameraController.getCameraState();
    const predComputeMs = this._predictionEngine.lastComputeMs;
    const timelineTrackCount = predResult ? predResult.trajectories.size : 0;

    window.__debugState = {
      mode,
      audioEngine: {
        activeVoiceCount: this._audioEngine.activeVoiceCount,
        totalCollisionEventsReceived: this._audioEngine.totalCollisionEventsReceived
      },
      entityCount: scene.entities.length,
      entities: scene.entities.map(e => ({
        id: e.id,
        kind: e.kind,
        x: e.x,
        y: e.y,
        ...(e.kind === "music-block" ? { noteName: e.noteName, volume: e.volume } : {})
      })),
      physicsRunning: mode === "play",
      camera: {
        cx: cam.cx,
        cy: cam.cy,
        zoom: cam.zoom,
        followBallId: cam.followBallId
      },
      prediction: predResult
        ? {
            noteCount: predResult.predictedNotes.length,
            trajBallCount: predResult.trajectories.size,
            computedAt: predResult.computedAt,
            lastComputeMs: predComputeMs,
            notes: predResult.predictedNotes.map(n => ({
              timeMs: n.timeMs,
              noteName: n.noteName,
              ballId: n.ballId,
              musicBlockId: n.musicBlockId
            }))
          }
        : null,
      persistence: {
        saveStatus: this._currentSaveStatus,
        loadError: this._localSaveRepo.getLoadError()
      },
      // T069: 性能指标（始终写入，供 E2E T076 断言）
      fps: this._fps,
      predictionMs: predComputeMs,
      timelineTrackCount,
      collisionsPerSec: this._collisionsPerSec
    };

    // T069: 调试模式下刷新可见 HUD 面板
    if (this._debugMode) {
      this._hudRenderer.updateDebugPanel({
        fps: this._fps,
        activeVoiceCount: this._audioEngine.activeVoiceCount,
        collisionsPerSec: this._collisionsPerSec,
        predictionMs: predComputeMs
      });
    }

    this._rafId = requestAnimationFrame(this._loop.bind(this));
  }
}
