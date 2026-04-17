/**
 * E2E 测试：模式隔离（US1）
 *
 * 覆盖：E2E-09、E2E-10、E2E-11、E2E-12、E2E-16
 *
 * 核心约束：SC-004（播放态编辑操作阻断率 100%）
 */

import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────
// 辅助
// ─────────────────────────────────────────────

async function waitForApp(page: import('@playwright/test').Page): Promise<void> {
  // 等待 HUD 出现（GameApp.create() 完成）
  await page.waitForSelector('text=编辑模式', { timeout: 10_000 });
  // 等待 RAF 主循环写入 __debugState（确保 entityCount 等字段可读）
  await page.waitForFunction(() => typeof window.__debugState !== 'undefined', {
    timeout: 5_000,
  });
}

async function enterPlayMode(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Space');
  await page.waitForSelector('text=播放中', { timeout: 5_000 });
}

async function exitPlayMode(page: import('@playwright/test').Page): Promise<void> {
  await page.keyboard.press('Space');
  await page.waitForSelector('text=编辑模式', { timeout: 5_000 });
}

// ─────────────────────────────────────────────
// E2E-09：播放态 click 画布 → 无新实体出现
// ─────────────────────────────────────────────

test('E2E-09: clicking canvas in play mode does not create new entities', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  const canvas = page.locator('#main-canvas');

  // 编辑态放置一个小球
  await page.keyboard.press('1');
  await canvas.click({ position: { x: 400, y: 300 } });

  // 等待 RAF 写入 __debugState（确保小球已出现在 entities 中）
  await page.waitForFunction(
    () => (window.__debugState?.entityCount ?? 0) >= 1,
    { timeout: 3_000 },
  );

  const countBefore = await page.evaluate(() => window.__debugState?.entityCount ?? 0);
  expect(countBefore).toBe(1);

  // 进入播放态
  await enterPlayMode(page);

  // 播放态点击画布（选择音乐方块工具后点击）
  await page.keyboard.press('3');
  await canvas.click({ position: { x: 600, y: 300 } });
  await canvas.click({ position: { x: 700, y: 200 } });

  // 实体数量应不变（SC-004）
  const countAfter = await page.evaluate(() => window.__debugState?.entityCount ?? 0);
  expect(countAfter).toBe(countBefore);

  await exitPlayMode(page);
});

// ─────────────────────────────────────────────
// E2E-10：播放态尝试拖拽实体 → 实体不移动
// ─────────────────────────────────────────────

test('E2E-10: dragging entity in play mode does not move it', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  const canvas = page.locator('#main-canvas');

  // 编辑态放置一个方块（静态，播放时不受物理影响，便于位置检测）
  await page.keyboard.press('2');
  await canvas.click({ position: { x: 500, y: 300 } });

  // 等待 rAF 更新 debugState
  await page.waitForFunction(
    () => window.__debugState?.entities.some((x) => x.kind === 'block'),
    { timeout: 3_000 },
  );

  // 记录初始位置
  const initialPos = await page.evaluate(() => {
    const e = window.__debugState?.entities.find((x) => x.kind === 'block');
    return e ? { x: e.x, y: e.y } : null;
  });
  expect(initialPos).not.toBeNull();

  // 进入播放态
  await enterPlayMode(page);

  // 尝试拖拽（mousedown → mousemove → mouseup）
  await page.mouse.move(500, 300);
  await page.mouse.down();
  await page.mouse.move(650, 400, { steps: 10 });
  await page.mouse.up();

  // 方块位置应不变（isLocked() 阻断了拖拽）
  const afterPos = await page.evaluate(() => {
    const e = window.__debugState?.entities.find((x) => x.kind === 'block');
    return e ? { x: e.x, y: e.y } : null;
  });
  expect(afterPos?.x).toBeCloseTo(initialPos!.x, 0);
  expect(afterPos?.y).toBeCloseTo(initialPos!.y, 0);

  await exitPlayMode(page);
});

// ─────────────────────────────────────────────
// E2E-11：播放态按 Delete → 实体不被删除
// ─────────────────────────────────────────────

test('E2E-11: Delete key in play mode does not remove entities', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  const canvas = page.locator('#main-canvas');

  // 放置方块并选中（点击即选中）
  await page.keyboard.press('2');
  await canvas.click({ position: { x: 500, y: 300 } });

  // 等待 rAF 更新 debugState
  await page.waitForFunction(
    () => (window.__debugState?.entityCount ?? 0) >= 1,
    { timeout: 3_000 },
  );
  const countBefore = await page.evaluate(() => window.__debugState?.entityCount ?? 0);
  expect(countBefore).toBe(1);

  // 进入播放态
  await enterPlayMode(page);

  // 按 Delete（播放态应被 isLocked() 阻断）
  await page.keyboard.press('Delete');

  const countAfter = await page.evaluate(() => window.__debugState?.entityCount ?? 0);
  expect(countAfter).toBe(countBefore);

  await exitPlayMode(page);
});

// ─────────────────────────────────────────────
// E2E-12：播放态 → 右侧面板和 Timeline 画布 DOM 隐藏
// ─────────────────────────────────────────────

