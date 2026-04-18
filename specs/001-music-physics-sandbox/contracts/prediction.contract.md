# Contract: Prediction Engine

**契约 ID**: `prediction`  
**版本**: v1  
**契约类型**: 模块接口契约（SceneManager → PredictionEngine → CanvasRenderer / TimelineStaffRenderer）  
**日期**: 2026-04-17

---

## 概述

本契约定义 `PredictionEngine` 的输入（场景快照）、触发时机、输出格式（预测轨迹 + 预测音符），以及与消费方（`CanvasRenderer` 和 `TimelineStaffRenderer`）的接口规范。

```
SceneManager ──[SceneSnapshot]──► PredictionEngine
                                        │
                              ┌─────────┴─────────┐
                              ▼                   ▼
                    trajectories          predictedNotes
                         │                      │
                   CanvasRenderer      TimelineStaffRenderer
                   （预测线 L5 层）     （五线谱音符渲染）
```

---

## 触发规则

| 触发条件        | 触发者         | 说明                            |
| --------------- | -------------- | ------------------------------- |
| 实体新增        | SceneManager   | 放置小球 / 方块 / 音乐方块      |
| 实体移动        | SceneManager   | 拖拽实体到新位置                |
| 实体删除        | SceneManager   | 删除选中实体                    |
| 参数修改        | SceneManager   | 修改音乐方块 noteName 或 volume |
| 播放 → 编辑切换 | ModeController | 切换回编辑态时强制触发一次      |

**不触发条件**：

- 播放态中任何操作（播放态 PredictionEngine 完全停止）
- 相机平移 / 缩放操作（不影响物理结果）
- 选中状态变更（不影响物理结果）

**去抖策略**：场景变更后等待 `PREDICTION_DEBOUNCE_MS = 150ms` 才实际运行，避免拖拽中每帧重算。

---

## 输入：SceneSnapshot

```typescript
interface SceneSnapshot {
  /** 场景中的所有实体（深拷贝，不引用原始对象） */
  entities: Entity[];

  /** 场景重力向量 */
  gravity: { x: number; y: number };
}
```

**约束**：

- `entities` 必须是独立深拷贝，不与 SceneManager 共享引用
- 快照中的 Ball 速度始终为零（编辑态不变量）

---

## 输出：PredictionResult

```typescript
interface PredictionResult {
  /**
   * 每个小球的预测轨迹点序列。
   * Key 为 Ball 的 id，Value 为按时间顺序排列的世界坐标点数组。
   */
  trajectories: Map<string, Vec2[]>;

  /**
   * 所有预测碰撞音符，按 timeMs 升序排列。
   * 供 TimelineStaffRenderer 按 ballId 分组渲染五线谱。
   */
  predictedNotes: PredictedNote[];

  /** 本次预测计算开始时间（performance.now()） */
  computedAt: number;

  /** 本次预测模拟步数 */
  stepsRun: number;
}

type Vec2 = { x: number; y: number };
```

---

## PredictedNote 结构

```typescript
interface PredictedNote {
  /** 预测碰撞时间（自模拟开始的毫秒数） */
  timeMs: number;

  /** 碰撞的小球实体 ID */
  ballId: string;

  /** 被碰撞的音乐方块实体 ID */
  musicBlockId: string;

  /** 音乐方块的 noteName（用于五线谱音高映射） */
  noteName: string;

  /** 音乐方块的 volume（用于音符显示大小/透明度） */
  volume: number;
}
```

**约束**：

- 纯运行时数据，不进入 localStorage 持久化
- `timeMs` 精度接受 ±50ms 误差（TR-07 容差设计，见 research.md RES-05）
- 无 `durationMs` 字段

---

## PredictionEngine 接口

```typescript
interface PredictionEngine {
  /**
   * 标记场景为脏状态，触发去抖定时器。
   * SceneManager 在任何影响物理结果的变更后调用。
   */
  markDirty(): void;

  /**
   * 获取最新的预测结果。
   * CanvasRenderer 和 TimelineStaffRenderer 在每帧渲染时读取。
   * 若尚未计算或正在计算，返回上一次有效结果（避免渲染空白）。
   */
  getLatestResult(): PredictionResult | null;

  /**
   * 进入播放态时调用，停止计算和定时器。
   * 直到 resume() 被调用前，markDirty() 无效。
   */
  pause(): void;

  /**
   * 返回编辑态时调用，恢复计算能力，并立即触发一次 markDirty()。
   */
  resume(): void;

  /**
   * 同步运行一次预测（跳过去抖），供模式切换后立即刷新使用。
   * 内部调用时机：ModeController.stopPlay() 序列的步骤 7。
   */
  invalidate(): void;
}
```

---

## 物理模拟参数（与 PhysicsWorld 同源）

PredictionEngine 必须使用与 `PhysicsWorld` 完全相同的 Matter.js 配置：

```typescript
// 从 constants.ts 导入，两者共享同一来源
import { PHYSICS_CONFIG, FIXED_DT_MS } from "../constants";

// 预测专用配置
const PREDICTION_MAX_STEPS = 300; // 约 5 秒预测窗口（300 × 16.67ms）
const PREDICTION_DEBOUNCE_MS = 150; // 去抖时间
```

**同源配置项**：

- 重力：`engine.gravity.x = PHYSICS_CONFIG.gravity.x`，`engine.gravity.y = PHYSICS_CONFIG.gravity.y`
- 刚体弹性系数：`PHYSICS_CONFIG.restitution`
- 摩擦系数：`PHYSICS_CONFIG.friction`
- 空气阻力：`PHYSICS_CONFIG.frictionAir`
- 时间步长：`FIXED_DT_MS`（约 16.67ms）

---

## 轨迹采样策略

为了控制 `trajectories` 数据量，使用每 N 步采样一个轨迹点：

```
TRAJECTORY_SAMPLE_INTERVAL = 5   // 每 5 步采样一次（约 83ms 一个点）
最大轨迹点数 = 300 / 5 = 60 点/球
```

---

## 消费方约定

### CanvasRenderer（预测线渲染）

- 仅在编辑态读取 `result.trajectories`
- 按 `trajectories.get(ballId)` 绘制虚线（`setLineDash([5,5])`，透明度 0.4）
- 若 `getLatestResult() === null`，不绘制预测线（不报错）

### TimelineStaffRenderer（五线谱渲染）

- 仅在编辑态读取 `result.predictedNotes`
- 按 `ballId` 分组，每组对应一条五线谱轨道
- `timeMs` 映射到横轴（时间）
- `noteName` 映射到纵轴（音高）
- `volume` 映射到音符的透明度 / 大小（视觉强调）
- 若 `getLatestResult() === null`，显示空谱线（不报错）

---

## 一致性约束

| 约束                   | 说明                                                            |
| ---------------------- | --------------------------------------------------------------- |
| 预测线与 Timeline 同源 | 两者读取同一 `PredictionResult` 实例，保证完全一致              |
| 无分叉计算             | 不允许 CanvasRenderer 和 TimelineStaffRenderer 分别触发独立预测 |
| 播放态零计算           | `pause()` 后 `markDirty()` 无效，不启动后台预测                 |

---

## 不变量（Invariants）

1. `PredictionEngine` 不修改 SceneManager 中的任何实体（只读快照）
2. 预测使用的 Matter.js Engine 实例与 `PhysicsWorld` 的主 Engine 完全隔离
3. 每次预测完成后，临时 Engine 实例必须调用 `Matter.World.clear()` + `Matter.Engine.clear()` 销毁
4. `PredictedNote` 数据中不包含 `durationMs` 字段
5. 预测结果不写入 localStorage
