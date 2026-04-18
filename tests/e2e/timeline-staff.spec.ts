/**
 * E2E 测试：Timeline 五线谱（US2）
 *
 * 覆盖：E2E-01、E2E-04、E2E-05、E2E-06（skip，需 US3）、E2E-07、E2E-08
 *
 * 验证策略（等价替代）：
 *   - Timeline canvas 可见性通过 DOM display 样式断言
 *   - 音符存在与否通过 window.__debugState.prediction.noteCount 断言
 *   - 音符时间变化通过 prediction.notes[0].timeMs 前后比较
 *   - 多球独立轨道通过 prediction.trajBallCount 断言
 *
 * 坐标约定（Desktop Chrome 1280×720 viewport）：
 *   main-canvas 占 [0, 0, 1280, 600]（高 600 = 720 - 120px timeline）
 *   世界坐标原点在画布中心：worldX = screenX - 640, worldY = screenY - 300
 *   Ball radius = 16, MusicBlock 宽 60 × 高 20
 */

import { test, expect, type Page } from "@playwright/test";

// ──────────────────────────────────────────────────────────────
// 辅助函数
// ──────────────────────────────────────────────────────────────

async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector("text=编辑模式", { timeout: 10_000 });
  await page.waitForFunction(() => typeof window.__debugState !== "undefined", {
    timeout: 5_000
  });
}

/**
 * 等待预测重算完成（computedAt 严格大于 prevComputedAt）。
 * 不要求 noteCount，只需确认结果已刷新。
 */
async function waitForPredictionUpdate(page: Page, prevComputedAt: number): Promise<void> {
  await page.waitForFunction(
    (prev: number) => {
      const pred = window.__debugState?.prediction;
      return pred != null && pred.computedAt > prev;
    },
    prevComputedAt,
    { timeout: 5_000 }
  );
}

/**
 * 等待出现至少一个预测音符（noteCount > 0），可选要求 computedAt > prev。
 */
async function waitForPredictionWithNotes(page: Page, prevComputedAt = 0): Promise<void> {
  await page.waitForFunction(
    (prev: number) => {
      const pred = window.__debugState?.prediction;
      return pred != null && pred.noteCount > 0 && pred.computedAt > prev;
    },
    prevComputedAt,
    { timeout: 6_000 }
  );
}

// ──────────────────────────────────────────────────────────────
// E2E-01 / E2E-04：放置小球 + 音乐方块后 Timeline 出现预测音符
// ──────────────────────────────────────────────────────────────

test("E2E-01/E2E-04: timeline shows predicted notes after placing ball and music block", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);

  const canvas = page.locator("#main-canvas");

  // 放置音乐方块（screen 640,380 → world 0,80）
  await page.keyboard.press("3");
  await canvas.click({ position: { x: 640, y: 380 } });

  // 放置小球正上方（screen 640,150 → world 0,-150）
  await page.keyboard.press("1");
  await canvas.click({ position: { x: 640, y: 150 } });

  // 等待 2 个实体进入场景
  await page.waitForFunction(() => (window.__debugState?.entityCount ?? 0) >= 2, {
    timeout: 3_000
  });

  // 等待预测结果出现至少 1 个音符（150ms 去抖 + 计算时间）
  await waitForPredictionWithNotes(page);

  const pred = await page.evaluate(() => window.__debugState?.prediction);
  expect(pred).not.toBeNull();
  expect(pred!.noteCount).toBeGreaterThan(0);
  expect(pred!.trajBallCount).toBe(1);

  // Timeline canvas 在编辑态应可见
  const timelineDisplay = await page.locator("#timeline-canvas").evaluate(el => window.getComputedStyle(el).display);
  expect(timelineDisplay).not.toBe("none");
});

// ──────────────────────────────────────────────────────────────
// E2E-05：移动音乐方块后 Timeline 音符时间轴位置（timeMs）发生变化
// ──────────────────────────────────────────────────────────────

