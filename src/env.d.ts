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
      entities: Array<{ id: string; kind: string; x: number; y: number }>;
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
    };
  }
}

export {};
