import type { Entity, Scene, SceneSnapshot, Vec2 } from './types.js';

/** 最小接口：SceneManager 只需要知道如何通知预测引擎"标脏" */
export interface PredictionEngineRef {
  markDirty(): void;
}

export class SceneManager {
  private _scene: Scene;
  private _changeListeners: Array<() => void> = [];
  private _predictionEngine: PredictionEngineRef | null = null;

  constructor() {
    this._scene = {
      id: crypto.randomUUID(),
      mode: 'edit',
      gravity: { x: 0, y: 9.8 },
      selectedBallId: null,
      entities: [],
    };
  }

  addEntity(entity: Entity): void {
    this._scene.entities.push(entity);
    this._notifyChange();
  }

  removeEntity(id: string): void {
    const idx = this._scene.entities.findIndex((e) => e.id === id);
    if (idx === -1) return;
    this._scene.entities.splice(idx, 1);

    if (this._scene.selectedBallId === id) {
      this._scene.selectedBallId = null;
    }

    this._notifyChange();
  }

  updateEntity(id: string, partial: Partial<Entity>): void {
    const entity = this._scene.entities.find((e) => e.id === id);
    if (!entity) return;
    Object.assign(entity, partial);
    this._notifyChange();
  }

  getSnapshot(): SceneSnapshot {
    return {
      entities: JSON.parse(JSON.stringify(this._scene.entities)) as Entity[],
      gravity: { ...this._scene.gravity } as Vec2,
    };
  }

  setSelectedId(id: string | null): void {
    this._scene.selectedBallId = id;
  }

  getSelectedId(): string | null {
    return this._scene.selectedBallId;
  }

  getScene(): Scene {
    return this._scene;
  }

  loadScene(scene: Scene): void {
    this._scene = scene;
    this._notifyChange();
  }

  onChange(cb: () => void): void {
    this._changeListeners.push(cb);
  }

  /** 注入 PredictionEngine 引用（避免循环依赖，使用轻量接口） */
  setPredictionEngine(engine: PredictionEngineRef): void {
    this._predictionEngine = engine;
  }

  private _notifyChange(): void {
    for (const cb of this._changeListeners) {
      cb();
    }
    // 场景变更后通知预测引擎标脏（去抖 150ms 后重算）
    this._predictionEngine?.markDirty();
  }
}
