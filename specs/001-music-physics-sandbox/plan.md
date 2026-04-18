# Implementation Plan: Music Physics Sandbox

**Branch**: `001-music-physics-sandbox` | **Date**: 2026-04-17 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/001-music-physics-sandbox/spec.md`

---

## Summary

构建一个 PC Web 单体前端应用——Marble Music 音乐物理沙盒。玩家在 2D 画布上放置小球、方块和音乐方块，搭建物理结构；编辑态实时预测小球轨迹并以五线谱展示碰撞音符序列；按 Space 进入播放态后，物理引擎驱动小球碰撞音乐方块，通过 Web Audio API 触发钢琴音符实时发声；场景通过 localStorage 自动持久化，刷新后完整恢复。

技术方向：Vite + TypeScript + Matter.js + Web Audio API + Canvas 2D，纯前端单体，无后端依赖。

---

## Technical Context

**Language/Version**: TypeScript 5.x（targeting ES2022）  
**Primary Dependencies**: Matter.js 0.19.x（物理引擎）、Vite 5.x（构建/开发服务器）  
**Storage**: Browser `localStorage`（固定 Key `"marble-music-save"`，无云端/无账号）  
**Testing**: Vitest（单元测试）、Playwright（端到端测试）  
**Target Platform**: PC Web，Chrome / Edge / Firefox 桌面最新版  
**Project Type**: Single-page Web Application（纯前端，无路由，无框架 UI 库）  
**Performance Goals**: 标准场景（≤20 积木、≤5 小球）60 fps 流畅渲染；碰撞到发声延迟 <20ms  
**Constraints**:

- 无暂停态（C1）——模式状态机仅 `edit` / `play` 两态
- 无 `durationMs`（GDD 07 定稿）——音符时长完全由 `volume` 驱动的自然衰减决定
- 预测与播放同源物理配置（TR-07 缓解）——PredictionEngine 与 PhysicsWorld 共用完全相同的 Matter.js Engine 配置和固定时间步长
- 无导入导出、无网络请求、无移动端适配

**Scale/Scope**: 单 HTML 页面；实体规模 ≤ 20 积木 + 5 小球为目标性能基准

---

## Constitution Check

> constitution.md 当前为模板占位符（未填写项目原则），不存在可失败的约束门禁。  
> 以下改用 **GDD 全局强约束（00-index.md C1~C5）**作为等价门禁。

| 门禁          | 约束                                              | 本次设计通过？ | 依据                                                                |
| ------------- | ------------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| C1-GATE       | 无暂停态，Space 仅播放/停止                       | ✅ 通过        | ModeController 仅 `edit`/`play` 两态，详见状态机章节                |
| C2-GATE       | Timeline 是编辑态实时预测五线谱，播放时隐藏       | ✅ 通过        | TimelineStaffRenderer 仅编辑态可见；PredictionEngine 播放态停止计算 |
| C3-GATE       | 预测线仅编辑态可见                                | ✅ 通过        | CanvasRenderer 在编辑态渲染预测线层（L5），播放态跳过               |
| C4-GATE       | 触发即发声，音量驱动衰减，允许重叠，无 durationMs | ✅ 通过        | AudioEngine 每次碰撞创建独立 voice；MusicBlock 无 durationMs 字段   |
| C5-GATE       | 选中球跟随策略（选中≠跟随，播放启动时判定）       | ✅ 通过        | CameraFollowController 仅在 startPlay() 时读取 selectedBallId       |
| NO-PAUSE      | 系统中不存在任何暂停路径                          | ✅ 通过        | 状态机无第三状态；Esc 在播放态直接返回编辑态                        |
| NO-durationMs | MusicBlock 数据模型不含 durationMs                | ✅ 通过        | data-model.md 及 contracts/ schema 均无此字段                       |

**Gate 结论**：全部通过，可进入实现阶段。

---

## Project Structure

### Documentation (this feature)

```text
specs/001-music-physics-sandbox/
├── spec.md              # 需求规格
├── plan.md              # 本文件（plan 阶段产出）
├── research.md          # 技术研究与决策（plan 阶段产出）
├── data-model.md        # 数据模型（plan 阶段产出）
├── quickstart.md        # 开发快速启动（plan 阶段产出）
├── contracts/           # 接口契约（plan 阶段产出）
│   ├── sandbox-state.schema.json     # SaveData / Scene / Entity JSON Schema
│   ├── audio-trigger.contract.md     # 碰撞触发 → AudioEngine 接口契约
│   └── prediction.contract.md        # PredictionEngine 输入/输出契约
└── tasks.md             # 任务拆解（tasks 阶段产出，未创建）
```

### Source Code Layout

```text
marble-music/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
│
├── src/
│   ├── main.ts                        # 应用入口，挂载 GameApp
│   │
│   ├── app/
│   │   ├── GameApp.ts                 # 主循环编排，初始化所有子系统
│   │   ├── ModeController.ts          # 编辑/播放状态机，权限闸门
│   │   └── InputController.ts         # 键鼠事件捕获，按模式分发
│   │
│   ├── scene/
│   │   ├── SceneManager.ts            # 实体集合 CRUD，变更通知
│   │   ├── EntityFactory.ts           # Ball / Block / MusicBlock 工厂
│   │   └── types.ts                   # Scene / Entity 类型定义（与 GDD 07 对齐）
│   │
│   ├── physics/
│   │   ├── PhysicsWorld.ts            # Matter.js 封装，刚体映射，碰撞事件
│   │   ├── PredictionEngine.ts        # 场景快照 → 预测轨迹 + PredictedNote[]
│   │   └── CameraFollowController.ts  # 自动跟随 / 手动相机协调
│   │
│   ├── audio/
│   │   ├── AudioEngine.ts             # 碰撞触发 → voice 调度，限流，混音
│   │   └── PianoSynth.ts              # 音名→频率，音量→衰减包络，voice 实例
│   │
│   ├── ui/
│   │   ├── CanvasRenderer.ts          # 主画布：网格/实体/预测线/特效
│   │   ├── TimelineStaffRenderer.ts   # 底部五线谱渲染（PredictedNote[]）
│   │   ├── PanelRenderer.ts           # 右侧积木选择器 + 参数编辑面板
│   │   └── HudRenderer.ts             # 左上模式 HUD + 右上保存状态 HUD
│   │
│   ├── persistence/
│   │   ├── LocalSaveRepository.ts     # 节流保存 / 强制保存 / 恢复
│   │   └── SceneSerializer.ts         # Scene ↔ JSON 序列化/反序列化，版本校验
│   │
│   └── constants.ts                   # 全局常量（SAVE_KEY, THROTTLE_MS, etc.）
│
└── tests/
    ├── unit/
    │   ├── ModeController.test.ts
    │   ├── PhysicsWorld.test.ts
    │   ├── PredictionEngine.test.ts
    │   ├── AudioEngine.test.ts
    │   └── LocalSaveRepository.test.ts
    └── e2e/
        ├── core-loop.spec.ts
        ├── timeline-staff.spec.ts
        ├── mode-isolation.spec.ts
        ├── camera-follow.spec.ts
        └── persistence.spec.ts
