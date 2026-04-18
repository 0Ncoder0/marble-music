/**
 * E2E 测试：多球场景与相机跟随（US4）
 *
 * 覆盖：E2E-17、E2E-18、E2E-19
 *
 * C5 门禁验证：
 * - 选中球 → Space 播放 → 相机跟随（followBallId 被设置，cx/cy 变化）
 * - 无选中球 → Space 播放 → 相机不自动移动（followBallId 为 null）
 * - 播放态滚轮 → zoom 参数变化
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// ─────────────────────────────────────────────
// 辅助：等待应用完全加载
// ─────────────────────────────────────────────

async function waitForApp(page: Page): Promise<void> {
  await page.waitForSelector('text=编辑模式', { timeout: 10_000 });
  await page.waitForFunction(() => typeof window.__debugState !== 'undefined', {
    timeout: 5_000,
  });
  // 额外等待 camera 字段可用（US4 T052 写入）
  await page.waitForFunction(() => window.__debugState?.camera !== undefined, {
    timeout: 5_000,
  });
}

// ─────────────────────────────────────────────
// E2E-17：选中球 → Space 播放 → 相机跟随球移动
// ─────────────────────────────────────────────

test('E2E-17: camera follows selected ball after entering play mode', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  // 选择小球工具，放置小球（偏离视口中心，使世界坐标非 (0,0)）
  await page.keyboard.press('1');
  await page.mouse.click(300, 200);

  // 小球放置后自动被选中（InputController 中 setSelectedId(entity.id)）
  // 验证场景中有球
  await page.waitForFunction(
    () => window.__debugState?.entities.some((e) => e.kind === 'ball'),
    { timeout: 3_000 },
  );

  // 读取按 Space 前的相机状态
  const initCamera = await page.evaluate(() => ({
    cx: window.__debugState?.camera?.cx ?? 0,
    cy: window.__debugState?.camera?.cy ?? 0,
    followBallId: window.__debugState?.camera?.followBallId ?? null,
  }));

  // 进入播放态
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debugState?.mode === 'play', { timeout: 3_000 });

  // C5 门禁：播放启动时 followBallId 应已设置（选中球 → 跟随）
  const followBallId = await page.evaluate(() => window.__debugState?.camera?.followBallId);
  expect(followBallId).toBeTruthy();

  // 等待相机因跟随而移动（FOLLOW_LERP=0.1，60帧后相机应明显靠近球位置）
  // 小球放在世界坐标约 (-340, -100)，相机初始在 (0, 0)；1秒后相机应显著偏移
  await page.waitForFunction(
    (initCx) => {
      const cam = window.__debugState?.camera;
      return cam !== undefined && Math.abs((cam.cx ?? 0) - initCx) > 10;
    },
    initCamera.cx,
    { timeout: 5_000 },
  );

  const updatedCamera = await page.evaluate(() => ({
    cx: window.__debugState?.camera?.cx ?? 0,
    cy: window.__debugState?.camera?.cy ?? 0,
  }));

  // 相机 cx 或 cy 至少有一个发生了显著变化
  const cxChanged = Math.abs(updatedCamera.cx - initCamera.cx) > 10;
  const cyChanged = Math.abs(updatedCamera.cy - initCamera.cy) > 10;
  expect(cxChanged || cyChanged).toBe(true);

  // 停止播放
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debugState?.mode === 'edit', { timeout: 3_000 });
});

// ─────────────────────────────────────────────
// E2E-18：无选中球 → Space 播放 → 相机不自动移动
// ─────────────────────────────────────────────

test('E2E-18: camera stays fixed when no ball is selected during play', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  // 放置小球（自动选中）
  await page.keyboard.press('1');
  await page.mouse.click(300, 200);

  await page.waitForFunction(
    () => window.__debugState?.entities.some((e) => e.kind === 'ball'),
    { timeout: 3_000 },
  );

  // 按 Escape 切换到 select 工具（不清除 selectedId）
  await page.keyboard.press('Escape');

  // 点击空白区域取消选中（activeTool='select'，点击空白只清空选中，不放置新实体）
  // 确保点击位置远离小球（小球在 worldX≈-340,worldY≈-100，画布右下角几乎不会命中）
  await page.mouse.click(800, 450);

  // 验证 selectedBallId 已清空（进入播放后 followBallId 应为 null）
  // 无法直接读取 selectedBallId，通过进入播放后检查 followBallId 验证

  // 进入播放态
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debugState?.mode === 'play', { timeout: 3_000 });

  // C5 门禁：无选中球时 followBallId 应为 null
  const followBallId = await page.evaluate(() => window.__debugState?.camera?.followBallId);
  expect(followBallId).toBeNull();

  // 读取初始相机位置
  const cam0 = await page.evaluate(() => ({
    cx: window.__debugState?.camera?.cx ?? 0,
    cy: window.__debugState?.camera?.cy ?? 0,
  }));

  // 等待 1 秒，相机不应自动移动
  await page.waitForTimeout(1_000);

  const cam1 = await page.evaluate(() => ({
    cx: window.__debugState?.camera?.cx ?? 0,
    cy: window.__debugState?.camera?.cy ?? 0,
  }));

  // 无跟随时，相机位置保持不变（允许 ±1 浮点误差）
  expect(Math.abs(cam1.cx - cam0.cx)).toBeLessThan(1);
  expect(Math.abs(cam1.cy - cam0.cy)).toBeLessThan(1);

  // 停止播放
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debugState?.mode === 'edit', { timeout: 3_000 });
});

// ─────────────────────────────────────────────
// E2E-19：播放中执行滚轮缩放 → zoom 参数变化
// ─────────────────────────────────────────────

test('E2E-19: scroll wheel changes zoom during play', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  // 进入播放态（空场景）
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debugState?.mode === 'play', { timeout: 3_000 });

  // 读取初始 zoom
  const initZoom = await page.evaluate(() => window.__debugState?.camera?.zoom ?? 1);
  expect(initZoom).toBeCloseTo(1.0, 5);

  // 将鼠标移到画布中央确保 wheel 事件落在画布上
  await page.mouse.move(640, 300);

  // 滚轮向上（负 deltaY）→ applyZoom(+delta) → zoom 增大
  await page.mouse.wheel(0, -300);

  // 等待 RAF 处理 wheel 事件
  await page.waitForFunction(
    (expectedZoom) => (window.__debugState?.camera?.zoom ?? 1) > expectedZoom,
    initZoom,
    { timeout: 3_000 },
  );

  const newZoom = await page.evaluate(() => window.__debugState?.camera?.zoom ?? 1);
  expect(newZoom).toBeGreaterThan(initZoom);

  // 停止播放
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debugState?.mode === 'edit', { timeout: 3_000 });
});

// ─────────────────────────────────────────────
// 额外验证：编辑态也支持滚轮缩放（FR-025 两种模式均可）
// ─────────────────────────────────────────────

test('E2E-19b: scroll wheel changes zoom in edit mode too', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);

  // 停留在编辑态
  const initZoom = await page.evaluate(() => window.__debugState?.camera?.zoom ?? 1);

  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, -200);

  await page.waitForFunction(
    (expectedZoom) => (window.__debugState?.camera?.zoom ?? 1) > expectedZoom,
    initZoom,
    { timeout: 3_000 },
  );

  const newZoom = await page.evaluate(() => window.__debugState?.camera?.zoom ?? 1);
  expect(newZoom).toBeGreaterThan(initZoom);
});
