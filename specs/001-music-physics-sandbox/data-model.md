# Data Model: Music Physics Sandbox

**Feature**: `001-music-physics-sandbox`  
**Source**: GDD 07（数据模型与存档契约）  
**Date**: 2026-04-17

---

## 概述

本文件定义 Marble Music 所有持久化和运行时数据结构。所有类型与 `specs/001-music-physics-sandbox/contracts/sandbox-state.schema.json` 严格对齐。

---

## 1. 实体类型

### 1.1 Ball（小球）

动态物理实体，播放态受重力驱动运动，编辑态速度为零。

```typescript
interface Ball {
  id: string;           // UUID，场景内唯一
  kind: "ball";         // 判别联合字段（固定值）
  x: number;            // 世界坐标 X（像素）
  y: number;            // 世界坐标 Y（像素）
  vx: number;           // 速度 X（编辑态始终为 0）
  vy: number;           // 速度 Y（编辑态始终为 0）
  radius: number;       // 半径（像素，默认 16）
}
```

**约束**：
- `kind` 必须为 `"ball"`
- `id` 非空，场景内唯一
- `radius > 0`
- 编辑态保存时 `vx = 0, vy = 0`
- 播放态中唯一会被物理引擎推进的实体类型

**状态转换**：

```
编辑态（vx=0, vy=0）
    │
    │ startPlay()
    ▼
播放态（受重力，PhysicsWorld 驱动）
    │
    │ stopPlay()
    ▼
编辑态（vx=0, vy=0 重置）
```

---

### 1.2 Block（方块）

静态碰撞体，始终不移动，用于搭建轨道和结构。

```typescript
interface Block {
  id: string;           // UUID，场景内唯一
  kind: "block";        // 判别联合字段（固定值）
  x: number;            // 中心位置 X（像素）
  y: number;            // 中心位置 Y（像素）
  width: number;        // 宽度（像素，默认 80）
  height: number;       // 高度（像素，默认 20）
  rotation: number;     // 旋转角度（弧度，0 为水平，正值顺时针）
}
```

**约束**：
- `kind` 必须为 `"block"`
- `width > 0, height > 0`
- `rotation` 范围 `[-π, π]`（可存储任意值，物理引擎按弧度处理）
- 始终是 Matter.js 静态刚体（`isStatic: true`），不参与速度更新

---

### 1.3 MusicBlock（音乐方块）

静态触发体，被小球碰撞时触发音符发声。

```typescript
interface MusicBlock {
  id: string;           // UUID，场景内唯一
  kind: "music-block";  // 判别联合字段（固定值）
  x: number;            // 中心位置 X（像素）
  y: number;            // 中心位置 Y（像素）
  width: number;        // 宽度（像素，默认 60）
  height: number;       // 高度（像素，默认 20）
  noteName: string;     // 音名（如 "C4", "A3"），决定发声音高
  volume: number;       // 音量（0~1），同时决定自然衰减时长
  timbre: "piano";      // v1 固定钢琴音色，不可更改
}
```

**约束**：
- `kind` 必须为 `"music-block"`
- `noteName` 必须是有效音名格式（字母+数字，如 `C4`、`A#3`），不可为空
- `volume` 范围 `[0, 1]`；反序列化时执行 `Math.max(0, Math.min(1, volume))` 夹紧
- `timbre` 必须为 `"piano"`（v1 固定值，不暴露选择）
- **无 `durationMs` 字段**：音符持续时长由 `volume` 的自然衰减自动决定，不提供显式配置

**音乐参数语义**：
- `noteName`：映射到十二平均律频率（`freq = 440 * 2^((midiNote - 69) / 12)`）
- `volume`：触发瞬间初始音量；衰减时长 = `200ms + volume * 2000ms`
  - `volume=0.1` → 约 400ms（短促轻触音）
  - `volume=0.5` → 约 1200ms（中等标准音）
  - `volume=1.0` → 约 2200ms（长饱满强音）

---

### 1.4 Entity（实体联合类型）

```typescript
type Entity = Ball | Block | MusicBlock;
```

通过 `kind` 字段区分（判别联合，discriminated union）。

---

## 2. 场景与存档结构

### 2.1 Scene（场景）

```typescript
interface Scene {
  id: string;                          // 场景唯一标识（UUID）
  mode: "edit" | "play";               // 当前模式（存档时始终为 "edit"）
  gravity: { x: number; y: number };  // 重力向量（默认 { x: 0, y: 9.8 }）
  selectedBallId: string | null;       // 当前选中球 ID（null 表示无）
  entities: Entity[];                  // 场景中所有实体
}
```

**约束**：
- `mode` 仅为 `"edit"` 或 `"play"`（存档写入时强制覆盖为 `"edit"`）
- `selectedBallId` 若非 null，必须指向 `entities` 中存在的某个 Ball 实体
- `entities` 中每个实体的 `id` 在场景内唯一
- 无 `timeline` 字段（Timeline 数据由 PredictionEngine 运行时计算，不持久化）

