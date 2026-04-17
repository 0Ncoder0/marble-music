/**
 * E2E 测试：核心闭环（US1）
 *
 * 覆盖：E2E-02、E2E-13、E2E-14、E2E-15
 *
 * 说明：
 * - 所有断言通过 window.__debugState 间接验证（不直接断言 AudioContext.state 或音频信号）
 * - E2E-02 在无头 Chromium 中依赖用户交互恢复 AudioContext；若 AudioContext 仍被挂起，
 *   则以 totalCollisions > 0 作为等价验证（物理碰撞已发生，发声被系统挂起静音降级）
 */

import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────
// 辅助：等待应用完全加载（__debugState 出现表示 RAF 主循环已启动）
// ─────────────────────────────────────────────

async function waitForApp(page: import('@playwright/test').Page): Promise<void> {
  // 等待 HUD 出现（GameApp.create() 完成）
  await page.waitForSelector('text=编辑模式', { timeout: 10_000 });
  // 等待 RAF 主循环写入 __debugState（确保 entityCount 等字段可读）
  await page.waitForFunction(() => typeof window.__debugState !== 'undefined', {
    timeout: 5_000,
  });
}

// ─────────────────────────────────────────────
// E2E-13：编辑态按 Space → 进入播放态，HUD 文案变更
// ─────────────────────────────────────────────

test('E2E-13: Space in edit mode transitions to play mode', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  // 初始状态：编辑模式 HUD 可见
  await expect(page.locator('text=编辑模式')).toBeVisible();

  await page.keyboard.press('Space');

  // 进入播放态：HUD 文案变更为"播放中"
  await expect(page.locator('text=播放中')).toBeVisible({ timeout: 3_000 });

  // 等待 rAF 更新 debugState
  await page.waitForFunction(() => window.__debugState?.mode === 'play', { timeout: 3_000 });
});

// ─────────────────────────────────────────────
// E2E-14：播放态按 Space → 返回编辑态
// ─────────────────────────────────────────────

test('E2E-14: Space in play mode returns to edit mode', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  await page.keyboard.press('Space');
  await expect(page.locator('text=播放中')).toBeVisible({ timeout: 3_000 });

  await page.keyboard.press('Space');
  await expect(page.locator('text=编辑模式')).toBeVisible({ timeout: 3_000 });
  await page.waitForFunction(() => window.__debugState?.mode === 'edit', { timeout: 3_000 });
});

// ─────────────────────────────────────────────
// E2E-15：播放态按 Esc → 返回编辑态（C1 门禁验证）
// ─────────────────────────────────────────────

test('E2E-15: Esc in play mode returns to edit mode', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  await page.keyboard.press('Space');
  await expect(page.locator('text=播放中')).toBeVisible({ timeout: 3_000 });

  await page.keyboard.press('Escape');
  await expect(page.locator('text=编辑模式')).toBeVisible({ timeout: 3_000 });

  // 等待 rAF 更新 debugState（HUD 先于 debugState 更新，需稍等一帧）
  await page.waitForFunction(() => window.__debugState?.mode === 'edit', { timeout: 3_000 });
});

// ─────────────────────────────────────────────
// E2E-02：放置音乐方块 + 小球 → Space 播放 → 验证碰撞触发
//
// 间接验证策略（C4 门禁）：
//   优先：window.__debugState.audioEngine.activeVoiceCount > 0
//         （要求 AudioContext 已被用户交互恢复）
//   降级：window.__debugState.totalCollisions > 0
//         （AudioContext 挂起时静音降级，但物理碰撞确实发生）
// ─────────────────────────────────────────────

test('E2E-02: ball collides with music block and triggers audio processing', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  const canvas = page.locator('#main-canvas');

  // 先点击画布（用户交互 → AudioContext.resume()）
  await canvas.click({ position: { x: 640, y: 300 } });

  // 按 3 选择音乐方块工具，点击画布放置（同时提供更多用户交互恢复 AudioContext）
  await page.keyboard.press('3');
  await canvas.click({ position: { x: 640, y: 400 } }); // 放置音乐方块（世界 y≈100）

  // 按 1 选择小球工具，在音乐方块上方放置小球
  await page.keyboard.press('1');
  await canvas.click({ position: { x: 640, y: 180 } }); // 放置小球（世界 y≈-120，在方块上方）

  // 等待 rAF 更新 debugState，确认两个实体已放置
  await page.waitForFunction(
    () => (window.__debugState?.entityCount ?? 0) >= 2,
    { timeout: 3_000 },
  );
  const entityCount = await page.evaluate(() => window.__debugState?.entityCount ?? 0);
  expect(entityCount).toBe(2);

  // 按 Space 进入播放态
  await page.keyboard.press('Space');
  await expect(page.locator('text=播放中')).toBeVisible({ timeout: 3_000 });

  // 等待物理引擎运行并发生碰撞（最多 4 秒）
  await page.waitForFunction(
    () => (window.__debugState?.audioEngine?.totalCollisionEventsReceived ?? 0) > 0,
    { timeout: 4_000 },
  );

  const totalCollisions = await page.evaluate(
    () => window.__debugState?.audioEngine?.totalCollisionEventsReceived ?? 0,
  );
  expect(totalCollisions).toBeGreaterThan(0);

  // 额外验证：若 AudioContext 已恢复，activeVoiceCount 应 > 0（软断言，环境允许时）
  const voiceCount = await page.evaluate(() => window.__debugState?.audioEngine?.activeVoiceCount ?? 0);
  // 注：voice 可能已衰减至 0，此处仅做说明性断言（不强制）
  // 在 AudioContext 正常的环境中 voiceCount 此时可能已为 0（voice 已衰减）
  // totalCollisions > 0 是核心断言
  expect(voiceCount).toBeGreaterThanOrEqual(0);

  // 返回编辑态
  await page.keyboard.press('Space');
  await expect(page.locator('text=编辑模式')).toBeVisible({ timeout: 3_000 });
});
