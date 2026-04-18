import type { Entity, MusicBlock } from "../scene/types.js";
import type { ActiveTool } from "../app/InputController.js";

type NoteNameChangeFn = (value: string) => void;
type VolumeChangeFn = (value: number) => void;
type ToolChangeFn = (tool: ActiveTool) => void;

/**
 * 右侧面板渲染器（US3）。
 * 职责：
 * 1. 积木选择器区域（Ball / Block / MusicBlock 三按钮，当前 activeTool 高亮）
 * 2. 音乐方块参数面板（仅选中 MusicBlock 时显示）：音名输入 + 音量滑块
 * 3. show() / hide() 控制整个 panel-container
 */
export class PanelRenderer {
  private readonly _container: HTMLElement;

  // Tool selector
  private readonly _toolBallBtn: HTMLButtonElement;
  private readonly _toolBlockBtn: HTMLButtonElement;
  private readonly _toolMusicBlockBtn: HTMLButtonElement;

  // Param panel (music-block only)
  private readonly _paramPanel: HTMLDivElement;
  private readonly _noteNameInput: HTMLInputElement;
  private readonly _noteNameError: HTMLSpanElement;
  private readonly _volumeSlider: HTMLInputElement;
  private readonly _volumeDisplay: HTMLSpanElement;

  // State
  private _errorActive = false;
  private _lastEntityId: string | null = null;

  // Callbacks (registered by InputController)
  private _onNoteNameChangeCb: NoteNameChangeFn | null = null;
  private _onVolumeChangeCb: VolumeChangeFn | null = null;
  private _onToolChangeCb: ToolChangeFn | null = null;

  constructor(container: HTMLElement) {
    this._container = container;

    const wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex;flex-direction:column;height:100%;padding:12px;gap:12px;overflow-y:auto;";

    // ── 积木选择器 ────────────────────────────────────────────────
    const toolSection = document.createElement("div");

    const toolTitle = document.createElement("div");
    toolTitle.textContent = "积木选择器";
    toolTitle.style.cssText = "font-size:11px;color:#888;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;font-family:sans-serif;";
    toolSection.appendChild(toolTitle);

    this._toolBallBtn = this._createToolButton("● 小球 [1]", "ball");
    this._toolBlockBtn = this._createToolButton("■ 方块 [2]", "block");
    this._toolMusicBlockBtn = this._createToolButton("♪ 音乐方块 [3]", "music-block");

    toolSection.appendChild(this._toolBallBtn);
    toolSection.appendChild(this._toolBlockBtn);
    toolSection.appendChild(this._toolMusicBlockBtn);
    wrapper.appendChild(toolSection);

    // ── 音乐方块参数面板 ──────────────────────────────────────────
    this._paramPanel = document.createElement("div");
    this._paramPanel.style.cssText = "display:none;border-top:1px solid #2a2a4e;padding-top:12px;";

    const paramTitle = document.createElement("div");
    paramTitle.textContent = "♪ 音乐方块参数";
    paramTitle.style.cssText = "font-size:12px;font-weight:bold;color:#c9b3e8;margin-bottom:12px;font-family:sans-serif;";
    this._paramPanel.appendChild(paramTitle);

    // 音名
    const noteRow = document.createElement("div");
    noteRow.style.marginBottom = "12px";

    const noteLabel = document.createElement("label");
    noteLabel.textContent = "音名";
    noteLabel.style.cssText = "display:block;font-size:12px;color:#aaa;margin-bottom:4px;font-family:sans-serif;";

    this._noteNameInput = document.createElement("input");
    this._noteNameInput.type = "text";
    this._noteNameInput.id = "note-name-input";
    this._noteNameInput.placeholder = "如 C4、G#3";
    this._noteNameInput.style.cssText = [
      "width:100%",
      "padding:6px 8px",
      "background:#1a1a3e",
      "border:1px solid #3a3a6e",
      "border-radius:4px",
      "color:#e0e0e0",
      "font-size:14px",
      "outline:none",
      "font-family:sans-serif",
      "box-sizing:border-box"
    ].join(";");

    this._noteNameError = document.createElement("span");
    this._noteNameError.style.cssText = "display:none;font-size:11px;color:#e07070;margin-top:4px;font-family:sans-serif;";

    noteRow.appendChild(noteLabel);
    noteRow.appendChild(this._noteNameInput);
    noteRow.appendChild(this._noteNameError);
    this._paramPanel.appendChild(noteRow);

    // 音量
    const volRow = document.createElement("div");
    volRow.style.marginBottom = "8px";

    const volLabel = document.createElement("label");
    volLabel.style.cssText = "display:flex;justify-content:space-between;font-size:12px;color:#aaa;margin-bottom:4px;font-family:sans-serif;";
    const volLabelText = document.createElement("span");
    volLabelText.textContent = "音量";
    this._volumeDisplay = document.createElement("span");
    this._volumeDisplay.style.color = "#c9b3e8";
    this._volumeDisplay.id = "volume-display";
    volLabel.appendChild(volLabelText);
    volLabel.appendChild(this._volumeDisplay);

    this._volumeSlider = document.createElement("input");
    this._volumeSlider.type = "range";
    this._volumeSlider.id = "volume-slider";
    this._volumeSlider.min = "0";
    this._volumeSlider.max = "1";
    this._volumeSlider.step = "0.01";
    this._volumeSlider.style.cssText = "width:100%;accent-color:#7b5ea7;cursor:pointer;";

    volRow.appendChild(volLabel);
    volRow.appendChild(this._volumeSlider);
    this._paramPanel.appendChild(volRow);

    // 说明文字（FR-019）
    const hint = document.createElement("div");
    hint.textContent = "音量越高，声音越绵长";
    hint.style.cssText = "font-size:11px;color:#666;margin-top:4px;font-style:italic;font-family:sans-serif;";
    this._paramPanel.appendChild(hint);

    wrapper.appendChild(this._paramPanel);
    container.appendChild(wrapper);

    // DOM 事件
    this._noteNameInput.addEventListener("change", () => {
      this._onNoteNameChangeCb?.(this._noteNameInput.value.trim());
    });
    this._noteNameInput.addEventListener("input", () => {
      // 用户重新输入时清除错误状态
      this._clearNoteNameErrorUI();
      this._errorActive = false;
    });
    this._volumeSlider.addEventListener("input", () => {
      const v = parseFloat(this._volumeSlider.value);
      this._volumeDisplay.textContent = v.toFixed(2);
      this._onVolumeChangeCb?.(v);
    });
  }