---

### 2.2 SaveData（存档顶层结构）

```typescript
interface SaveData {
  version: number;     // 存档版本号（当前固定为 1）
  savedAt: string;     // ISO 8601 时间戳（如 "2026-04-17T10:00:00.000Z"）
  scene: Scene;        // 完整场景数据
}
```

**存储载体**：
- `localStorage.setItem("marble-music-save", JSON.stringify(saveData))`
- Key 固定为 `"marble-music-save"`，不支持多存档槽位

---

## 3. 运行时类型（不持久化）

### 3.1 PredictedNote（预测音符）

PredictionEngine 每次运行产生的碰撞预测记录，用于 Timeline 五线谱渲染。

```typescript
interface PredictedNote {
  timeMs: number;          // 预测碰撞时间（自模拟开始的毫秒数）
  ballId: string;          // 碰撞的小球 ID
  musicBlockId: string;    // 被碰撞的音乐方块 ID
  noteName: string;        // 该音乐方块的音名
  volume: number;          // 该音乐方块的音量
}
```

**规则**：
- 纯运行时数据，不写入 localStorage
- 由 PredictionEngine 在编辑态场景变更后重新计算
- 供 TimelineStaffRenderer 按 `ballId` 分组渲染五线谱
- `timeMs` 精度接受 ±50ms 误差（TR-07 容差设计）

---

### 3.2 CollisionEvent（碰撞事件）

PhysicsWorld 在播放态输出的实时碰撞事件，用于触发音频。

```typescript
interface CollisionEvent {
  ballId: string;          // 碰撞的小球 ID
  musicBlockId: string;    // 被碰撞的音乐方块 ID
  noteName: string;        // 音乐方块当前音名
  volume: number;          // 音乐方块当前音量
  timestamp: number;       // 事件时间戳（performance.now()）
}
```

**规则**：
- 不持久化
- 每帧由 PhysicsWorld 收集 `collisionStart` 事件后过滤生成
- 传递给 AudioEngine 用于 voice 创建

---

### 3.3 PredictionResult（预测引擎输出）

```typescript
interface PredictionResult {
  trajectories: Map<string, Vec2[]>;  // ballId → 轨迹点序列
  predictedNotes: PredictedNote[];    // 所有预测碰撞音符
  computedAt: number;                  // 计算时间戳（performance.now()）
  stepsRun: number;                   // 本次预测模拟步数
}

type Vec2 = { x: number; y: number };
```

---

## 4. UI / 模式状态（内存中，不持久化）

```typescript
type AppMode = "edit" | "play";

interface CameraState {
  cx: number;          // 相机中心 X（世界坐标）
  cy: number;          // 相机中心 Y（世界坐标）
  zoom: number;        // 缩放比例（默认 1.0）
  followBallId: string | null;  // 当前跟随的球 ID（null 表示手动相机）
}

type SaveStatus = "idle" | "saving" | "saved" | "failed";
```

---

## 5. 验证规则汇总

| 字段 | 验证规则 | 失败行为 |
|------|---------|---------|
| `entity.kind` | 必须为 `"ball"` / `"block"` / `"music-block"` | 整体存档回退空场景 |
| `entity.id` | 非空字符串，场景内唯一 | 整体存档回退空场景 |
| `scene.mode` | 必须为 `"edit"` 或 `"play"` | 整体存档回退空场景 |
| `musicBlock.noteName` | 非空字符串，格式为音名 | 整体存档回退空场景 |
| `musicBlock.volume` | 数字，范围 0~1 | 夹紧到 [0,1]，不拒绝整体 |
| `musicBlock.timbre` | 必须为 `"piano"` | 整体存档回退空场景 |
| `musicBlock.durationMs` | **字段不应存在** | 反序列化时忽略该字段 |
| `saveData.version` | 正整数，≤ MAX_KNOWN_VERSION | > MAX 时回退空场景 |
| `ball.radius` | 正数 | 整体存档回退空场景 |
| `block/musicBlock.width/height` | 正数 | 整体存档回退空场景 |

---

## 6. 持久化边界

| 数据 | 持久化 | 原因 |
|------|--------|------|
| Ball / Block / MusicBlock（位置、参数） | ✅ 是 | 场景结构和音乐配置 |
| `selectedBallId` | ✅ 是 | 恢复后保留跟随意图 |
| `gravity` | ✅ 是 | 场景级物理参数 |
| `mode` | ✅ 是（强制写 "edit"） | 恢复时始终进入编辑态 |
| `PredictedNote[]` | ❌ 否 | 运行时计算，依赖实时场景 |
| 预测线轨迹 | ❌ 否 | 运行时计算 |
| 播放态物理状态（速度等） | ❌ 否 | 播放是临时模拟 |
| 活跃 voice / AudioNode | ❌ 否 | 瞬时音频资源 |
| CameraState | ❌ 否 | 会话级 UI 状态 |