test('E2E-12: panel-container and timeline-canvas are hidden in play mode', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  // 编辑态：两个容器应可见（display 非 none）
  const panelDisplayEdit = await page
    .locator('#panel-container')
    .evaluate((el) => window.getComputedStyle(el).display);
  expect(panelDisplayEdit).not.toBe('none');

  const timelineDisplayEdit = await page
    .locator('#timeline-canvas')
    .evaluate((el) => window.getComputedStyle(el).display);
  expect(timelineDisplayEdit).not.toBe('none');

  // 进入播放态
  await enterPlayMode(page);

  // 播放态：两个容器应被隐藏
  const panelDisplayPlay = await page
    .locator('#panel-container')
    .evaluate((el) => window.getComputedStyle(el).display);
  expect(panelDisplayPlay).toBe('none');

  const timelineDisplayPlay = await page
    .locator('#timeline-canvas')
    .evaluate((el) => window.getComputedStyle(el).display);
  expect(timelineDisplayPlay).toBe('none');

  // 返回编辑态：两个容器应重新可见
  await exitPlayMode(page);

  const panelDisplayBack = await page
    .locator('#panel-container')
    .evaluate((el) => window.getComputedStyle(el).display);
  expect(panelDisplayBack).not.toBe('none');

  const timelineDisplayBack = await page
    .locator('#timeline-canvas')
    .evaluate((el) => window.getComputedStyle(el).display);
  expect(timelineDisplayBack).not.toBe('none');
});

// ─────────────────────────────────────────────
// E2E-12 参数面板部分：选中音乐方块后面板可见，播放态自动隐藏
// ─────────────────────────────────────────────

test('E2E-12-panel: music block param panel visible in edit, hidden in play mode', async ({
  page,
}) => {
  await page.goto('/');
  await waitForApp(page);

  const canvas = page.locator('#main-canvas');

  // 编辑态放置音乐方块并选中
  await page.keyboard.press('3');
  await canvas.click({ position: { x: 640, y: 380 } });

  // 等待 1 个实体进入场景
  await page.waitForFunction(
    () => window.__debugState?.entities.some((e) => e.kind === 'music-block'),
    { timeout: 3_000 },
  );

  // 此时已选中（放置即选中），等待参数面板出现
  const noteInput = page.locator('#note-name-input');
  await noteInput.waitFor({ state: 'visible', timeout: 3_000 });

  // 音名输入框和音量滑块均应可见
  const volSlider = page.locator('#volume-slider');
  await volSlider.waitFor({ state: 'visible', timeout: 1_000 });

  // 进入播放态
  await enterPlayMode(page);

  // 播放态：panel-container 隐藏（参数面板随之不可见）
  const panelContainerDisplay = await page
    .locator('#panel-container')
    .evaluate((el) => window.getComputedStyle(el).display);
  expect(panelContainerDisplay).toBe('none');

  // 返回编辑态：panel-container 重新可见
  await exitPlayMode(page);

  const panelContainerBack = await page
    .locator('#panel-container')
    .evaluate((el) => window.getComputedStyle(el).display);
  expect(panelContainerBack).not.toBe('none');
});

// ─────────────────────────────────────────────
// E2E-16：UI 中无"暂停"字样（C1 门禁：无第三态）最终完整断言
// ─────────────────────────────────────────────

test('E2E-16: no pause button or pause text exists in UI', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  // ── 编辑态断言 ──────────────────────────────
  // 无暂停相关中文文字
  const pauseInEdit = await page.locator('text=暂停').count();
  expect(pauseInEdit).toBe(0);

  // 无任何暂停语义的按钮（aria-label 或 title 含 pause）
  const pauseBtnEdit = await page.locator('button[aria-label*="暂停"], button[title*="暂停"]').count();
  expect(pauseBtnEdit).toBe(0);

  // __debugState.mode 只能是 "edit" 或 "play"，没有第三态
  const modeInEdit = await page.evaluate(() => window.__debugState?.mode);
  expect(modeInEdit).toBe('edit');

  // ── 播放态断言 ──────────────────────────────
  await enterPlayMode(page);

  // 播放态：仍无暂停文字
  const pauseInPlay = await page.locator('text=暂停').count();
  expect(pauseInPlay).toBe(0);

  // 也不应有英文 "pause"（不区分大小写）
  const pauseEnCount = await page.evaluate(
    () => document.body.innerText.toLowerCase().includes('pause'),
  );
  expect(pauseEnCount).toBe(false);

  // 播放态 mode 为 "play"（不是第三态）
  const modeInPlay = await page.evaluate(() => window.__debugState?.mode);
  expect(modeInPlay).toBe('play');

  // HUD 显示"播放中"而非任何暂停相关文案
  await expect(page.locator('text=播放中')).toBeVisible();
  const pauseHudCount = await page.locator('text=暂停').count();
  expect(pauseHudCount).toBe(0);

  // ── 返回编辑态，确认无第三态残留 ──────────────
  await exitPlayMode(page);

  const modeAfterExit = await page.evaluate(() => window.__debugState?.mode);
  expect(modeAfterExit).toBe('edit');

  // 确认无暂停元素出现（完整流程后仍无第三态 UI）
  const pauseAfterExit = await page.locator('text=暂停').count();
  expect(pauseAfterExit).toBe(0);
});
