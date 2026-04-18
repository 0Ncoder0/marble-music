import type { AppMode } from '../scene/types.js';

export class ModeController {
  private _mode: AppMode = 'edit';
  private _listeners: Array<(mode: AppMode) => void> = [];

  get mode(): AppMode {
    return this._mode;
  }

  startPlay(): void {
    if (this._mode === 'play') return;
    this._mode = 'play';
    this._notify();
  }

  stopPlay(): void {
    if (this._mode === 'edit') return;
    this._mode = 'edit';
    this._notify();
  }

  canEdit(): boolean {
    return this._mode === 'edit';
  }

  onModeChange(cb: (mode: AppMode) => void): void {
    this._listeners.push(cb);
  }

  private _notify(): void {
    for (const cb of this._listeners) {
      cb(this._mode);
    }
  }
}