  // ── 回调注册（由 InputController 调用）────────────────────────

  setOnNoteNameChange(cb: NoteNameChangeFn): void {
    this._onNoteNameChangeCb = cb;
  }

  setOnVolumeChange(cb: VolumeChangeFn): void {
    this._onVolumeChangeCb = cb;
  }

  setOnToolChange(cb: ToolChangeFn): void {
    this._onToolChangeCb = cb;
  }

  // ── 可见性控制（由 GameApp 调用）─────────────────────────────

  show(): void {
    this._container.style.display = "";
  }

  hide(): void {
    this._container.style.display = "none";
  }

  // ── 错误显示（由 InputController 验证逻辑调用）───────────────

  showNoteNameError(msg: string): void {
    this._errorActive = true;
    this._noteNameInput.style.borderColor = "#e07070";
    this._noteNameError.textContent = msg;
    this._noteNameError.style.display = "block";
  }

  clearNoteNameError(): void {
    this._errorActive = false;
    this._clearNoteNameErrorUI();
  }

  // ── 帧更新（GameApp 每帧调用）────────────────────────────────

  /**
   * 每帧调用，同步 activeTool 高亮与选中实体参数显示。
   * 若已选中 MusicBlock，则显示参数面板并同步当前值（但不覆盖正在编辑中或错误状态中的 noteName）。
   */
  update(selectedEntity: Entity | null, activeTool: ActiveTool): void {
    this._updateToolButtonStyle(this._toolBallBtn, activeTool === "ball");
    this._updateToolButtonStyle(this._toolBlockBtn, activeTool === "block");
    this._updateToolButtonStyle(this._toolMusicBlockBtn, activeTool === "music-block");

    if (selectedEntity?.kind === "music-block") {
      this._paramPanel.style.display = "block";
      const mb = selectedEntity as MusicBlock;

      if (mb.id !== this._lastEntityId) {
        // 切换到不同实体：重置所有状态
        this._lastEntityId = mb.id;
        this._errorActive = false;
        this._clearNoteNameErrorUI();
        this._noteNameInput.value = mb.noteName;
      } else if (!this._errorActive && document.activeElement !== this._noteNameInput) {
        // 无错误且未聚焦：跟随实体值同步
        this._noteNameInput.value = mb.noteName;
      }

      // 音量：未聚焦时同步（拖动中实时发送，不会冲突）
      if (document.activeElement !== this._volumeSlider) {
        this._volumeSlider.value = String(mb.volume);
        this._volumeDisplay.textContent = mb.volume.toFixed(2);
      }
    } else {
      this._paramPanel.style.display = "none";
      this._lastEntityId = null;
      this._errorActive = false;
      this._clearNoteNameErrorUI();
    }
  }

  // ── 私有辅助 ──────────────────────────────────────────────────

  private _clearNoteNameErrorUI(): void {
    this._noteNameInput.style.borderColor = "#3a3a6e";
    this._noteNameError.style.display = "none";
    this._noteNameError.textContent = "";
  }

  private _createToolButton(label: string, tool: ActiveTool): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.dataset.tool = tool;
    btn.style.cssText = [
      "display:block",
      "width:100%",
      "padding:8px 12px",
      "margin-bottom:4px",
      "text-align:left",
      "background:transparent",
      "border:1px solid #3a3a6e",
      "border-radius:4px",
      "color:#ccc",
      "font-size:13px",
      "cursor:pointer",
      "font-family:sans-serif"
    ].join(";");

    btn.addEventListener("click", () => {
      this._onToolChangeCb?.(tool);
    });
    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.active !== "true") {
        btn.style.background = "rgba(123,94,167,0.2)";
      }
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.active !== "true") {
        btn.style.background = "transparent";
      }
    });
    return btn;
  }

  private _updateToolButtonStyle(btn: HTMLButtonElement, isActive: boolean): void {
    btn.dataset.active = isActive ? "true" : "false";
    if (isActive) {
      btn.style.background = "rgba(123,94,167,0.5)";
      btn.style.borderColor = "#7b5ea7";
      btn.style.color = "#fff";
    } else {
      btn.style.background = "transparent";
      btn.style.borderColor = "#3a3a6e";
      btn.style.color = "#ccc";
    }
  }
}
