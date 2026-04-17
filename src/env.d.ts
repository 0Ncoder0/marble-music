/// <reference types="vite/client" />

declare global {
  interface Window {
    /** E2E 专用调试状态，由 GameApp 主循环每帧写入 */
    __debugState?: {
      mode: string;
      audioEngine: {
        activeVoiceCount: number;
        totalCollisionEventsReceived: number;
      };
      entityCount: number;
      entities: Array<{
        id: string;
        kind: string;
        x: number;
        y: number;
        noteName?: string;
        volume?: number;
      }>;
      physicsRunning: boolean;
      /** 预测系统状态（Phase 4 新增） */
      prediction: {
        noteCount: number;
        trajBallCount: number;
        computedAt: number;
        lastComputeMs: number;
        /** E2E-05/06/07 用：预测音符列表（最小字段，供坐标和 ballId 断言） */
        notes: Array<{
          timeMs: number;
          noteName: string;
          ballId: string;
          musicBlockId: string;
        }>;
      } | null;
      /** 相机状态（US4 新增，供 E2E-17~E2E-19 断言） */
      camera: {
        cx: number;
        cy: number;
        zoom: number;
        followBallId: string | null;
      };
      /** 持久化状态（US5 新增，供 E2E-20~E2E-23 断言） */
      persistence: {
        saveStatus: string;
        loadError: string | null;
      };
      /**
       * 性能指标（T069/T076 新增）。
       * 始终写入（E2E 需要），可见调试面板仅在 ?debug=1 时显示。
       */
      fps: number;
      /** 上次预测计算耗时（ms），与 prediction.lastComputeMs 同源 */
      predictionMs: number;
      /** 当前预测结果中的轨迹球数（与 prediction.trajBallCount 同源） */
      timelineTrackCount: number;
      /** 最近 1 秒内碰撞触发次数（调试用） */
      collisionsPerSec: number;
    };
  }
}

export {};
