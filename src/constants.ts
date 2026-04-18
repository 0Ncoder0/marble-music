export const PHYSICS_CONFIG = {
  gravity: { x: 0, y: 1.0 },
  restitution: 0.7,
  friction: 0.1,
  frictionAir: 0.01,
  FIXED_DT_MS: 1000 / 60
} as const;

export const SAVE_KEY = "marble-music-save";
export const SAVE_THROTTLE_MS = 1000;
export const PREDICTION_DEBOUNCE_MS = 150;
export const PREDICTION_MAX_STEPS = 300;
export const TRAJECTORY_SAMPLE_INTERVAL = 5;
export const MAX_VOICES_PER_FRAME = 16;
export const MAX_TOTAL_VOICES = 64;
export const FOLLOW_LERP = 0.1;

/** voice 最小衰减时长（秒），即 200ms */
export const BASE_DECAY_S = 0.2;

/** volume=1 时额外衰减时长（秒），即 2000ms */
export const VOLUME_DECAY_SCALE_S = 2.0;
