import { describe, it, expect, vi } from "vitest";
import { ModeController } from "../../src/app/ModeController.js";

describe("ModeController", () => {
  it("MC-01: 初始状态为 edit", () => {
    const mc = new ModeController();
    expect(mc.mode).toBe("edit");
  });

  it("MC-02: startPlay 切换到 play", () => {
    const mc = new ModeController();
    mc.startPlay();
    expect(mc.mode).toBe("play");
  });

  it("MC-03: stopPlay 切换到 edit", () => {
    const mc = new ModeController();
    mc.startPlay();
    mc.stopPlay();
    expect(mc.mode).toBe("edit");
  });

  it("MC-04: play 态再调 startPlay 无效", () => {
    const mc = new ModeController();
    const cb = vi.fn();
    mc.onModeChange(cb);
    mc.startPlay();
    cb.mockClear();
    mc.startPlay();
    expect(mc.mode).toBe("play");
    expect(cb).not.toHaveBeenCalled();
  });

  it("MC-05: edit 态 canEdit() === true", () => {
    const mc = new ModeController();
    expect(mc.canEdit()).toBe(true);
  });

  it("MC-06: play 态 canEdit() === false", () => {
    const mc = new ModeController();
    mc.startPlay();
    expect(mc.canEdit()).toBe(false);
  });
});
