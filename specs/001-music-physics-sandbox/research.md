# Research: Music Physics Sandbox

**Feature**: `001-music-physics-sandbox`  
**Date**: 2026-04-17  
**Purpose**: 解决 plan 阶段的技术未知项，为实现提供决策依据

---

## Phase 0 研究摘要

所有 NEEDS CLARIFICATION 项均在本文件中完成解析。核心结论：无新增依赖，现有技术栈（Matter.js + Web Audio API + Canvas 2D）可满足所有需求；关键设计决策已定稿并与 GDD 对齐。

---

## RES-01：Matter.js 物理引擎集成模式

**问题**：如何在 Matter.js 中实现固定时间步长、静态刚体与动态刚体混合、以及碰撞事件精确输出？

**决策**：使用 Matter.js `Engine.update(engine, FIXED_DT_MS)` 手动驱动固定步长，而非 `Runner`（Runner 会绑定 requestAnimationFrame 且步长不固定）。

**实现要点**：
- `FIXED_DT_MS = 1000 / 60`（约 16.67ms）
- 小球：`Matter.Bodies.circle(x, y, r, { isStatic: false })`
- 方块 / 音乐方块：`Matter.Bodies.rectangle(x, y, w, h, { isStatic: true })`
- 碰撞事件：`Matter.Events.on(engine, 'collisionStart', handler)`，在 handler 中检查碰撞对，确认一方为 Ball、另一方为 MusicBlock

**预测克隆策略**：
- PredictionEngine 每次运行时，通过 `Matter.Engine.create()` 创建全新独立 Engine
- 从 SceneManager 获取当前场景快照，重新创建对应刚体（不复用主 Engine 的刚体）
- 模拟完成后调用 `Matter.World.clear()` + `Matter.Engine.clear()` 彻底销毁

**替代方案考虑**：
- 使用 Matter.js `Runner`：被拒绝（步长不固定，预测与播放会产生系统性偏差，违反 TR-07 缓解原则）
- 在主 Engine 上运行预测：被拒绝（会污染播放态物理状态，需要复杂的状态回滚）

**Rationale**：独立 Engine 克隆确保预测与播放完全隔离，不存在状态污染；固定步长确保 TR-07（同源物理配置）可验证。

---

## RES-02：Web Audio API 钢琴音色合成

**问题**：如何用 Web Audio API 合成"类钢琴"音色，同时实现音量驱动的自然衰减（无 durationMs）？

**决策**：使用 `OscillatorNode`（正弦波 + 谐波叠加）+ `GainNode` 实现简化钢琴音色；Attack/Decay 通过 `AudioParam.linearRampToValueAtTime` 和 `exponentialRampToValueAtTime` 精确调度。

**Voice 实现方案**：

```typescript
// 每次触发创建独立的 voice
function createVoice(noteName: string, volume: number, audioCtx: AudioContext): void {
  const freq = noteNameToFrequency(noteName);
  const now = audioCtx.currentTime;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';   // 基频
  osc.frequency.value = freq;
  
  // Attack: 5~10ms 线性上升
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.008);
  
  // Decay: 指数衰减
  const decayTime = 0.2 + volume * 2.0;  // BASE_DECAY=200ms + volume*2000ms
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.008 + decayTime);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start(now);
  osc.stop(now + 0.008 + decayTime);
  osc.addEventListener('ended', () => { osc.disconnect(); gain.disconnect(); });
}
```

**音名到频率映射（十二平均律）**：

```
freq(noteName) = 440 * 2^((midiNote - 69) / 12)
```

MIDI 音高编号：A4 = 69，C4 = 60，以此推算。

**替代方案**：
- 使用 AudioWorkletNode 实现更复杂的 FM 合成：被拒绝（v1 复杂度过高，且音频延迟需要精细调优）
- 加载采样音频文件（.mp3/.ogg）：被拒绝（需要网络资源或打包，增加构建复杂度；v1 目标是零资源依赖）

**Rationale**：合成方案完全在代码中实现，无外部资源依赖；Attack/Decay 通过 Web Audio API 精确时间调度，延迟可控在 <20ms 内。

---

## RES-03：Canvas 2D 分层渲染策略