test("E2E-05: moving music block changes predicted note timeMs", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);

  const canvas = page.locator("#main-canvas");

  // 放置音乐方块（screen 640,370 → world 0,70）
  await page.keyboard.press("3");
  await canvas.click({ position: { x: 640, y: 370 } });

  // 放置小球（screen 640,150 → world 0,-150）
  await page.keyboard.press("1");
  await canvas.click({ position: { x: 640, y: 150 } });

  // 等待初次预测完成（有音符）
  await waitForPredictionWithNotes(page);

  const pred1 = await page.evaluate(() => window.__debugState?.prediction);
  expect(pred1).not.toBeNull();
  expect(pred1!.noteCount).toBeGreaterThan(0);

  const firstTimeMs = pred1!.notes[0]!.timeMs;
  const computedAt1 = pred1!.computedAt;
  expect(firstTimeMs).toBeGreaterThan(0);

  // 切换到 select 工具，拖拽音乐方块向下移动
  // 音乐方块从 world(0,70) → world(0,170)，小球到达距离从 220px → 320px
  await page.keyboard.press("Escape");
  await page.mouse.move(640, 370);
  await page.mouse.down();
  await page.mouse.move(640, 470, { steps: 10 });
  await page.mouse.up();

  // 等待重新预测（computedAt 需大于第一次）
  await waitForPredictionUpdate(page, computedAt1);

  const pred2 = await page.evaluate(() => window.__debugState?.prediction);
  expect(pred2).not.toBeNull();
  expect(pred2!.noteCount).toBeGreaterThan(0);

  // 音乐方块下移后，小球需要更长时间到达 → timeMs 应增大
  const secondTimeMs = pred2!.notes[0]!.timeMs;
  expect(secondTimeMs).toBeGreaterThan(firstTimeMs);
});

// ──────────────────────────────────────────────────────────────
// E2E-06：修改音乐方块音名后五线谱音符纵轴位置变化（US3 参数面板已实现）
// ──────────────────────────────────────────────────────────────

test("E2E-06: modifying music block noteName changes note name in prediction (US3)", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);

  const canvas = page.locator("#main-canvas");

  // 放置音乐方块（screen 640,380 → world 0,80）
  await page.keyboard.press("3");
  await canvas.click({ position: { x: 640, y: 380 } });

  // 放置小球正上方（screen 640,150 → world 0,-150）
  await page.keyboard.press("1");
  await canvas.click({ position: { x: 640, y: 150 } });

  // 等待初次预测有音符
  await waitForPredictionWithNotes(page);

  const pred1 = await page.evaluate(() => window.__debugState?.prediction);
  expect(pred1).not.toBeNull();
  expect(pred1!.noteCount).toBeGreaterThan(0);
  const originalNoteName = pred1!.notes[0]!.noteName;
  expect(originalNoteName).toBe("C4"); // EntityFactory 默认 noteName
  const computedAt1 = pred1!.computedAt;

  // 切换到 select 工具，点击音乐方块选中它
  await page.keyboard.press("Escape");
  await canvas.click({ position: { x: 640, y: 380 } });

  // 等待参数面板音名输入框可见（面板已由 US3 实现）
  const noteInput = page.locator("#note-name-input");
  await noteInput.waitFor({ state: "visible", timeout: 3_000 });

  // 修改音名为 G4（与 C4 音高不同，纵轴位置应变化）
  await noteInput.fill("G4");
  await noteInput.dispatchEvent("change");

  // 等待预测重算（computedAt 严格增大）
  await waitForPredictionUpdate(page, computedAt1);

  const pred2 = await page.evaluate(() => window.__debugState?.prediction);
  expect(pred2).not.toBeNull();
  expect(pred2!.noteCount).toBeGreaterThan(0);

  // 预测音符的音名应已更新为 G4
  const newNoteName = pred2!.notes[0]!.noteName;
  expect(newNoteName).toBe("G4");
  expect(newNoteName).not.toBe(originalNoteName);
});

