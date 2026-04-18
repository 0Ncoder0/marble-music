import type { Scene, Entity, MusicBlock, Ball, Block, LoadError } from '../scene/types.js';

const MAX_KNOWN_VERSION = 1;
const NOTE_NAME_REGEX = /^[A-G][#b]?[0-9]$/;

/**
 * Scene ↔ JSON 序列化 / 反序列化，版本校验。
 *
 * 约束：
 * - serialize: 强制 mode="edit"，所有 Ball vx=vy=0
 * - deserialize: 遇到 durationMs 字段直接忽略；volume 超范围夹紧；version > MAX 返回 null
 */
export class SceneSerializer {
  private _lastError: LoadError = null;

  serialize(scene: Scene): string {
    const entities = scene.entities.map((e) => {
      if (e.kind === 'ball') {
        return { ...e, vx: 0, vy: 0 } satisfies Ball;
      }
      return e;
    });

    const saveData = {
      version: 1 as const,
      savedAt: new Date().toISOString(),
      scene: {
        id: scene.id,
        mode: 'edit' as const,
        gravity: { ...scene.gravity },
        selectedBallId: scene.selectedBallId,
        entities,
      },
    };

    return JSON.stringify(saveData);
  }

  deserialize(json: string): Scene | null {
    this._lastError = null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      this._lastError = 'corrupted';
      return null;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      this._lastError = 'corrupted';
      return null;
    }

    const data = parsed as Record<string, unknown>;

    if (typeof data.version !== 'number') {
      this._lastError = 'corrupted';
      return null;
    }

    if (data.version > MAX_KNOWN_VERSION) {
      this._lastError = 'version-too-high';
      return null;
    }

    const rawScene = data.scene;
    if (typeof rawScene !== 'object' || rawScene === null) {
      this._lastError = 'corrupted';
      return null;
    }

    const s = rawScene as Record<string, unknown>;

    if (typeof s.id !== 'string' || s.id.length === 0) {
      this._lastError = 'incomplete-data';
      return null;
    }

    if (s.mode !== 'edit' && s.mode !== 'play') {
      this._lastError = 'corrupted';
      return null;
    }

    if (typeof s.gravity !== 'object' || s.gravity === null) {
      this._lastError = 'corrupted';
      return null;
    }
    const grav = s.gravity as Record<string, unknown>;
    if (typeof grav.x !== 'number' || typeof grav.y !== 'number') {
      this._lastError = 'corrupted';
      return null;
    }

    if (!Array.isArray(s.entities)) {
      this._lastError = 'corrupted';
      return null;
    }

    const entities: Entity[] = [];
    for (const rawEntity of s.entities as unknown[]) {
      const entity = this._validateEntity(rawEntity);
      if (entity === null) {
        this._lastError = 'incomplete-data';
        return null;
      }
      entities.push(entity);
    }

    return {
      id: s.id as string,
      mode: 'edit',
      gravity: { x: grav.x as number, y: grav.y as number },
      selectedBallId: typeof s.selectedBallId === 'string' && s.selectedBallId.length > 0
        ? s.selectedBallId
        : null,
      entities,
    };
  }

  getLoadError(): LoadError {
    return this._lastError;
  }

  private _validateEntity(raw: unknown): Entity | null {
    if (typeof raw !== 'object' || raw === null) return null;

    const e = raw as Record<string, unknown>;

    if (typeof e.id !== 'string' || e.id.length === 0) return null;

    switch (e.kind) {
      case 'ball': {
        if (typeof e.x !== 'number') return null;
        if (typeof e.y !== 'number') return null;
        if (typeof e.vx !== 'number') return null;
        if (typeof e.vy !== 'number') return null;
        if (typeof e.radius !== 'number' || e.radius <= 0) return null;

        const ball: Ball = {
          id: e.id as string,
          kind: 'ball',
          x: e.x as number,
          y: e.y as number,
          vx: 0,
          vy: 0,
          radius: e.radius as number,
        };
        return ball;
      }

      case 'block': {
        if (typeof e.x !== 'number') return null;
        if (typeof e.y !== 'number') return null;
        if (typeof e.width !== 'number' || e.width <= 0) return null;
        if (typeof e.height !== 'number' || e.height <= 0) return null;
        if (typeof e.rotation !== 'number') return null;

        const block: Block = {
          id: e.id as string,
          kind: 'block',
          x: e.x as number,
          y: e.y as number,
          width: e.width as number,
          height: e.height as number,
          rotation: e.rotation as number,
        };
        return block;
      }

      case 'music-block': {
        if (typeof e.x !== 'number') return null;
        if (typeof e.y !== 'number') return null;
        if (typeof e.width !== 'number' || e.width <= 0) return null;
        if (typeof e.height !== 'number' || e.height <= 0) return null;
        if (typeof e.noteName !== 'string' || !NOTE_NAME_REGEX.test(e.noteName)) return null;
        if (typeof e.volume !== 'number') return null;
        if (e.timbre !== 'piano') return null;

        // durationMs 字段直接忽略（不拒绝整体）
        const musicBlock: MusicBlock = {
          id: e.id as string,
          kind: 'music-block',
          x: e.x as number,
          y: e.y as number,
          width: e.width as number,
          height: e.height as number,
          noteName: e.noteName as string,
          volume: Math.max(0, Math.min(1, e.volume as number)),
          timbre: 'piano',
        };
        return musicBlock;
      }

      default:
        return null;
    }
  }
}

export function createEmptyScene(): Scene {
  return {
    id: crypto.randomUUID(),
    mode: 'edit',
    gravity: { x: 0, y: 9.8 },
    selectedBallId: null,
    entities: [],
  };
}
