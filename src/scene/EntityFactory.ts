import type { Ball, Block, MusicBlock } from "./types.js";

export class EntityFactory {
  static createBall(x: number, y: number): Ball {
    return {
      id: crypto.randomUUID(),
      kind: "ball",
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 16
    };
  }

  static createBlock(x: number, y: number): Block {
    return {
      id: crypto.randomUUID(),
      kind: "block",
      x,
      y,
      width: 80,
      height: 20,
      rotation: 0
    };
  }

  static createMusicBlock(x: number, y: number): MusicBlock {
    return {
      id: crypto.randomUUID(),
      kind: "music-block",
      x,
      y,
      width: 60,
      height: 20,
      noteName: "C4",
      volume: 0.5,
      timbre: "piano"
    };
  }
}
