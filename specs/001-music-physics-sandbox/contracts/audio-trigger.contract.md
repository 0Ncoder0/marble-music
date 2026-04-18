# Contract: Audio Trigger

**契约 ID**: `audio-trigger`  
**版本**: v1  
**契约类型**: 模块内部接口契约（PhysicsWorld → AudioEngine）  
**日期**: 2026-04-17

---

## 概述

本契约定义 `PhysicsWorld` 检测到碰撞后向 `AudioEngine` 传递触发事件的接口规范。  
它是播放态核心数据流的关键接口：

```
PhysicsWorld → [CollisionEvent] → AudioEngine → PianoSynth → 音符发声
```

---

## 触发条件

**触发者**：`PhysicsWorld`  
**触发时机**：播放态每一帧中，Matter.js `collisionStart` 事件包含以下组合时：
- 一方实体 `kind === "ball"`
- 另一方实体 `kind === "music-block"`

---

## CollisionEvent 接口

```typescript
interface CollisionEvent {
  /** 碰撞的小球实体 ID */
  ballId: string;

  /** 被碰撞的音乐方块实体 ID */
  musicBlockId: string;

  /** 音乐方块当前 noteName（音名），如 "C4" */
  noteName: string;

  /** 音乐方块当前 volume（0~1） */
  volume: number;

  /** 事件产生时间戳（performance.now()，毫秒） */
  timestamp: number;
}
```

**约束**：
- `noteName` 非空，格式为有效音名
- `volume` 在 `[0, 1]` 范围内（来自 MusicBlock 数据，已验证）
- **无 `durationMs` 字段**：音符时长由 AudioEngine 根据 `volume` 计算衰减包络

---

## AudioEngine 接口

```typescript
interface AudioEngine {
  /**
   * 处理单帧内收集的所有碰撞事件。
   * 内部执行同帧上限检查（MAX_VOICES_PER_FRAME = 16）后依次创建 voice。
   */
  processCollisions(events: CollisionEvent[]): void;

  /**
   * 进入播放态时调用，初始化监听状态。
   * 若 AudioContext 处于 suspended 状态，尝试 resume()。
   */
  listen(): void;

  /**
   * 退出播放态时调用，停止接受新触发。
   * 已在发声中的 voice 允许自然衰减完毕。
   */
  stopListening(): void;

  /** 当前活跃 voice 数量（开发调试用） */
  readonly activeVoiceCount: number;
}
```

---

## Voice 创建规则

每次触发创建一个**独立** voice 实例：

```
processCollisions(events) 执行逻辑：
├─ 检查 this.activeVoiceCount >= MAX_TOTAL_VOICES (64) → 跳过全部，记录日志
├─ 初始化帧计数器 frameTriggers = 0
└─ 对每个 event:
    ├─ frameTriggers >= MAX_VOICES_PER_FRAME (16) → 跳过，记录日志
    └─ PianoSynth.createVoice(event.noteName, event.volume)
       └─ frameTriggers++, activeVoiceCount++
```

---

## 限流规则

| 参数 | 值 | 说明 |
|------|----|------|
| `MAX_VOICES_PER_FRAME` | 16 | 单帧内最多创建的新 voice 数（防止碰撞风暴） |
| `MAX_TOTAL_VOICES` | 64 | 全局同时存在的活跃 voice 上限 |
| 超限行为 | 跳过新触发 | 不发声，不崩溃，记录诊断日志 |
| 已有 voice | 不受影响 | 超限不会打断正在发声的 voice |

**重要**：限流是性能保护，不是设计约束。核心设计仍然是"允许重叠发声，无冷却抑制"（GDD C4）。

---

## Voice 生命周期（PianoSynth 职责）

```
createVoice(noteName, volume):
  1. noteNameToFreq(noteName) → frequency
  2. audioCtx.createOscillator() + audioCtx.createGain()
  3. Attack: 0ms → volume, 线性上升 8ms
  4. Decay: volume → 0.001, 指数衰减，时长 = 200ms + volume * 2000ms
  5. osc.stop() 后 disconnect()，activeVoiceCount--
```

**关键约束**：
- 无 `durationMs` 参数传入
- 衰减时长完全由 `volume` 计算
- `volume=0` 时仍有 `BASE_DECAY=200ms` 最小衰减

---

## 错误处理

| 场景 | 处理方式 |
|------|---------|
| `AudioContext.state === 'suspended'` | 跳过 voice 创建，记录告警，HUD 显示"点击以启用音频" |
| `noteName` 格式非法 | 跳过该 voice，记录告警，不崩溃 |
| `AudioContext` 创建 AudioNode 失败 | 捕获异常，记录错误，不崩溃 |

---

## 不变量（Invariants）

1. `AudioEngine.processCollisions` 仅在播放态调用
2. `AudioEngine.listen()` 在 `ModeController.startPlay()` 切换序列第 8 步调用，紧随第 7 步 `PhysicsWorld.start()` 之后，在首个物理步进前完成监听激活
3. `AudioEngine.stopListening()` 在 `PhysicsWorld.stop()` 之后立即调用
4. CollisionEvent 中不包含 `durationMs` 字段