```

**Structure Decision**: 单 SPA 项目，按 GDD 06 六层模块划分（`app/` `scene/` `physics/` `audio/` `ui/` `persistence/`）。无 UI 框架依赖——所有 UI 通过 Canvas 2D 和原生 DOM 元素实现，无 React/Vue。

---

## Mode State Machine

模式状态机是全系统的权限闸门。由 `ModeController` 实现，状态枚举仅两个值：

```
  ┌──────────┐   startPlay()    ┌──────────┐
  │   edit   │ ──────────────► │   play   │
  │          │ ◄────────────── │          │
  └──────────┘   stopPlay()    └──────────┘
               (Space / Esc)
```

### Edit → Play 切换序列（严格顺序）

1. `InputController.lockEditing()` — 阻断所有编辑输入
2. `PanelRenderer.hide()` — 隐藏右侧面板
3. `TimelineStaffRenderer.hide()` — 隐藏底部五线谱
4. `CanvasRenderer.disablePredictionLayer()` — 停止预测线渲染
5. `PredictionEngine.pause()` — 停止预测计算
6. `CameraFollowController.resolveCameraTarget(selectedBallId)` — 判定跟随目标
7. `PhysicsWorld.start()` — 启动物理步进
8. `AudioEngine.listen()` — 开始监听碰撞事件

### Play → Edit 切换序列

1. `PhysicsWorld.stop()` — 停止物理步进
2. `AudioEngine.stopListening()` — 停止新触发（已发声 voice 自然衰减）
3. `InputController.unlockEditing()` — 恢复编辑权限
4. `PanelRenderer.show()` — 恢复右侧面板
5. `PredictionEngine.resume()` — 恢复预测计算
6. `TimelineStaffRenderer.show()` — 恢复底部五线谱显示
7. `PredictionEngine.invalidate()` — 触发一次强制预测重算
8. `LocalSaveRepository.forceSave(scene)` — 强制保存（不受节流约束）

---

## Architecture Layers & Module Contracts

### 分层职责总览

| 层       | 模块                                                                   | 职责边界                       | 关键不变量                         |
| -------- | ---------------------------------------------------------------------- | ------------------------------ | ---------------------------------- |
| 应用编排 | `GameApp` `ModeController` `InputController`                           | 主循环、状态机、事件路由       | 任意时刻模式唯一；输入按模式路由   |
| 实体管理 | `SceneManager` `EntityFactory`                                         | 实体 CRUD；变更通知；场景快照  | 实体 ID 唯一；编辑态速度为零       |
| 物理     | `PhysicsWorld` `PredictionEngine` `CameraFollowController`             | 刚体映射；碰撞事件；预测模拟   | 预测与播放同源物理配置             |
| 音频     | `AudioEngine` `PianoSynth`                                             | voice 生命周期；发声触发；限流 | 无 durationMs；音量驱动衰减        |
| UI       | `CanvasRenderer` `TimelineStaffRenderer` `PanelRenderer` `HudRenderer` | 渲染；用户操作转事件           | 播放态所有编辑 UI 隐藏             |
| 持久化   | `LocalSaveRepository` `SceneSerializer`                                | 节流/强制保存；恢复；版本迁移  | 存档不含预测数据；mode 存为 "edit" |

### 主循环帧序（`requestAnimationFrame`）

```
每帧执行顺序
├─ 1. InputController.process()           输入处理，按模式分发
├─ 2. ModeController.flushPending()       处理本帧模式切换请求
├─ 3. [仅 edit 且场景脏] PredictionEngine.runIfDirty()   预测更新（去抖 100~200ms）
├─ 4. [仅 play] PhysicsWorld.step(fixedDt) 物理步进（固定步长）
├─ 5. [仅 play] AudioEngine.processCollisions(events)   音频触发
├─ 6. CameraFollowController.update()     相机更新（跟随 / 手动）
├─ 7. CanvasRenderer.render()             主画布渲染（含预测线）
├─ 8. TimelineStaffRenderer.render()      五线谱渲染（仅 edit）
├─ 9. PanelRenderer.render() + HudRenderer.render()  UI 更新
└─ 10. LocalSaveRepository.tick()          节流保存检查
```

---

## Prediction System Design

### 同源物理配置（TR-07 核心缓解）

`PredictionEngine` 使用与 `PhysicsWorld` **完全相同**的 Matter.js Engine 参数和固定时间步长 `FIXED_DT_MS`。预测时克隆场景快照创建独立的 Engine 实例，运行 N 步后销毁。

```typescript
// 共享常量
const FIXED_DT_MS = 1000 / 60; // 约 16.67ms
const PREDICTION_MAX_STEPS = 300; // 约 5 秒预测窗口
const PREDICTION_DEBOUNCE_MS = 150; // 编辑操作后去抖时间
```

### 预测触发逻辑

```
SceneManager.onChange()
    │
    └─► PredictionEngine.markDirty()
              │
    (下一帧，距上次触发 > PREDICTION_DEBOUNCE_MS)
              │
              └─► 克隆场景快照 → 运行模拟 → 输出:
                      ├─ trajectories: Vec2[][] （每个球的轨迹点序列）
                      └─ predictedNotes: PredictedNote[]
