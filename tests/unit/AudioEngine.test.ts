import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine.js';
import { PianoSynth } from '../../src/audio/PianoSynth.js';
import { MAX_VOICES_PER_FRAME, MAX_TOTAL_VOICES } from '../../src/constants.js';
import type { CollisionEvent } from '../../src/scene/types.js';

// ──────────────────────────────────────────────────
// Web Audio API Mock（jsdom 环境无真实实现）
// ──────────────────────────────────────────────────

class MockGainParam {
  value = 0;
  setValueAtTime() {
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
}

class MockGainNode {
  gain = new MockGainParam();
  connect() {}
  disconnect() {}
}

class MockOscillatorNode {
  type: OscillatorType = 'sine';
  frequency = new MockGainParam();
  scheduledStopTime = 0;
  private readonly _endedCbs: Array<() => void> = [];

  connect() {}
  disconnect() {}
  start() {}
  stop(time: number) {
    this.scheduledStopTime = time;
  }
  addEventListener(event: string, cb: () => void) {
    if (event === 'ended') this._endedCbs.push(cb);
  }
  /** 测试辅助：手动触发 ended 事件 */
  fireEnded() {
    for (const cb of this._endedCbs) cb();
  }
}

class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  readonly oscillators: MockOscillatorNode[] = [];

  createOscillator(): OscillatorNode {
    const osc = new MockOscillatorNode();
    this.oscillators.push(osc);
    return osc as unknown as OscillatorNode;
  }

  createGain(): GainNode {
    return new MockGainNode() as unknown as GainNode;
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }
}

// ──────────────────────────────────────────────────
// 工厂函数
// ──────────────────────────────────────────────────

function makeCtx(): MockAudioContext {
  return new MockAudioContext();
}

function makeEvent(noteName = 'C4', volume = 0.5): CollisionEvent {
  return {
    ballId: 'ball-1',
    musicBlockId: 'mb-1',
    noteName,
    volume,
    timestamp: 0,
  };
}

// ──────────────────────────────────────────────────
// 测试
// ──────────────────────────────────────────────────

describe('AudioEngine', () => {
  let ctx: MockAudioContext;
  let synth: PianoSynth;
  let engine: AudioEngine;

  beforeEach(() => {
    ctx = makeCtx();
    synth = new PianoSynth();
    engine = new AudioEngine(ctx as unknown as AudioContext, synth);
    engine.listen();
  });

  it('AE-01: 触发一次碰撞事件创建独立 voice，activeVoiceCount+1', () => {
    expect(engine.activeVoiceCount).toBe(0);
    engine.processCollisions([makeEvent()]);
    expect(engine.activeVoiceCount).toBe(1);
  });

  it('AE-02: 连续两次触发产生两个独立 voice', () => {
    engine.processCollisions([makeEvent('C4')]);
    engine.processCollisions([makeEvent('G4')]);
    expect(engine.activeVoiceCount).toBe(2);
  });

  it('AE-03: voice 衰减结束（ended 事件）后 activeVoiceCount-1', () => {
    engine.processCollisions([makeEvent()]);
    expect(engine.activeVoiceCount).toBe(1);

    // 模拟 osc ended 事件触发 → onEnded 回调 → activeVoiceCount--
    ctx.oscillators[0].fireEnded();
    expect(engine.activeVoiceCount).toBe(0);
  });

  it('AE-04: 同帧超过 MAX_VOICES_PER_FRAME 上限时跳过，不崩溃', () => {
    const events = Array.from({ length: MAX_VOICES_PER_FRAME + 5 }, () => makeEvent());
    expect(() => engine.processCollisions(events)).not.toThrow();
    expect(engine.activeVoiceCount).toBeLessThanOrEqual(MAX_VOICES_PER_FRAME);
  });

  it('AE-05: 总活跃 voice 达到 MAX_TOTAL_VOICES 时跳过新触发，不崩溃', () => {
    // 分批创建 MAX_TOTAL_VOICES 个 voice（每批最多 MAX_VOICES_PER_FRAME）
    const batchCount = Math.ceil(MAX_TOTAL_VOICES / MAX_VOICES_PER_FRAME);
    for (let i = 0; i < batchCount; i++) {
      const batchSize = Math.min(
        MAX_VOICES_PER_FRAME,
        MAX_TOTAL_VOICES - engine.activeVoiceCount,
      );
      if (batchSize <= 0) break;
      engine.processCollisions(Array.from({ length: batchSize }, () => makeEvent()));
    }
    expect(engine.activeVoiceCount).toBe(MAX_TOTAL_VOICES);

    // 再次触发应该被跳过
    engine.processCollisions([makeEvent()]);
    expect(engine.activeVoiceCount).toBe(MAX_TOTAL_VOICES);
  });

  it('AE-06: 高音量 voice 停止时间晚于低音量（指数衰减时长更长）', () => {
    // 两次触发：低音量 → 高音量
    engine.processCollisions([makeEvent('C4', 0.1)]);
    engine.processCollisions([makeEvent('C4', 0.9)]);

    const oscLow = ctx.oscillators[0];
    const oscHigh = ctx.oscillators[1];

    // scheduledStopTime = currentTime(0) + attackDuration(0.008) + decayDuration
    // decayDuration = BASE_DECAY_S + volume * VOLUME_DECAY_SCALE_S
    // 高音量衰减更长 → 停止时间更晚
    expect(oscHigh.scheduledStopTime).toBeGreaterThan(oscLow.scheduledStopTime);
  });

  it('AE-07: 无 durationMs 参数时，voice 仅依赖 volume 衰减正常工作', () => {
    // CollisionEvent 不含 durationMs，voice 创建不应依赖它
    const event = makeEvent('A4', 0.7);
    expect('durationMs' in event).toBe(false);

    expect(() => engine.processCollisions([event])).not.toThrow();
    expect(engine.activeVoiceCount).toBe(1);

    // 确认衰减时间是基于 volume 的（非零且有意义的）
    const osc = ctx.oscillators[0];
    expect(osc.scheduledStopTime).toBeGreaterThan(0);
  });

  it('AE: stopListening 后 processCollisions 不再创建 voice', () => {
    engine.stopListening();
    engine.processCollisions([makeEvent()]);
    expect(engine.activeVoiceCount).toBe(0);
  });

  it('AE: AudioContext suspended 时跳过 voice 创建', () => {
    const suspendedCtx = makeCtx();
    suspendedCtx.state = 'suspended';
    const suspendedEngine = new AudioEngine(suspendedCtx as unknown as AudioContext, synth);
    suspendedEngine.listen();

    // tryResume 应该被调用（mocked）
    vi.spyOn(suspendedCtx, 'resume').mockResolvedValue(undefined);

    suspendedEngine.processCollisions([makeEvent()]);
    expect(suspendedEngine.activeVoiceCount).toBe(0);
  });

  it('AE: 非法 noteName 被跳过，不崩溃', () => {
    engine.processCollisions([{ ...makeEvent(), noteName: 'INVALID' }]);
    expect(engine.activeVoiceCount).toBe(0);
  });
});
