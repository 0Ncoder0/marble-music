import Matter from "matter-js";
import { PHYSICS_CONFIG, PREDICTION_DEBOUNCE_MS, PREDICTION_MAX_STEPS, TRAJECTORY_SAMPLE_INTERVAL } from "../constants.js";
import type { SceneManager } from "../scene/SceneManager.js";
import type { PredictionResult, PredictedNote, Vec2 } from "../scene/types.js";

export class PredictionEngine {
  private readonly _sceneManager: SceneManager;
  private _latestResult: PredictionResult | null = null;
  private _paused = false;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** 上次预测计算耗时（ms），供调试面板使用 */
  public lastComputeMs = 0;

  constructor(sceneManager: SceneManager) {
    this._sceneManager = sceneManager;
  }

  /**
   * 标记场景为脏状态，触发 150ms 去抖定时器。
   * 播放态（paused）调用无效。
   */
  markDirty(): void {
    if (this._paused) return;

    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
    }

    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      if (!this._paused) {
        this._run();
      }
    }, PREDICTION_DEBOUNCE_MS);
  }

  /** 获取最新预测结果，尚未计算时返回 null。 */
  getLatestResult(): PredictionResult | null {
    return this._latestResult;
  }

  /**
   * 进入播放态时调用，停止计算和定时器。
   * resume() 调用之前，markDirty() 无效。
   */
  pause(): void {
    this._paused = true;
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  /**
   * 返回编辑态时调用，恢复计算能力，并立即触发一次 markDirty()。
   */
  resume(): void {
    this._paused = false;
    this.markDirty();
  }

  /**
   * 同步执行一次预测（跳过去抖），供模式切换后立即刷新使用。
   * 调用时机：Play→Edit 序列步骤 7（PredictionEngine.resume() + invalidate()）。
   */
  invalidate(): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._run();
  }

  // ─────────────────────────────────────────────────────────────────
  // 内部预测模拟
  // ─────────────────────────────────────────────────────────────────

  private _run(): void {
    const snapshot = this._sceneManager.getSnapshot();
    const startTime = performance.now();

    // 创建独立的 Matter.js 引擎实例，与 PhysicsWorld 完全隔离
    const engine = Matter.Engine.create({
      gravity: {
        x: snapshot.gravity.x,
        y: snapshot.gravity.y
      }
    });

    // 刚体 ID → 实体 ID / 实体 kind 的映射
    const bodyToEntityId = new Map<number, string>();
    const bodyToEntityKind = new Map<number, string>();
    const musicBlockData = new Map<string, { noteName: string; volume: number }>();

    // 初始化每个 Ball 的轨迹数组
    const trajectories = new Map<string, Vec2[]>();
    const predictedNotes: PredictedNote[] = [];

    // 克隆场景实体，创建刚体（与 PhysicsWorld 同源参数）
    for (const entity of snapshot.entities) {
      if (entity.kind === "ball") {
        const body = Matter.Bodies.circle(entity.x, entity.y, entity.radius, {
          isStatic: false,
          restitution: PHYSICS_CONFIG.restitution,
          friction: PHYSICS_CONFIG.friction,
          frictionAir: PHYSICS_CONFIG.frictionAir,
          label: entity.id
        });
        bodyToEntityId.set(body.id, entity.id);
        bodyToEntityKind.set(body.id, entity.kind);
        Matter.World.add(engine.world, body);
        trajectories.set(entity.id, [{ x: entity.x, y: entity.y }]);
      } else if (entity.kind === "block") {
        const body = Matter.Bodies.rectangle(entity.x, entity.y, entity.width, entity.height, {
          isStatic: true,
          restitution: PHYSICS_CONFIG.restitution,
          friction: PHYSICS_CONFIG.friction,
          label: entity.id,
          angle: entity.rotation
        });
        bodyToEntityId.set(body.id, entity.id);
        bodyToEntityKind.set(body.id, entity.kind);
        Matter.World.add(engine.world, body);
      } else if (entity.kind === "music-block") {
        const body = Matter.Bodies.rectangle(entity.x, entity.y, entity.width, entity.height, {
          isStatic: true,
          restitution: PHYSICS_CONFIG.restitution,
          friction: PHYSICS_CONFIG.friction,
          label: entity.id
        });
        bodyToEntityId.set(body.id, entity.id);
        bodyToEntityKind.set(body.id, entity.kind);
        musicBlockData.set(entity.id, {
          noteName: entity.noteName,
          volume: entity.volume
        });
        Matter.World.add(engine.world, body);
      }
    }

    // currentCollisionStep 在 collisionStart 事件触发时记录当前步数
    // JS 单线程 + Matter.js 同步执行：事件在 Engine.update() 内同步触发，
    // 因此读取 currentCollisionStep 时，值已是当前步数。
    let currentCollisionStep = 0;

    Matter.Events.on(engine, "collisionStart", event => {
      const stepMs = currentCollisionStep * PHYSICS_CONFIG.FIXED_DT_MS;

      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;

        const idA = bodyToEntityId.get(bodyA.id);
        const kindA = bodyToEntityKind.get(bodyA.id);
        const idB = bodyToEntityId.get(bodyB.id);
        const kindB = bodyToEntityKind.get(bodyB.id);

        let ballId: string | undefined;
        let musicBlockId: string | undefined;

        if (kindA === "ball" && kindB === "music-block" && idA && idB) {
          ballId = idA;
          musicBlockId = idB;
        } else if (kindB === "ball" && kindA === "music-block" && idB && idA) {
          ballId = idB;
          musicBlockId = idA;
        }

        if (ballId && musicBlockId) {
          const mbData = musicBlockData.get(musicBlockId);
          if (mbData) {
            predictedNotes.push({
              timeMs: stepMs,
              ballId,
              musicBlockId,
              noteName: mbData.noteName,
              volume: mbData.volume
            });
          }
        }
      }
    });

    // 模拟 PREDICTION_MAX_STEPS 步
    for (let step = 0; step < PREDICTION_MAX_STEPS; step++) {
      currentCollisionStep = step;
      Matter.Engine.update(engine, PHYSICS_CONFIG.FIXED_DT_MS);

      // 每 TRAJECTORY_SAMPLE_INTERVAL 步采样一次轨迹点
      if ((step + 1) % TRAJECTORY_SAMPLE_INTERVAL === 0) {
        for (const body of engine.world.bodies) {
          const kind = bodyToEntityKind.get(body.id);
          if (kind === "ball") {
            const id = bodyToEntityId.get(body.id);
            if (id) {
              const traj = trajectories.get(id);
              if (traj) {
                traj.push({ x: body.position.x, y: body.position.y });
              }
            }
          }
        }
      }
    }

    // 按时间升序排列
    predictedNotes.sort((a, b) => a.timeMs - b.timeMs);

    // 销毁临时引擎（防止内存泄漏）
    Matter.World.clear(engine.world, false);
    Matter.Engine.clear(engine);

    const endTime = performance.now();
    this.lastComputeMs = endTime - startTime;

    this._latestResult = {
      trajectories,
      predictedNotes,
      computedAt: startTime,
      stepsRun: PREDICTION_MAX_STEPS
    };

    // 开发模式输出耗时日志（Vite 构建时会替换 import.meta.env.DEV）
    try {
      if (import.meta.env.DEV) {
        console.debug(`[PredictionEngine] ${this.lastComputeMs.toFixed(1)}ms, ` + `${predictedNotes.length} notes, ${trajectories.size} balls`);
      }
    } catch {
      // 非 Vite 环境（如测试）下 import.meta.env 可能不可用，静默忽略
    }
  }
}
