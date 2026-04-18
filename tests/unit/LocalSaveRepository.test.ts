/**
 * 单元测试：LocalSaveRepository + SceneSerializer（US5 持久化）
 *
 * 覆盖：LS-01~LS-06
 * 环境：jsdom（提供 localStorage mock）
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { LocalSaveRepository } from "../../src/persistence/LocalSaveRepository.js";
import { SceneSerializer, createEmptyScene } from "../../src/persistence/SceneSerializer.js";
import type { Scene, MusicBlock } from "../../src/scene/types.js";

// ──────────────────────────────────────────────────
// localStorage Mock（jsdom 的 localStorage 缺少 clear 等方法）
// ──────────────────────────────────────────────────

function createLocalStorageMock(): Storage & { _store: Map<string, string> } {
  const store = new Map<string, string>();

  const mock = {
    _store: store,
    getItem(key: string): string | null {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    get length(): number {
      return store.size;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    }
  } satisfies Storage & { _store: Map<string, string> };

  return mock;
}

// ──────────────────────────────────────────────────
// 辅助：构建合法测试场景
// ──────────────────────────────────────────────────

function makeTestScene(): Scene {
  return {
    id: "test-scene-id",
    mode: "edit",
    gravity: { x: 0, y: 9.8 },
    selectedBallId: null,
    entities: [
      {
        id: "ball-1",
        kind: "ball",
        x: 100,
        y: 200,
        vx: 0,
        vy: 0,
        radius: 16
      },
      {
        id: "mb-1",
        kind: "music-block",
        x: 300,
        y: 400,
        width: 60,
        height: 20,
        noteName: "C4",
        volume: 0.5,
        timbre: "piano"
      } satisfies MusicBlock
    ]
  };
}

// ──────────────────────────────────────────────────
// 测试套件
// ──────────────────────────────────────────────────

describe("LocalSaveRepository", () => {
  let repo: LocalSaveRepository;
  let mockStorage: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    mockStorage = createLocalStorageMock();
    vi.stubGlobal("localStorage", mockStorage);
    vi.useFakeTimers();
    repo = new LocalSaveRepository();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────
  // LS-01：保存后恢复数据一致
  // ──────────────────────────────────────────

  it("LS-01: forceSave 后 load 恢复数据一致", () => {
    const scene = makeTestScene();
    repo.forceSave(scene);

    const restored = repo.load();
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(scene.id);
    expect(restored!.entities).toHaveLength(2);

    const restoredMb = restored!.entities.find(e => e.kind === "music-block") as MusicBlock;
    expect(restoredMb.noteName).toBe("C4");
    expect(restoredMb.volume).toBe(0.5);
    expect(restored!.mode).toBe("edit");
  });

  // ──────────────────────────────────────────
  // LS-02：节流窗口内多次保存合并为 1 次写入
  // ──────────────────────────────────────────

  it("LS-02: 节流窗口内多次 save() 合并为 1 次 localStorage 写入", () => {
    const setItemSpy = vi.spyOn(mockStorage, "setItem");
    const scene = makeTestScene();

    // 连续多次调用 save()
    repo.save(scene);
    repo.save(scene);
    repo.save(scene);

    // 节流窗口内：尚未写入
    expect(setItemSpy).not.toHaveBeenCalled();

    // 快进 1000ms（节流窗口）
    vi.advanceTimersByTime(1001);

    // 只有 1 次写入
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────
  // LS-03：forceSave 立即写入，不受节流约束
  // ──────────────────────────────────────────

  it("LS-03: forceSave 立即同步写入，清除已有节流计时器", () => {
    const setItemSpy = vi.spyOn(mockStorage, "setItem");
    const scene = makeTestScene();

    // 先发起节流保存（计时器已启动）
    repo.save(scene);
    expect(setItemSpy).not.toHaveBeenCalled();

    // forceSave 立即写入
    repo.forceSave(scene);
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    // 计时器已被清除，快进后不会再触发额外写入
    vi.advanceTimersByTime(1001);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────
  // LS-04：localStorage 不可用时抛出可捕获错误不崩溃
  // ──────────────────────────────────────────

  it("LS-04: localStorage.setItem 抛出时触发 failed 状态，不崩溃", () => {
    vi.spyOn(mockStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const statusEvents: string[] = [];
    repo.onStatusChange(s => statusEvents.push(s));

    const scene = makeTestScene();

    // forceSave 不应抛出
    expect(() => repo.forceSave(scene)).not.toThrow();
    expect(statusEvents).toContain("failed");
  });

  it("LS-04b: 节流 save 写入失败时触发 failed 状态，不崩溃", () => {
    vi.spyOn(mockStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const statusEvents: string[] = [];
    repo.onStatusChange(s => statusEvents.push(s));

    const scene = makeTestScene();
    repo.save(scene);

    expect(() => vi.advanceTimersByTime(1001)).not.toThrow();
    expect(statusEvents).toContain("failed");
  });

  // ──────────────────────────────────────────
  // LS-05：损坏 JSON 恢复时返回 null + loadError 标记
  // ──────────────────────────────────────────

  it("LS-05: 损坏 JSON 时 load 返回 null，loadError 为 corrupted", () => {
    mockStorage.setItem("marble-music-save", "NOT VALID JSON {{{");

    const result = repo.load();
    expect(result).toBeNull();
    expect(repo.getLoadError()).toBe("corrupted");
  });

  it("LS-05b: version 过高时 loadError 为 version-too-high", () => {
    const highVersionData = JSON.stringify({
      version: 999,
      savedAt: new Date().toISOString(),
      scene: {}
    });
    mockStorage.setItem("marble-music-save", highVersionData);

    const result = repo.load();
    expect(result).toBeNull();
    expect(repo.getLoadError()).toBe("version-too-high");
  });

  // ──────────────────────────────────────────
  // LS-06：恢复的 MusicBlock 不含 durationMs 字段且不影响加载
  // ──────────────────────────────────────────

  it("LS-06: JSON 中 MusicBlock 含 durationMs 字段时忽略该字段，正常加载", () => {
    // 手动构造包含 durationMs 的 JSON（模拟旧存档）
    const serializer = new SceneSerializer();
    const scene = makeTestScene();
    const rawJson = serializer.serialize(scene);

    // 注入 durationMs 字段到 MusicBlock
    const parsed = JSON.parse(rawJson) as {
      scene: { entities: Array<Record<string, unknown>> };
    };
    const mbRaw = parsed.scene.entities.find(e => e.kind === "music-block");
    if (mbRaw) {
      mbRaw["durationMs"] = 500;
    }
    // 临时放开 additionalProperties 验证（我们测试运行时行为，不是 JSON Schema）
    const modifiedJson = JSON.stringify(parsed);

    // 使用 serializer 直接测试（绕开 additionalProperties:false 的 schema 限制）
    const restored = serializer.deserialize(modifiedJson);
    // 注：schema 的 additionalProperties:false 是静态验证，运行时 deserialize 只做字段提取
    // 如果 deserialize 返回 null，说明实现错误地拒绝了含 durationMs 的存档
    expect(restored).not.toBeNull();

    const restoredMb = restored!.entities.find(e => e.kind === "music-block") as MusicBlock;
    expect(restoredMb).toBeDefined();
    expect("durationMs" in restoredMb).toBe(false);
    expect(restoredMb.noteName).toBe("C4");
    expect(restoredMb.volume).toBe(0.5);
  });

  // ──────────────────────────────────────────
  // 额外：onStatusChange 订阅机制验证
  // ──────────────────────────────────────────

  it("forceSave 成功后触发 saved 状态", () => {
    const statusEvents: string[] = [];
    repo.onStatusChange(s => statusEvents.push(s));

    repo.forceSave(makeTestScene());

    expect(statusEvents).toEqual(["saved"]);
  });

  it("load 无存档时返回 null，无 loadError", () => {
    const result = repo.load();
    expect(result).toBeNull();
    expect(repo.getLoadError()).toBeNull();
  });
});

// ──────────────────────────────────────────────────
// SceneSerializer 独立测试
// ──────────────────────────────────────────────────

describe("SceneSerializer", () => {
  let serializer: SceneSerializer;

  beforeEach(() => {
    serializer = new SceneSerializer();
  });

  it("serialize 强制将 mode 设为 edit", () => {
    const scene = makeTestScene();
    scene.mode = "play";

    const json = serializer.serialize(scene);
    const parsed = JSON.parse(json) as { scene: { mode: string } };
    expect(parsed.scene.mode).toBe("edit");
  });

  it("serialize 强制将 Ball vx/vy 设为 0", () => {
    const scene = makeTestScene();
    const ball = scene.entities.find(e => e.kind === "ball")!;
    if (ball.kind === "ball") {
      ball.vx = 5.5;
      ball.vy = -3.2;
    }

    const json = serializer.serialize(scene);
    const parsed = JSON.parse(json) as {
      scene: { entities: Array<{ kind: string; vx?: number; vy?: number }> };
    };
    const parsedBall = parsed.scene.entities.find(e => e.kind === "ball");
    expect(parsedBall?.vx).toBe(0);
    expect(parsedBall?.vy).toBe(0);
  });

  it("createEmptyScene 返回合法空场景", () => {
    const scene = createEmptyScene();
    expect(scene.id).toBeTruthy();
    expect(scene.mode).toBe("edit");
    expect(scene.entities).toHaveLength(0);
    expect(scene.selectedBallId).toBeNull();
  });

  it("volume 超范围时夹紧到 [0,1]", () => {
    const scene = makeTestScene();
    const mb = scene.entities.find(e => e.kind === "music-block") as MusicBlock;
    mb.volume = 1.5;

    const json = serializer.serialize(scene);
    // 先序列化（写入 1.5），再篡改 JSON 注入超范围值
    const parsed = JSON.parse(json) as {
      scene: { entities: Array<Record<string, unknown>> };
    };
    const rawMb = parsed.scene.entities.find(e => e.kind === "music-block");
    if (rawMb) rawMb["volume"] = 2.5;

    const restored = serializer.deserialize(JSON.stringify(parsed));
    expect(restored).not.toBeNull();
    const restoredMb = restored!.entities.find(e => e.kind === "music-block") as MusicBlock;
    expect(restoredMb.volume).toBe(1);
  });
});
