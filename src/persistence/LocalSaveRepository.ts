import type { Scene, SaveStatus, LoadError } from '../scene/types.js';
import { SAVE_KEY, SAVE_THROTTLE_MS } from '../constants.js';
import { SceneSerializer } from './SceneSerializer.js';

/**
 * localStorage 节流保存 / 强制保存 / 恢复。
 *
 * 保存策略：
 * - save()：节流，SAVE_THROTTLE_MS 内多次调用合并为 1 次写入
 * - forceSave()：立即同步写入，清除已有节流计时器
 * - tick()：主循环帧调用（当前由 setTimeout 内部驱动，tick 为 API 占位）
 */
export class LocalSaveRepository {
  private readonly _serializer: SceneSerializer;
  private readonly _statusListeners: Array<(status: SaveStatus) => void> = [];

  private _throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingScene: Scene | null = null;
  private _loadError: LoadError = null;

  constructor(serializer?: SceneSerializer) {
    this._serializer = serializer ?? new SceneSerializer();
  }

  /**
   * 节流保存：1000ms 内多次调用合并为 1 次 localStorage 写入。
   * 第一次调用立即标记 "saving"，计时器触发时写入并通知 "saved" 或 "failed"。
   */
  save(scene: Scene): void {
    this._pendingScene = scene;
    this._notifyStatus('saving');

    if (this._throttleTimer === null) {
      this._throttleTimer = setTimeout(() => {
        this._flush();
      }, SAVE_THROTTLE_MS);
    }
  }

  /**
   * 强制保存：立即同步写入，清除已有节流计时器。
   * play→edit 切换、页面隐藏、beforeunload 时调用。
   */
  forceSave(scene: Scene): void {
    if (this._throttleTimer !== null) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
    this._pendingScene = null;

    try {
      localStorage.setItem(SAVE_KEY, this._serializer.serialize(scene));
      this._notifyStatus('saved');
    } catch (err) {
      console.error('[LocalSaveRepository] forceSave failed:', err);
      this._notifyStatus('failed');
    }
  }

  /**
   * 读取并反序列化存档。
   * - localStorage 无数据 → 返回 null（无 loadError）
   * - 反序列化失败 → 返回 null + loadError 已设置
   */
  load(): Scene | null {
    this._loadError = null;

    let json: string | null;
    try {
      json = localStorage.getItem(SAVE_KEY);
    } catch (err) {
      console.error('[LocalSaveRepository] localStorage.getItem failed:', err);
      this._loadError = 'corrupted';
      return null;
    }

    if (json === null) {
      return null;
    }

    const scene = this._serializer.deserialize(json);
    if (scene === null) {
      this._loadError = this._serializer.getLoadError();
      return null;
    }

    return scene;
  }

  getLoadError(): LoadError {
    return this._loadError;
  }

  /**
   * 主循环帧调用接口（节流计时由 setTimeout 内部驱动，tick 为 API 占位）。
   */
  tick(): void {
    // no-op：节流由 setTimeout 驱动
  }

  onStatusChange(cb: (status: SaveStatus) => void): void {
    this._statusListeners.push(cb);
  }

  private _flush(): void {
    this._throttleTimer = null;
    const scene = this._pendingScene;
    this._pendingScene = null;

    if (scene === null) return;

    try {
      localStorage.setItem(SAVE_KEY, this._serializer.serialize(scene));
      this._notifyStatus('saved');
    } catch (err) {
      console.error('[LocalSaveRepository] save flush failed:', err);
      this._notifyStatus('failed');
    }
  }

  private _notifyStatus(status: SaveStatus): void {
    for (const cb of this._statusListeners) {
      cb(status);
    }
  }
}
