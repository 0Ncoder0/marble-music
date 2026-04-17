# Quickstart: Music Physics Sandbox

**Feature**: `001-music-physics-sandbox`  
**Date**: 2026-04-17  
**Target**: 开发者快速上手、验收测试执行、冒烟检验指南

---

## 1. 环境要求

| 工具 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | 20.x LTS 或 22.x | 运行 Vite 和测试工具 |
| pnpm / npm | pnpm 8+ 或 npm 9+ | 包管理器 |
| Chrome / Edge | 最新版（>= 120） | 主要开发和测试目标浏览器 |
| Firefox | 最新版 | 兼容性验证 |

---

## 2. 项目初始化

```bash
# 克隆仓库
git clone <repo-url>
cd marble-music

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
# → 打开 http://localhost:5173
```

**依赖清单**（`package.json` 核心）：

```json
{
  "dependencies": {
    "matter-js": "^0.19.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0",
    "@playwright/test": "^1.40.0",
    "@types/matter-js": "^0.19.0"
  }
}
```

---

## 3. 开发模式

```bash
# 开发服务器（热重载）
pnpm dev

# 类型检查
pnpm tsc --noEmit

# 构建生产版本
pnpm build

# 预览生产构建
pnpm preview
```

**开发模式调试面板**（`?debug=1` 参数启用）：
- 右上角显示 FPS 计数器
- 活跃 voice 数量
- 每秒碰撞触发次数
- 预测计算耗时（ms）
- 模式切换日志

---

## 4. 单元测试（Vitest）

```bash
# 运行所有单元测试
pnpm test

# 监听模式（开发中使用）
pnpm test:watch

# 生成覆盖率报告
pnpm test:coverage
```

### 核心测试文件位置

```
tests/unit/
├── ModeController.test.ts      # MC-01~MC-06
├── PhysicsWorld.test.ts        # PW-01~PW-04
├── PredictionEngine.test.ts    # PE-01~PE-06
├── AudioEngine.test.ts         # AE-01~AE-07
└── LocalSaveRepository.test.ts # LS-01~LS-06
```

### 关键单元测试验收标准

```
MC-01: ModeController 初始状态为 edit
MC-02: edit → play 切换正确
MC-03: play → edit 切换正确
MC-06: play 态 canEdit() === false

PE-04: 预测输出包含正确 noteName 和 volume 的 PredictedNote
PE-06: 预测轨迹与 PredictedNote.timeMs 时间一致

AE-07: 无 durationMs 参数时 voice 正常工作（仅依赖 volume 衰减）

LS-06: 恢复的 MusicBlock 不含 durationMs 字段且不影响加载
```

---

## 5. 端到端测试（Playwright）

```bash
# 安装浏览器（首次）
pnpm dlx playwright install chromium

# 运行所有 E2E 测试
pnpm test:e2e

# 可视化模式（调试用）
pnpm test:e2e --headed

# 单个测试文件
pnpm test:e2e tests/e2e/core-loop.spec.ts
```

### E2E 测试文件位置

```
tests/e2e/
├── core-loop.spec.ts       # E2E-01~03：核心闭环
├── timeline-staff.spec.ts  # E2E-04~08：Timeline 五线谱预测
├── mode-isolation.spec.ts  # E2E-09~16：模式隔离 + 播放/停止
├── camera-follow.spec.ts   # E2E-17~19：多球跟随
└── persistence.spec.ts     # E2E-20~25：存档恢复 + 音量衰减
```

---

## 6. 冒烟测试清单（手动验收）

在 Chrome 中打开 `http://localhost:5173` 执行以下验证：

### 核心闭环（5 分钟）

- [ ] **放置小球**：按 `1` 选择小球，点击画布，出现圆形小球
- [ ] **放置音乐方块**：按 `3` 选择音乐方块，点击画布，出现带音名标注的方块
- [ ] **预测线出现**：放置后画布上出现虚线轨迹，底部出现五线谱音符
- [ ] **播放发声**：按空格键，进入播放模式，小球下落，碰撞音乐方块时发出钢琴音
- [ ] **返回编辑**：再按空格或 Esc，回到编辑模式，五线谱重新出现

### 模式隔离（2 分钟）

- [ ] **播放态无法放置**：播放中点击画布，无新实体出现
- [ ] **播放态面板隐藏**：右侧面板和底部 Timeline 均不可见
- [ ] **无暂停状态**：只有"编辑"和"播放中"两种模式提示，无暂停按钮

### 音乐参数（2 分钟）

- [ ] **选中音乐方块**：点击音乐方块，右侧显示音名和音量参数
- [ ] **修改音名**：将 C4 改为 G4，五线谱音符纵向位置变化
- [ ] **修改音量**：音量滑块调低，播放后声音更短促

### 存档恢复（2 分钟）

- [ ] **自动保存**：放置积木后约 1 秒，右上角短暂显示"已保存"
- [ ] **刷新恢复**：刷新页面，所有积木位置和音名完整恢复
- [ ] **损坏处理**：在 DevTools 中将 localStorage 数据改为非法 JSON，刷新后显示空场景和提示，不崩溃

### 边界场景（3 分钟）

- [ ] **空场景播放**：空场景按空格，进入播放模式，无崩溃，无发声
- [ ] **高频碰撞**：搭建使小球来回弹跳的结构，发声正常，无爆音
- [ ] **多球独立谱线**：放置 2 个小球，Timeline 显示 2 条独立谱线，小球标识不同

---

## 7. 发布门禁检查

发布前必须通过全部以下条件（来自 GDD 08）：

```bash
# 1. 所有单元测试通过
pnpm test

# 2. 所有 E2E 测试通过
pnpm test:e2e

# 3. 类型检查无错误
pnpm tsc --noEmit

# 4. 生产构建成功
pnpm build
```

**手动验收**：

| 门禁条件 | 验证方式 |
|---------|---------|
| 所有 E2E 用例通过 | Playwright 测试报告（0 failed） |
| 所有单元测试通过 | Vitest 测试报告（0 failed） |
| 无未解决 P0 缺陷 | 手动确认 |
| 核心约束 C1~C5 全部验证通过 | 验收矩阵逐项确认 |
| 标准场景下无明显性能问题 | 手动验证（20 积木 + 5 小球，60fps 目标） |
| Timeline 五线谱预测与播放结果一致 | 手动对比验证 |

---

## 8. 常见问题

### Q: 没有声音？

1. 检查浏览器是否阻止了自动播放音频
2. 点击页面任意位置（触发 UserGesture）后再按空格播放
3. 检查右上角是否显示"点击以启用音频"提示

### Q: 预测线不出现？

1. 确认当前在编辑模式（左上角 HUD 显示"按 Space 播放"）
2. 场景中必须有至少 1 个小球
3. 等待约 150ms 去抖后预测线自动出现

### Q: 刷新后数据丢失？

1. 检查浏览器 DevTools → Application → Storage → localStorage，确认 `marble-music-save` 存在
2. 检查右上角是否出现"保存失败"提示
3. 检查浏览器是否禁用了 localStorage（隐身模式可能受限）

### Q: 音符频率不正确？

音名到频率使用十二平均律公式：`freq = 440 * 2^((midiNote - 69) / 12)`  
C4 = 261.63 Hz，A4 = 440 Hz，C5 = 523.25 Hz
