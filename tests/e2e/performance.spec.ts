/**
 * E2E 性能门禁测试（T076）
 *
 * SC-002：在标准场景（20 个积木 + 5 个小球）下，编辑、预测、播放整体体验流畅，
 * 视觉上无明显卡顿感。
 *
 * 自动化门禁指标（通过 window.__debugState 读取）：
 * - fps >= 55（滑动均值，预留 ±5fps 容差）
 * - predictionMs <= 100（预测计算耗时，ms）
 * - timelineTrackCount >= 5（5 个小球 → 5 条 Timeline 谱线）
 *
 * 碰撞延迟（<20ms）无自动断言，保留 T074 手动验证。
 *
 * 前置条件：T069 已完成（window.__debugState.fps / predictionMs / timelineTrackCount 始终写入）
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
}

// ─────────────────────────────────────────────
// 辅助：搭建标准场景（20 个音乐方块 + 5 个小球）
//
// 布局：
//   - 5 列（X: 150, 280, 410, 540, 670）× 4 行（Y: 300, 380, 460, 530）= 20 个音乐方块
//   - 5 个小球（每列一个，Y: 100），位于音乐方块正上方，
//     确保预测模拟（5s 内）中小球能落下并碰撞到音乐方块
// ─────────────────────────────────────────────

async function buildStandardScene(page: Page): Promise<void> {
  const cols = [150, 280, 410, 540, 670];
  const blockRows = [300, 380, 460, 530];

  // 放置 20 个音乐方块（键 '3'）
  await page.keyboard.press('3');
  for (const row of blockRows) {
    for (const col of cols) {
      await page.mouse.click(col, row);
      // 短暂等待，避免连续点击被误判为双击或拖拽
      await page.waitForTimeout(30);
    }
  }

  // 放置 5 个小球（键 '1'），位于第一行音乐方块上方
  await page.keyboard.press('1');
  for (const col of cols) {
    await page.mouse.click(col, 100);
    await page.waitForTimeout(30);
  }
}

// ─────────────────────────────────────────────
// SC-002 性能门禁自动化验证
// ─────────────────────────────────────────────

test('SC-002: performance gates — fps >= 55, predictionMs <= 100, timelineTrackCount >= 5', async ({
  page,
}) => {
  // T076：使用 ?debug=1 模式（可见调试面板 + window.__debugState 写入）
  await page.goto('/?debug=1');
  await waitForApp(page);

  // 搭建标准场景（20 个音乐方块 + 5 个小球）
  await buildStandardScene(page);

  // 验证实体数量符合预期（25 = 20 blocks + 5 balls）
  await page.waitForFunction(
    () => (window.__debugState?.entityCount ?? 0) >= 25,
    { timeout: 10_000 },
  );

  // 等待预测引擎完成计算：5 个小球 → trajectories.size = 5
  await page.waitForFunction(
    () => {
      const pred = window.__debugState?.prediction;
      return pred !== null && pred !== undefined && pred.trajBallCount >= 5;
    },
    { timeout: 10_000 },
  );

  // 等待 3 秒让 FPS 滑动窗口（60 帧）稳定填充
  await page.waitForTimeout(3_000);

  // 读取性能指标
  const metrics = await page.evaluate(() => ({
    fps: window.__debugState?.fps ?? 0,
    predictionMs: window.__debugState?.predictionMs ?? 9999,
    timelineTrackCount: window.__debugState?.timelineTrackCount ?? 0,
    entityCount: window.__debugState?.entityCount ?? 0,
  }));

  // 场景完整性验证
  expect(metrics.entityCount).toBeGreaterThanOrEqual(25);

  // SC-002 门禁 1：FPS >= 55（目标 60fps，预留 ±5fps 容差）
  expect(metrics.fps).toBeGreaterThanOrEqual(55);

  // SC-002 门禁 2：预测计算耗时 <= 100ms
  expect(metrics.predictionMs).toBeLessThanOrEqual(100);

  // SC-002 门禁 3：5 个小球 → 5 条 Timeline 谱线
  expect(metrics.timelineTrackCount).toBeGreaterThanOrEqual(5);
});

// ─────────────────────────────────────────────
// 补充：播放模式下性能稳定性验证（T074 辅助）
// 进入播放态后，FPS 保持稳定（不因物理步进而大幅下降）
// ─────────────────────────────────────────────

test('SC-002b: fps remains stable in play mode with standard scene', async ({ page }) => {
  await page.goto('/?debug=1');
  await waitForApp(page);

  // 搭建标准场景
  await buildStandardScene(page);

  // 等待实体就绪
  await page.waitForFunction(
    () => (window.__debugState?.entityCount ?? 0) >= 25,
    { timeout: 10_000 },
  );

  // 进入播放态
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debugState?.mode === 'play', { timeout: 3_000 });

  // 等待 2 秒（物理模拟稳定运行）
  await page.waitForTimeout(2_000);

  // 读取播放态性能指标
  const playMetrics = await page.evaluate(() => ({
    fps: window.__debugState?.fps ?? 0,
    mode: window.__debugState?.mode,
  }));

  expect(playMetrics.mode).toBe('play');
  // 播放态 FPS 也应 >= 55
  expect(playMetrics.fps).toBeGreaterThanOrEqual(55);

  // 停止播放
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debugState?.mode === 'edit', { timeout: 3_000 });
});