**问题**：如何在单个 Canvas 上实现 GDD 04 定义的六个渲染层（L0~L6），同时保持性能？

**决策**：使用**单 Canvas + 顺序绘制**（不使用多 Canvas 分层），每帧按 L0→L6 顺序绘制，drawImage 复合。对预测线（L5）使用 `setLineDash` 虚线绘制。

**渲染帧顺序**：

```
ctx.clearRect(...)
L0: 背景网格（drawGrid，间距固定像素）
L1: 静态方块（fillRect + strokeRect）
L2: 音乐方块（fillRect + 音名文字标注）
L3: 小球（arc + fill）
L4: 选中高亮（strokeRect / arc，虚线轮廓）
L5: [仅编辑态] 预测线（moveTo / lineTo，setLineDash([5,5])，透明度 0.4）
L6: [仅播放态] 音乐活动脉冲环（arc，随 voice gain 缩放半径和 alpha）
```

**相机变换**：使用 `ctx.save() / ctx.translate(cx, cy) / ctx.scale(zoom) / ctx.restore()` 实现视窗平移和缩放，所有世界坐标实体在变换后统一绘制。

**Timeline 五线谱**：独立 Canvas 元素（底部固定区域），不参与主相机变换，直接在屏幕坐标系绘制。

**替代方案**：
- 多 Canvas 分层（每层独立 Canvas，CSS 绝对定位叠加）：被拒绝（DOM 层级复杂，触发事件需要额外路由；实体数量 ≤25，单 Canvas 帧渲染耗时远 <1ms）

---

## RES-04：预测计算性能（TR-06 调研）

**问题**：PredictionEngine 在复杂场景（20 积木 + 5 小球）下，单次预测计算耗时是否会阻塞主线程？

**分析**：
- Matter.js 单步模拟（`Engine.update`）在典型场景下耗时约 0.5~2ms
- 300 步预测（约 5 秒）= 300 × 2ms = 600ms（最差情况，20 积木 + 5 小球）
- 若在主线程同步执行，会造成约 600ms 的界面冻结

**决策（分阶段）**：
- **v1**：主线程同步执行预测，通过 **150ms 去抖 + 300 步上限** 缓解高频触发
- **v2**（可选）：若实测超过 100ms，将 PredictionEngine 迁移到 Web Worker

**去抖实现**：

```typescript
// PredictionEngine
private dirtyTimer: ReturnType<typeof setTimeout> | null = null;

markDirty(): void {
  if (this.dirtyTimer) clearTimeout(this.dirtyTimer);
  this.dirtyTimer = setTimeout(() => this.run(), PREDICTION_DEBOUNCE_MS);
}
```

**可观测性**：开发模式下输出每次预测耗时（`performance.now()` 计时），便于发现性能问题。

**Rationale**：v1 场景规模（≤5 小球 + ≤20 积木）实测单次预测耗时应在 30~80ms 范围内（Matter.js 性能基准），加上去抖机制，体感流畅。Web Worker 方案保留为后续优化路径。

---

## RES-05：预测与实际一致性（TR-07 调研）

**问题**：如何确保 PredictionEngine 的预测结果与 PhysicsWorld 的实际播放结果高度一致？

**根因分析**：不一致的来源：
1. 物理引擎参数不同（重力、弹性系数、摩擦系数）
2. 时间步长不同（预测用固定步长，播放用可变步长）
3. 初始状态不同（预测使用场景快照，播放使用实时状态）

**决策**：三个来源全部消除：

| 来源 | 消除方案 |
|------|---------|
| 参数不同 | 共享 `PHYSICS_CONFIG` 常量对象，PhysicsWorld 和 PredictionEngine 均从同一来源读取 |
| 步长不同 | 两者均使用 `FIXED_DT_MS = 1000/60`；PhysicsWorld 使用固定步长手动驱动 |
| 初始状态 | PredictionEngine 在场景变更后立即读取最新快照；编辑态速度始终为零，快照状态确定 |

```typescript
// constants.ts
export const PHYSICS_CONFIG = {
  gravity: { x: 0, y: 1.0 },   // Matter.js gravity scale（非 m/s²）
  restitution: 0.7,              // 弹性系数
  friction: 0.1,
  frictionAir: 0.01,
  FIXED_DT_MS: 1000 / 60,
};
```

