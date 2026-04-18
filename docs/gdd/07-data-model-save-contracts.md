# 07 -- 数据模型、存档与契约

## 1. 核心实体数据模型

### Scene（场景）

场景是顶层容器，持有所有实体和运行时状态。

```typescript
interface Scene {
  id: string; // 场景唯一标识
  mode: "edit" | "play"; // 当前模式
  gravity: { x: number; y: number }; // 重力向量（默认 { x: 0, y: 9.8 }）
  selectedBallId: string | null; // 当前选中球 ID，null 表示无选中
  entities: Entity[]; // 场景中所有实体
}
```

**说明**：

- `selectedBallId` 用于播放启动时的跟随目标判定
- `mode` 在存档中始终保存为 `"edit"`（播放态不持久化）
- 不存在 `timeline` 字段——Timeline 五线谱的数据由 PredictionEngine 实时计算，不进入持久化

---

### Ball（小球）

```typescript
interface Ball {
  id: string;
  kind: "ball"; // 类型判别字段
  x: number; // 位置 X
  y: number; // 位置 Y
  vx: number; // 速度 X（编辑态为 0）
  vy: number; // 速度 Y（编辑态为 0）
  radius: number; // 半径
}
```

**规则**：播放态中唯一会被物理引擎推进的实体类型。

---

### Block（方块）

```typescript
interface Block {
  id: string;
  kind: "block"; // 类型判别字段
  x: number; // 中心位置 X
  y: number; // 中心位置 Y
  width: number; // 宽度
  height: number; // 高度
  rotation: number; // 旋转角度（弧度）
}
```

**规则**：始终静态，不参与物理运动。

---

### MusicBlock（音乐方块）

```typescript
interface MusicBlock {
  id: string;
  kind: "music-block"; // 类型判别字段
  x: number; // 中心位置 X
  y: number; // 中心位置 Y
  width: number; // 宽度
  height: number; // 高度
  noteName: string; // 音名（如 "C4"）
  volume: number; // 音量（0 ~ 1），同时决定自然衰减时长
  timbre: "piano"; // v1 固定钢琴音色
}
```

**规则**：

- 参数在编辑态可修改，播放态锁定
- **无 `durationMs` 字段**：声音持续时长由 `volume` 的自然衰减自动决定，不提供显式配置

---

### PredictedNote（预测音符 -- 运行时类型）

PredictionEngine 模拟产生的碰撞预测数据，用于 Timeline 五线谱渲染。

```typescript
interface PredictedNote {
  timeMs: number; // 预测碰撞时间（模拟开始后的毫秒数）
  ballId: string; // 碰撞的小球 ID
  musicBlockId: string; // 被碰撞的音乐方块 ID
  noteName: string; // 该音乐方块的音名
  volume: number; // 该音乐方块的音量
}
```

**规则**：

- 纯运行时数据，不进入持久化存储
- 由 PredictionEngine 在编辑态场景变更时重新计算
- 供 TimelineStaffRenderer 按 `ballId` 分组绘制五线谱

---

### Entity 联合类型

```typescript
type Entity = Ball | Block | MusicBlock;
```

通过 `kind` 字段区分实体类型（判别联合，discriminated union）。

---

## 2. 存档结构

### 顶层格式

```typescript
interface SaveData {
  version: number; // 存档版本号（当前固定为 1）
  savedAt: string; // ISO 8601 时间戳
  scene: Scene; // 完整场景数据
}
```

### 存储载体

- 使用浏览器 `localStorage`
- Key：固定字符串（如 `"marble-music-save"`）
- Value：`JSON.stringify(saveData)`

### 版本策略

| 版本 | 说明                                         |
| ---- | -------------------------------------------- |
| 1    | 当前版本，包含所有 v1 实体和参数             |
| 2+   | 未来版本需提供 `migrate(v: number)` 迁移函数 |

---

## 3. 存档时机

| 触发场景                     | 保存方式 | 说明                                  |
| ---------------------------- | -------- | ------------------------------------- |
| 编辑操作后                   | 节流保存 | 操作后进入节流窗口（如 1~2 秒后写入） |
| 播放 -> 编辑切换             | 强制保存 | 模式切换回编辑态时立即写入            |
| 页面可见性变化（离开标签页） | 尝试保存 | 受浏览器 `visibilitychange` 限制      |
| 页面关闭前                   | 尝试保存 | 受浏览器 `beforeunload` 限制          |

### 节流策略

- 每次编辑操作触发一个保存意图
- 实际写入 `localStorage` 有最小间隔（如 1000 ms）
- 窗口期内的多次操作合并为一次写入
- 强制保存不受节流限制

---

## 4. 恢复流程

```
应用启动
    │
    ▼
读取 localStorage
    │
    ├─ 无数据 → 创建默认空场景
    │
    ├─ JSON 解析失败 → 创建默认空场景 + 提示用户"存档损坏"
    │
    └─ 解析成功
         │
         ▼
    校验 version 字段
         │
         ├─ version == 当前版本 → 直接使用
         ├─ version < 当前版本 → 运行迁移链
         └─ version > 当前版本 → 创建默认空场景 + 提示用户"存档版本过高"
              │
              ▼
    校验实体数据完整性
         │
         ├─ 通过 → 恢复场景 → 触发预测计算（生成 Timeline 五线谱）
         └─ 失败 → 创建默认空场景 + 提示用户"存档数据不完整"
```

### 校验规则

| 字段                | 校验                                          |
| ------------------- | --------------------------------------------- |
| `scene.mode`        | 必须是 `"edit"` 或 `"play"`                   |
| `musicBlock.timbre` | 必须是 `"piano"`                              |
| `musicBlock.volume` | 必须在 `0 ~ 1` 范围内                         |
| `entity.kind`       | 必须是 `"ball"` / `"block"` / `"music-block"` |
| `entity.id`         | 不可为空，场景内唯一                          |

---

## 5. 契约文件对齐

- **契约来源**：`specs/001-music-physics-sandbox/contracts/sandbox-state.schema.json`
- **优先级**：GDD 与契约冲突时，以契约中的校验规则为准，随后更新 GDD 叙述使其一致

### 强约束汇总

| 约束                             | 来源 |
| -------------------------------- | ---- |
| `scene.mode` 仅 `edit`/`play`    | 契约 |
| `musicBlock.timbre` 固定 `piano` | 契约 |
| `volume` 范围 `0 ~ 1`            | 契约 |

**注意**：原契约中的 `durationMs > 0` 约束已移除，该字段不再存在于数据模型中。契约 schema 需同步更新。

---

## 6. 持久化边界说明

以下数据**不进入持久化**：

| 数据            | 原因                                                     |
| --------------- | -------------------------------------------------------- |
| 预测线          | 运行时计算结果，依赖实时场景快照                         |
| Timeline 五线谱 | 由 PredictionEngine 实时计算的 PredictedNote，非持久数据 |
| 播放态物理状态  | 播放是临时模拟，停止后回退到编辑态初始状态               |
| 活跃 voice      | 音频实例是瞬时的，不需要保存                             |
| 跟随状态        | 由 `selectedBallId` + 播放启动判定推导，不需独立存储     |

以下数据**进入持久化**：

| 数据             | 说明                         |
| ---------------- | ---------------------------- |
| 所有实体         | 位置、尺寸、参数完整保存     |
| `selectedBallId` | 恢复后保留用户上次的选中状态 |
| 重力配置         | 场景级参数                   |
