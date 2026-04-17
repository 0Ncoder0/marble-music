import type { AppMode, SaveStatus } from '../scene/types.js';

export class HudRenderer {
  private readonly _modeEl: HTMLDivElement;
  private readonly _saveEl: HTMLDivElement;
  private readonly _audioBannerEl: HTMLDivElement;

  private _saveHideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this._modeEl = this._createElement({
      position: 'absolute',
      top: '12px',
      left: '12px',
      padding: '6px 12px',
      background: 'rgba(0,0,0,0.55)',
      color: '#fff',
      borderRadius: '6px',
      fontFamily: 'sans-serif',
      fontSize: '14px',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '10',
    });

    this._saveEl = this._createElement({
      position: 'absolute',
      top: '12px',
      right: '12px',
      padding: '4px 10px',
      background: 'rgba(0,0,0,0.45)',
      color: '#ccc',
      borderRadius: '6px',
      fontFamily: 'sans-serif',
      fontSize: '12px',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '10',
      transition: 'opacity 0.3s',
    });

    this._audioBannerEl = this._createElement({
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      padding: '12px 24px',
      background: 'rgba(0,0,0,0.75)',
      color: '#fff',
      borderRadius: '8px',
      fontFamily: 'sans-serif',
      fontSize: '16px',
      cursor: 'pointer',
      zIndex: '20',
      display: 'none',
    });
    this._audioBannerEl.textContent = '🔇 点击页面以启用音频';
    this._audioBannerEl.addEventListener('click', () => {
      this._audioBannerEl.style.display = 'none';
    });

    container.appendChild(this._modeEl);
    container.appendChild(this._saveEl);
    container.appendChild(this._audioBannerEl);
  }

  update(mode: AppMode, saveStatus?: SaveStatus, audioBlocked?: boolean): void {
    if (mode === 'edit') {
      this._modeEl.textContent = '📝 编辑模式 — 按 Space 播放';
    } else {
      this._modeEl.textContent = '▶ 播放中 — 按 Space 或 Esc 停止';
    }

    if (saveStatus !== undefined) {
      this._updateSaveStatus(saveStatus);
    }

    if (audioBlocked !== undefined) {
      this._audioBannerEl.style.display = audioBlocked ? 'block' : 'none';
    }
  }

  /** 显示加载错误提示（3 秒后消退）。 */
  showLoadError(error: string): void {
    const el = this._createElement({
      position: 'absolute',
      top: '60px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '10px 20px',
      background: 'rgba(180,40,40,0.9)',
      color: '#fff',
      borderRadius: '6px',
      fontFamily: 'sans-serif',
      fontSize: '14px',
      pointerEvents: 'none',
      zIndex: '15',
    });
    el.textContent = error;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  private _updateSaveStatus(status: SaveStatus): void {
    if (this._saveHideTimer !== null) {
      clearTimeout(this._saveHideTimer);
      this._saveHideTimer = null;
    }

    switch (status) {
      case 'idle':
        this._saveEl.textContent = '';
        break;
      case 'saving':
        this._saveEl.textContent = '保存中...';
        this._saveEl.style.color = '#aaa';
        break;
      case 'saved':
        this._saveEl.textContent = '✅ 已保存';
        this._saveEl.style.color = '#7ec87e';
        this._saveHideTimer = setTimeout(() => {
          this._saveEl.textContent = '';
          this._saveHideTimer = null;
        }, 2000);
        break;
      case 'failed':
        this._saveEl.textContent = '⚠️ 保存失败 — 请检查浏览器存储权限';
        this._saveEl.style.color = '#e07070';
        break;
    }
  }

  private _createElement(styles: Partial<CSSStyleDeclaration>): HTMLDivElement {
    const el = document.createElement('div');
    Object.assign(el.style, styles);
    return el;
  }
}
