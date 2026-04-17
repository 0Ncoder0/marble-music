export type Vec2 = { x: number; y: number };

export type AppMode = 'edit' | 'play';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export type LoadError =
  | 'corrupted'
  | 'version-too-high'
  | 'incomplete-data'
  | null;

export interface Ball {
  id: string;
  kind: 'ball';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface Block {
  id: string;
  kind: 'block';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface MusicBlock {
  id: string;
  kind: 'music-block';
  x: number;
  y: number;
  width: number;
  height: number;
  noteName: string;
  volume: number;
  timbre: 'piano';
}

export type Entity = Ball | Block | MusicBlock;

export interface Scene {
  id: string;
  mode: AppMode;
  gravity: Vec2;
  selectedBallId: string | null;
  entities: Entity[];
}

export interface SaveData {
  version: 1;
  savedAt: string;
  scene: Scene;
}

export interface PredictedNote {
  timeMs: number;
  ballId: string;
  musicBlockId: string;
  noteName: string;
  volume: number;
}

export interface CollisionEvent {
  ballId: string;
  musicBlockId: string;
  noteName: string;
  volume: number;
  timestamp: number;
}

export interface PredictionResult {
  trajectories: Map<string, Vec2[]>;
  predictedNotes: PredictedNote[];
  computedAt: number;
  stepsRun: number;
}

/**
 * 场景快照，供 PredictionEngine.run() 独立消费，不引用 SceneManager 原始对象。
 */
export interface SceneSnapshot {
  entities: Entity[];
  gravity: Vec2;
}

export interface CameraState {
  cx: number;
  cy: number;
  zoom: number;
  followBallId: string | null;
}