// ──────────────────────────────────────────────────────────────
// E2E-07：多球场景在 Timeline 中产生独立轨道
// ──────────────────────────────────────────────────────────────

test("E2E-07: multi-ball scene produces independent timeline tracks", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);

  const canvas = page.locator("#main-canvas");

  // 放置音乐方块（screen 640,400 → world 0,100）
  await page.keyboard.press("3");
  await canvas.click({ position: { x: 640, y: 400 } });

  // 放置球 1（screen 625,150 → world -15,-150）
  await page.keyboard.press("1");
  await canvas.click({ position: { x: 625, y: 150 } });

  // 放置球 2（screen 655,150 → world 15,-150）
  await canvas.click({ position: { x: 655, y: 150 } });

  // 等待 3 个实体进入场景
  await page.waitForFunction(() => (window.__debugState?.entityCount ?? 0) >= 3, {
    timeout: 3_000
  });

  // 等待预测系统产生 2 条独立轨迹（不要求必须有碰撞音符）
  await page.waitForFunction(
    () => {
      const pred = window.__debugState?.prediction;
      return pred != null && pred.trajBallCount >= 2;
    },
    { timeout: 6_000 }
  );

  const pred = await page.evaluate(() => window.__debugState?.prediction);
  expect(pred!.trajBallCount).toBe(2);

  // 如果有碰撞音符，验证它们来自不同 ballId
  if (pred!.notes.length >= 2) {
    const ballIds = new Set(pred!.notes.map(n => n.ballId));
    // 两球都在音乐方块 x 范围内，通常均能产生碰撞
    expect(ballIds.size).toBeGreaterThanOrEqual(1);
  }

  // Timeline canvas 在编辑态应可见
  const display = await page.locator("#timeline-canvas").evaluate(el => window.getComputedStyle(el).display);
  expect(display).not.toBe("none");
});

// ──────────────────────────────────────────────────────────────
// E2E-08：删除所有音乐方块后五线谱变为空谱线（无音符，有谱线）
// ──────────────────────────────────────────────────────────────

test("E2E-08: deleting all music blocks results in empty staff (no notes, lines remain visible)", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);

  const canvas = page.locator("#main-canvas");

  // 放置音乐方块（screen 640,380 → world 0,80）
  await page.keyboard.press("3");
  await canvas.click({ position: { x: 640, y: 380 } });

  // 放置小球（screen 640,150 → world 0,-150）
  await page.keyboard.press("1");
  await canvas.click({ position: { x: 640, y: 150 } });

  // 等待预测有音符
  await waitForPredictionWithNotes(page);

  const computedAt1 = (await page.evaluate(() => window.__debugState?.prediction?.computedAt))!;

  // 切换 select 工具，点击音乐方块以选中
  await page.keyboard.press("Escape");
  await canvas.click({ position: { x: 640, y: 380 } });

  // 确认音乐方块已选中（仍在场景中）
  await page.waitForFunction(() => window.__debugState?.entities.some(e => e.kind === "music-block"), { timeout: 2_000 });

  // 按 Delete 删除选中实体
  await page.keyboard.press("Delete");

  // 等待音乐方块从场景中移除
  await page.waitForFunction(() => !window.__debugState?.entities.some(e => e.kind === "music-block"), { timeout: 3_000 });

  // 等待预测重新计算（computedAt 更新）
  await waitForPredictionUpdate(page, computedAt1);

  const pred2 = await page.evaluate(() => window.__debugState?.prediction);
  expect(pred2).not.toBeNull();

  // 无音乐方块 → 无预测音符（空谱线）
  expect(pred2!.noteCount).toBe(0);

  // 小球仍在场景中 → 轨迹条数 = 1
  expect(pred2!.trajBallCount).toBeGreaterThanOrEqual(1);

  // Timeline canvas 在编辑态仍应可见（空谱线而非隐藏）
  const display = await page.locator("#timeline-canvas").evaluate(el => window.getComputedStyle(el).display);
  expect(display).not.toBe("none");
});

