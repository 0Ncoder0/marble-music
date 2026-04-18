import { describe, it, expect, beforeEach } from 'vitest';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld.js';
import { PHYSICS_CONFIG } from '../../src/constants.js';
import type { Scene, Entity } from '../../src/scene/types.js';

const FIXED_DT_MS = PHYSICS_CONFIG.FIXED_DT_MS;

function makeScene(entities: Entity[]): Scene {
  return {
    id: 'test-scene',
    mode: 'edit',
    gravity: { x: 0, y: 9.8 },
    selectedBallId: null,
    entities,
  };
}

function makeBall(id: string, x: number, y: number): Entity {
  return { id, kind: 'ball', x, y, vx: 0, vy: 0, radius: 16 };
}

function makeBlock(id: string, x: number, y: number): Entity {
  return { id, kind: 'block', x, y, width: 200, height: 20, rotation: 0 };
}

function makeMusicBlock(id: string, x: number, y: number): Entity {
  return {
    id,
    kind: 'music-block',
    x,
    y,
    width: 80,
    height: 20,
    noteName: 'C4',
    volume: 0.5,
    timbre: 'piano',
  };
}

describe('PhysicsWorld', () => {
  let world: PhysicsWorld;

  beforeEach(() => {
    world = new PhysicsWorld();
  });

  it('PW-01: 仅 Ball 在步进中移动，Block 和 MusicBlock 位置不变', () => {
    const ballId = 'ball-1';
    const blockId = 'block-1';
    const mbId = 'mb-1';

    // 小球在高处，方块和音乐方块在更高处（不会碰撞）
    const scene = makeScene([
      makeBall(ballId, 200, 50),
      makeBlock(blockId, 500, 50),
      makeMusicBlock(mbId, 800, 50),
    ]);
    world.loadScene(scene);

    const initialStatic = world.getStaticBodyPositions();
    const blockInitial = initialStatic.get(blockId)!;
    const mbInitial = initialStatic.get(mbId)!;
    const ballInitial = world.getBallPositions().get(ballId)!;

    // 步进 30 帧（约 0.5 秒）
    for (let i = 0; i < 30; i++) {
      world.step(FIXED_DT_MS);
    }

    const ballAfter = world.getBallPositions().get(ballId)!;
    const staticAfter = world.getStaticBodyPositions();
    const blockAfter = staticAfter.get(blockId)!;
    const mbAfter = staticAfter.get(mbId)!;

    // 小球应该移动了（y 增大，因为重力向下）
    expect(ballAfter.y).toBeGreaterThan(ballInitial.y);

    // 静态方块位置不变
    expect(blockAfter.x).toBeCloseTo(blockInitial.x, 3);
    expect(blockAfter.y).toBeCloseTo(blockInitial.y, 3);
    expect(mbAfter.x).toBeCloseTo(mbInitial.x, 3);
    expect(mbAfter.y).toBeCloseTo(mbInitial.y, 3);
  });

  it('PW-02: Ball 受重力下落，y 坐标随时间增大', () => {
    const ballId = 'ball-1';
    const scene = makeScene([makeBall(ballId, 300, 100)]);
    world.loadScene(scene);

    const y0 = world.getBallPositions().get(ballId)!.y;

    for (let i = 0; i < 60; i++) {
      world.step(FIXED_DT_MS);
    }

    const y1 = world.getBallPositions().get(ballId)!.y;
    expect(y1).toBeGreaterThan(y0);
  });

  it('PW-03: Ball 碰撞 Block 后速度方向改变（y 方向由增大变为减小）', () => {
    const ballId = 'ball-1';
    // 小球在方块正上方，留 10px 间距让碰撞自然发生
    // ball bottom = 164+16 = 180, block top = 200-10 = 190 → gap = 10px
    const scene = makeScene([
      makeBall(ballId, 300, 164),
      makeBlock('block-1', 300, 200),
    ]);
    world.loadScene(scene);

    // 追踪 y 坐标序列，检测反弹（y 由增大变减小）
    let prevY = world.getBallPositions().get(ballId)!.y;
    let wentDown = false;
    let bounced = false;

    for (let i = 0; i < 120; i++) {
      world.step(FIXED_DT_MS);
      const pos = world.getBallPositions().get(ballId);
      if (!pos) break;
      if (pos.y > prevY) wentDown = true;
      if (wentDown && pos.y < prevY) {
        bounced = true;
        break;
      }
      prevY = pos.y;
    }

    expect(bounced).toBe(true);
  });

  it('PW-04: Ball 碰撞 MusicBlock 时输出包含正确 ballId 和 musicBlockId 的 CollisionEvent', () => {
    const ballId = 'ball-1';
    const mbId = 'mb-1';

    // 小球正上方，留 10px 间距
    const scene = makeScene([
      makeBall(ballId, 400, 164),
      makeMusicBlock(mbId, 400, 200),
    ]);
    world.loadScene(scene);
    world.start(); // 必须 start() 才会收集碰撞事件

    let collisionEvents = world.getCollisionEvents();
    let attempts = 0;

    while (collisionEvents.length === 0 && attempts < 120) {
      world.step(FIXED_DT_MS);
      collisionEvents = world.getCollisionEvents();
      attempts++;
    }

    expect(collisionEvents.length).toBeGreaterThan(0);
    const event = collisionEvents[0];
    expect(event.ballId).toBe(ballId);
    expect(event.musicBlockId).toBe(mbId);
    expect(event.noteName).toBe('C4');
    expect(event.volume).toBe(0.5);
  });
});