```

### 输出消费

- `CanvasRenderer`：读取 `trajectories` 绘制预测线（L5 层，虚线）
- `TimelineStaffRenderer`：读取 `predictedNotes` 按 `ballId` 分组渲染五线谱

---

## Audio System Design

### Voice 生命周期

```
触发碰撞事件
    │
    ├─ [超帧上限 N=16 或总活跃上限 M=64] → 跳过，记录日志
    │
    └─► PianoSynth.createVoice(noteName, volume)
              │
              ├─ OscillatorNode（频率 = noteNameToFreq(noteName)）
              ├─ GainNode（初始 gain = volume）
              ├─ Attack: 5~10ms 线性 ramp up
              └─ Decay: BASE_DECAY(200ms) + volume * VOLUME_DECAY_SCALE(2000ms)
                        指数衰减到 0.001 → stop() → disconnect()
```

### 音频上下文初始化

首次用户交互（click / keydown）后调用 `AudioContext.resume()`；未授权时物理模拟继续运行（静音降级），HUD 显示"点击以启用音频"提示。

---

## Persistence Design

### 存档结构（与 GDD 07 完全对齐）

```typescript
interface SaveData {
  version: 1;
  savedAt: string; // ISO 8601
  scene: Scene;
}
```

`scene.mode` 保存为 `"edit"`（播放态不持久化）。

### 保存策略

| 触发                            | 方式     | 延迟                 |
| ------------------------------- | -------- | -------------------- |
| 编辑操作后                      | 节流保存 | 1000ms               |
| play → edit                     | 强制保存 | 立即                 |
| visibilitychange / beforeunload | 尝试保存 | 立即（受浏览器限制） |

### 恢复与错误处理

| 状态           | 行为                                                |
| -------------- | --------------------------------------------------- |
| 无数据         | 创建空场景，正常启动                                |
| JSON 解析失败  | 空场景 + HUD 提示"存档损坏"                         |
| version > 1    | 空场景 + HUD 提示"存档版本过高"                     |
| 实体数据不完整 | 空场景 + HUD 提示"存档数据不完整"                   |
| 恢复成功       | 触发一次预测重算，Timeline 显示恢复后场景的预测结果 |

---

## UI Visibility Rules

| 组件                 | 编辑态                 | 播放态                       |
| -------------------- | ---------------------- | ---------------------------- |
| 右侧积木选择器       | 显示                   | **隐藏**                     |
| 右侧参数面板         | 显示（选中音乐方块时） | **隐藏**                     |
| 底部 Timeline 五线谱 | 显示                   | **隐藏**                     |
| 预测线（Canvas L5）  | 显示                   | **不渲染**                   |
| 左上模式 HUD         | 显示"按 Space 播放"    | 显示"播放中...按 Space 停止" |
| 右上保存 HUD         | 显示                   | 显示                         |
| 音乐活动脉冲特效     | 不活跃                 | **活跃**                     |

---

## Testing Strategy

### 单元测试覆盖（Vitest）

| 模块                | 核心测试用例（来自 GDD 08）                             |
| ------------------- | ------------------------------------------------------- |
| ModeController      | MC-01~MC-06：状态机正确性，canEdit() 权限闸门           |
| PhysicsWorld        | PW-01~PW-04：仅 Ball 运动，碰撞事件输出                 |
| PredictionEngine    | PE-01~PE-06：编辑态计算，播放态跳过，PredictedNote 同源 |
| AudioEngine         | AE-01~AE-07：独立 voice，重叠，限流，无 durationMs      |
| LocalSaveRepository | LS-01~LS-06：节流，强制保存，损坏恢复，无 durationMs    |

### 端到端测试覆盖（Playwright）

| 用例组                         | 覆盖约束   |
| ------------------------------ | ---------- |
| E2E-01~03：核心闭环            | C2, C4     |
| E2E-04~08：Timeline 五线谱     | C2, C3     |
| E2E-09~12：模式隔离            | C1, C2     |
| E2E-13~16：播放/停止（无暂停） | C1         |
| E2E-17~19：多球跟随            | C5         |
| E2E-20~23：存档恢复            | FR-029~034 |
| E2E-24~25：音量驱动衰减        | C4         |

---

## Risk Register & Design Decisions

| 风险 ID | 风险描述                   | 设计决策               | 缓解措施                                                             |
| ------- | -------------------------- | ---------------------- | -------------------------------------------------------------------- |
| TR-01   | 高频碰撞音频实例激增、爆音 | AudioEngine 双上限保护 | 同帧 ≤16 voice；总活跃 ≤64；超限跳过不崩溃；开发模式显示 voice 计数  |
| TR-02   | 浏览器音频首帧不稳定       | 延迟初始化 + 静音降级  | 首次用户交互后 `AudioContext.resume()`；未授权时静音继续             |
| TR-03   | localStorage 配额/权限失败 | 失败可感知 + 不静默    | HUD 持续显示失败提示；下次编辑重试；容量预检（可选）                 |
| TR-06   | 预测计算阻塞编辑           | 去抖 + 步数上限        | 150ms 去抖；≤300 步上限（约 5 秒）；Web Worker 作为 v2 可选项        |
| TR-07   | 预测与实际不一致           | 同源物理配置           | 预测/播放共用相同 Matter.js Engine 配置 + 固定步长；接受微小时间误差 |

---

## Phase Deliverables Summary

| 产物         | 路径                                                                  | 状态             |
| ------------ | --------------------------------------------------------------------- | ---------------- |
| 需求规格     | `specs/001-music-physics-sandbox/spec.md`                             | ✅ 已有          |
| **实现计划** | `specs/001-music-physics-sandbox/plan.md`                             | ✅ 本文件        |
| **技术研究** | `specs/001-music-physics-sandbox/research.md`                         | ✅ Phase 0 产出  |
| **数据模型** | `specs/001-music-physics-sandbox/data-model.md`                       | ✅ Phase 1 产出  |
| **快速启动** | `specs/001-music-physics-sandbox/quickstart.md`                       | ✅ Phase 1 产出  |
| **存档契约** | `specs/001-music-physics-sandbox/contracts/sandbox-state.schema.json` | ✅ Phase 1 产出  |
| **音频契约** | `specs/001-music-physics-sandbox/contracts/audio-trigger.contract.md` | ✅ Phase 1 产出  |
| **预测契约** | `specs/001-music-physics-sandbox/contracts/prediction.contract.md`    | ✅ Phase 1 产出  |
| 任务拆解     | `specs/001-music-physics-sandbox/tasks.md`                            | ⏳ 待 tasks 阶段 |