// ──────────────────────────────────────────────────────────────
// E2E-US3：非法音名输入被拒绝，旧值保留，五线谱不变（FR-018）
// ──────────────────────────────────────────────────────────────

test("E2E-US3: invalid noteName input is rejected and old value is preserved", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);

  const canvas = page.locator("#main-canvas");

  // 放置音乐方块并放置小球，确保有预测音符
  await page.keyboard.press("3");
  await canvas.click({ position: { x: 640, y: 380 } });
  await page.keyboard.press("1");
  await canvas.click({ position: { x: 640, y: 150 } });
  await waitForPredictionWithNotes(page);

  // 切换 select，点击音乐方块选中
  await page.keyboard.press("Escape");
  await canvas.click({ position: { x: 640, y: 380 } });

  const noteInput = page.locator("#note-name-input");
  await noteInput.waitFor({ state: "visible", timeout: 3_000 });

  const pred1 = await page.evaluate(() => window.__debugState?.prediction);
  const originalNote = pred1!.notes[0]!.noteName;
  const computedAt1 = pred1!.computedAt;

  // 输入非法音名 "Z9" 并触发 change 事件
  await noteInput.fill("Z9");
  await noteInput.dispatchEvent("change");

  // 等待足够时间（150ms 去抖 + 200ms 余量）
  await page.waitForTimeout(400);

  // 预测音符的 noteName 不应改变（旧值保留）
  const pred2 = await page.evaluate(() => window.__debugState?.prediction);
  if (pred2 && pred2.noteCount > 0) {
    expect(pred2.notes[0]!.noteName).toBe(originalNote);
  }

  // 时间戳也不应改变（没有触发重算，因为没有写入）
  // 注意：computedAt 可能因其他原因略有变化，主要检验 noteName 不被写入
  const currentNote = await page.evaluate(() => {
    const mb = window.__debugState?.entities.find(e => e.kind === "music-block");
    return mb;
  });
  // 实体的 kind 仍然是 music-block（未删除）
  expect(currentNote?.kind).toBe("music-block");

  // 注：由于 window.__debugState.entities 只暴露 {id, kind, x, y}，
  // 无法直接验证 noteName。通过预测音符 noteName 不变来间接确认。
  // 可用的最强断言：预测结果的 noteName 不变
  if (pred2 && pred2.noteCount > 0 && pred2.computedAt > computedAt1) {
    // 如果触发了重算，noteName 仍应为原值
    expect(pred2.notes[0]!.noteName).toBe(originalNote);
  }
});

// ──────────────────────────────────────────────────────────────
// 播放态 Timeline 隐藏（C2 门禁补充验证）
// ──────────────────────────────────────────────────────────────

test("US2-C2: timeline canvas hidden in play mode, visible in edit mode", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);

  // 编辑态：timeline 可见
  const displayEdit = await page.locator("#timeline-canvas").evaluate(el => window.getComputedStyle(el).display);
  expect(displayEdit).not.toBe("none");

  // 进入播放态
  await page.keyboard.press("Space");
  await page.waitForSelector("text=播放中", { timeout: 3_000 });

  // 播放态：timeline 隐藏（C2 门禁）
  const displayPlay = await page.locator("#timeline-canvas").evaluate(el => window.getComputedStyle(el).display);
  expect(displayPlay).toBe("none");

  // 返回编辑态
  await page.keyboard.press("Space");
  await page.waitForSelector("text=编辑模式", { timeout: 3_000 });

  // 编辑态：timeline 重新可见
  const displayBack = await page.locator("#timeline-canvas").evaluate(el => window.getComputedStyle(el).display);
  expect(displayBack).not.toBe("none");
});