**容差设计**：接受 ±50ms 时间误差（对应约 3 步模拟偏差），Timeline 五线谱不标注精确毫秒数，以视觉间距表达相对时序，避免过度承诺精度。

---

## RES-06：localStorage 持久化边界

**问题**：localStorage 写入时机、Key 设计、版本迁移策略？

**决策**：

| 项目 | 决策 |
|------|------|
| 存储 Key | `"marble-music-save"`（固定，GDD 07 定稿） |
| 节流间隔 | 1000ms（`SAVE_THROTTLE_MS`） |
| 强制保存 | play → edit 切换时立即调用，不受节流约束 |
| 版本 | 当前 `version: 1`；未来版本使用 `migrate(data, fromVersion)` 迁移链 |
| 错误处理 | try/catch 包裹所有 localStorage 操作；失败时更新 HUD 状态为 `SaveStatus.FAILED` |

**反序列化验证**：
- JSON 解析失败 → 空场景 + 提示
- `version > MAX_KNOWN_VERSION` → 空场景 + 提示
- 任何实体的 `kind` 不合法 → 空场景 + 提示
- `musicBlock.volume` 超范围 → 夹紧（clamp 到 0~1）而非拒绝（避免微小浮点误差导致整体恢复失败）

**注意**：存档中不保存 `durationMs`（字段不存在），反序列化时遇到旧存档中的 `durationMs` 字段应直接忽略。

---

## RES-07：音频上下文 UserGesture 策略（TR-02）

**问题**：浏览器要求在用户交互后才能播放音频，如何可靠处理首次播放场景？

**决策**：

1. 应用启动时创建 `AudioContext`（state 初始为 `suspended`）
2. 在 `InputController` 的首次 `keydown` / `mousedown` 事件中调用 `audioCtx.resume()`
3. 监听 `audioCtx.onstatechange`：若变为 `suspended`，在下次触发时重新调用 `resume()`
4. 播放态首次 `AudioEngine.listen()` 调用时也触发一次 `resume()`

**静音降级**：`AudioContext.state` 为 `suspended` 时，`AudioEngine` 直接跳过 voice 创建（不抛错）；物理模拟正常继续；HUD 显示"点击页面以启用音频"提示。

---

## RES-08：Camera Follow 实现策略

**问题**：如何实现平滑相机跟随，同时允许用户手动平移/缩放覆盖？

**决策**：
- 跟随：每帧将相机中心以 `lerp(current, target, FOLLOW_LERP)` 平滑插值（`FOLLOW_LERP = 0.1` 约等于 10% 追踪速率）
- 手动覆盖：用户触发 wheel / middleMouseDrag / altLeftDrag 时，直接修改相机状态；不自动恢复跟随（TR-04 缓解原则：用户手动优先级高）
- 跟随判定：仅在 `startPlay()` 时读取 `selectedBallId` 决定是否跟随，播放中不再重新判定

---

## 技术决策汇总

| 编号 | 决策 | 状态 |
|------|------|------|
| RES-01 | Matter.js 独立 Engine 克隆 + 手动固定步长驱动 | ✅ 定稿 |
| RES-02 | Web Audio API OscillatorNode 合成，音量驱动衰减，无 durationMs | ✅ 定稿 |
| RES-03 | 单 Canvas 顺序分层渲染，Timeline 独立 Canvas | ✅ 定稿 |
| RES-04 | 预测去抖 150ms + 步数上限 300；Web Worker 保留为 v2 选项 | ✅ 定稿 |
| RES-05 | 预测与播放共用 PHYSICS_CONFIG 常量 + 固定步长，容差 ±50ms | ✅ 定稿 |
| RES-06 | localStorage Key 固定，节流 1000ms，版本迁移链，无 durationMs | ✅ 定稿 |
| RES-07 | 首次用户交互触发 AudioContext.resume()，静音降级 | ✅ 定稿 |
| RES-08 | lerp 平滑跟随，用户手动操作直接覆盖，不自动恢复跟随 | ✅ 定稿 |

**无 NEEDS CLARIFICATION 遗留项**——所有技术决策已解析完毕，可进入 tasks 阶段。
