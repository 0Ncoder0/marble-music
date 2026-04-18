import { MAX_TOTAL_VOICES, MAX_VOICES_PER_FRAME } from "../constants.js";
import type { CollisionEvent } from "../scene/types.js";
import type { PianoSynth } from "./PianoSynth.js";

export class AudioEngine {
  private readonly _audioCtx: AudioContext;
  private readonly _synth: PianoSynth;
  private _activeVoiceCount = 0;
  private _listening = false;
  /** 累计接收的碰撞事件数（监听中、不管 AudioContext 状态），供 E2E 测试间接验证物理碰撞 */
  private _totalCollisionEventsReceived = 0;

  constructor(audioCtx: AudioContext, synth: PianoSynth) {
    this._audioCtx = audioCtx;
    this._synth = synth;
  }

  get activeVoiceCount(): number {
    return this._activeVoiceCount;
  }

  get totalCollisionEventsReceived(): number {
    return this._totalCollisionEventsReceived;
  }

  /**
   * 统一的 AudioContext 恢复入口。
   * 所有需要 resume 的场景（listen、首次交互、onstatechange）均通过此方法调用，
   * 禁止在其他地方直接裸调 audioCtx.resume()。
   */
  tryResume(): void {
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch((err: unknown) => {
        console.warn("[AudioEngine] tryResume failed:", err);
      });
    }
  }

  /** 进入播放态，开始监听碰撞触发。 */
  listen(): void {
    this._listening = true;
    this.tryResume();
  }

  /** 退出播放态，停止接受新触发；已有 voice 自然衰减。 */
  stopListening(): void {
    this._listening = false;
  }

  /**
   * 处理单帧收集的碰撞事件，创建对应 voice。
   * 帧上限：MAX_VOICES_PER_FRAME；总上限：MAX_TOTAL_VOICES。
   */
  processCollisions(events: CollisionEvent[]): void {
    if (!this._listening) return;

    // 始终计数（不受 AudioContext 状态影响），供 E2E 验证物理碰撞
    this._totalCollisionEventsReceived += events.length;

    if (this._audioCtx.state === "suspended") {
      console.warn("[AudioEngine] AudioContext suspended, skipping voice creation");
      return;
    }

    if (this._activeVoiceCount >= MAX_TOTAL_VOICES) {
      console.warn(`[AudioEngine] Total voice limit (${MAX_TOTAL_VOICES}) reached, skipping all events`);
      return;
    }

    let frameTriggers = 0;

    for (const event of events) {
      if (frameTriggers >= MAX_VOICES_PER_FRAME) {
        console.warn(`[AudioEngine] Frame voice limit (${MAX_VOICES_PER_FRAME}) reached, skipping event`);
        break;
      }

      if (!this._isValidNoteName(event.noteName)) {
        console.warn(`[AudioEngine] Invalid note name "${event.noteName}", skipping`);
        continue;
      }

      try {
        this._activeVoiceCount++;
        this._synth.createVoice(event.noteName, event.volume, this._audioCtx, () => {
          this._activeVoiceCount--;
        });
        frameTriggers++;
      } catch (err: unknown) {
        this._activeVoiceCount--;
        console.error("[AudioEngine] Failed to create voice:", err);
      }
    }
  }

  private _isValidNoteName(noteName: string): boolean {
    return /^[A-G][#b]?\d+$/.test(noteName.trim());
  }
}
