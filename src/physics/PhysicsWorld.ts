import Matter from 'matter-js';
import { PHYSICS_CONFIG } from '../constants.js';
import type { Scene, CollisionEvent, Vec2 } from '../scene/types.js';

export class PhysicsWorld {
  private readonly _engine: Matter.Engine;
  private _pendingCollisions: CollisionEvent[] = [];
  /** Matter body numeric id → entity string id */
  private readonly _bodyToEntityId = new Map<number, string>();
  /** Matter body numeric id → entity kind */
  private readonly _bodyToEntityKind = new Map<number, string>();
  /** music-block entity id → audio params */
  private readonly _musicBlockData = new Map<string, { noteName: string; volume: number }>();

  private _running = false;

  constructor() {
    this._engine = Matter.Engine.create({
      gravity: {
        x: PHYSICS_CONFIG.gravity.x,
        y: PHYSICS_CONFIG.gravity.y,
      },
    });

    Matter.Events.on(this._engine, 'collisionStart', (event) => {
      if (!this._running) return;

      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;

        const idA = this._bodyToEntityId.get(bodyA.id);
        const kindA = this._bodyToEntityKind.get(bodyA.id);
        const idB = this._bodyToEntityId.get(bodyB.id);
        const kindB = this._bodyToEntityKind.get(bodyB.id);

        let ballId: string | undefined;
        let musicBlockId: string | undefined;

        if (kindA === 'ball' && kindB === 'music-block' && idA && idB) {
          ballId = idA;
          musicBlockId = idB;
        } else if (kindB === 'ball' && kindA === 'music-block' && idB && idA) {
          ballId = idB;
          musicBlockId = idA;
        }

        if (ballId && musicBlockId) {
          const mbData = this._musicBlockData.get(musicBlockId);
          if (mbData) {
            this._pendingCollisions.push({
              ballId,
              musicBlockId,
              noteName: mbData.noteName,
              volume: mbData.volume,
              timestamp: performance.now(),
            });
          }
        }
      }
    });
  }

  loadScene(scene: Scene): void {
    Matter.World.clear(this._engine.world, false);
    this._bodyToEntityId.clear();
    this._bodyToEntityKind.clear();
    this._musicBlockData.clear();
    this._pendingCollisions = [];

    for (const entity of scene.entities) {
      if (entity.kind === 'ball') {
        const body = Matter.Bodies.circle(entity.x, entity.y, entity.radius, {
          isStatic: false,
          restitution: PHYSICS_CONFIG.restitution,
          friction: PHYSICS_CONFIG.friction,
          frictionAir: PHYSICS_CONFIG.frictionAir,
          label: entity.id,
        });
        (body as unknown as Record<string, unknown>)['plugin'] = { entityId: entity.kind };
        this._bodyToEntityId.set(body.id, entity.id);
        this._bodyToEntityKind.set(body.id, entity.kind);
        Matter.World.add(this._engine.world, body);
      } else if (entity.kind === 'block') {
        const body = Matter.Bodies.rectangle(
          entity.x,
          entity.y,
          entity.width,
          entity.height,
          {
            isStatic: true,
            restitution: PHYSICS_CONFIG.restitution,
            friction: PHYSICS_CONFIG.friction,
            label: entity.id,
            angle: entity.rotation,
          },
        );
        (body as unknown as Record<string, unknown>)['plugin'] = { entityId: entity.kind };
        this._bodyToEntityId.set(body.id, entity.id);
        this._bodyToEntityKind.set(body.id, entity.kind);
        Matter.World.add(this._engine.world, body);
      } else if (entity.kind === 'music-block') {
        const body = Matter.Bodies.rectangle(
          entity.x,
          entity.y,
          entity.width,
          entity.height,
          {
            isStatic: true,
            restitution: PHYSICS_CONFIG.restitution,
            friction: PHYSICS_CONFIG.friction,
            label: entity.id,
          },
        );
        (body as unknown as Record<string, unknown>)['plugin'] = { entityId: entity.kind };
        this._bodyToEntityId.set(body.id, entity.id);
        this._bodyToEntityKind.set(body.id, entity.kind);
        this._musicBlockData.set(entity.id, {
          noteName: entity.noteName,
          volume: entity.volume,
        });
        Matter.World.add(this._engine.world, body);
      }
    }
  }

  start(): void {
    this._running = true;
  }

  stop(): void {
    this._running = false;
  }

  /** 是否正在运行（供外部防守用） */
  isRunning(): boolean {
    return this._running;
  }

  step(dt: number): void {
    Matter.Engine.update(this._engine, dt);
  }

  getCollisionEvents(): CollisionEvent[] {
    const events = this._pendingCollisions;
    this._pendingCollisions = [];
    return events;
  }

  getBallPositions(): Map<string, Vec2> {
    const positions = new Map<string, Vec2>();
    for (const body of this._engine.world.bodies) {
      if (this._bodyToEntityKind.get(body.id) === 'ball') {
        const id = this._bodyToEntityId.get(body.id);
        if (id) {
          positions.set(id, { x: body.position.x, y: body.position.y });
        }
      }
    }
    return positions;
  }

  getStaticBodyPositions(): Map<string, Vec2> {
    const positions = new Map<string, Vec2>();
    for (const body of this._engine.world.bodies) {
      const kind = this._bodyToEntityKind.get(body.id);
      if (kind === 'block' || kind === 'music-block') {
        const id = this._bodyToEntityId.get(body.id);
        if (id) {
          positions.set(id, { x: body.position.x, y: body.position.y });
        }
      }
    }
    return positions;
  }
}
