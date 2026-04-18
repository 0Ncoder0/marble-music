import { describe, it, expect, beforeEach } from "vitest";
import { PredictionEngine } from "../../src/physics/PredictionEngine.js";
import { SceneManager } from "../../src/scene/SceneManager.js";
import { PHYSICS_CONFIG, PREDICTION_MAX_STEPS, TRAJECTORY_SAMPLE_INTERVAL } from "../../src/constants.js";
import type { Entity } from "../../src/scene/types.js";

const FIXED_DT_MS = PHYSICS_CONFIG.FIXED_DT_MS;

// ─── 场景辅助函数 ────────────────────────────────────────────────────────────

function makeBall(id: string, x: number, y: number): Entity {
  return { id, kind: "ball", x, y, vx: 0, vy: 0, radius: 16 };
}

function makeMusicBlock(id: string, x: number, y: number, noteName = "C4", volume = 0.5): Entity {
  return {
    id,
    kind: "music-block",
    x,
    y,
    width: 80,
    height: 20,
    noteName,
    volume,
    timbre: "piano"
  };
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe("PredictionEngine", () => {
  let sceneManager: SceneManager;
  let engine: PredictionEngine;

  beforeEach(() => {
    sceneManager = new SceneManager();
    engine = new PredictionEngine(sceneManager);
  });

  it("PE-01: 编辑态调用 invalidate() 后返回非空轨迹坐标序列", () => {
    // 场景：一个小球自由下落（无碰撞体）
    sceneManager.addEntity(makeBall("ball-1", 200, 50));

    engine.invalidate(); // 同步运行预测

    const result = engine.getLatestResult();
    expect(result).not.toBeNull();
    expect(result!.trajectories.size).toBe(1);
    const traj = result!.trajectories.get("ball-1");
    expect(traj).toBeDefined();
    expect(traj!.length).toBeGreaterThan(1); // 至少有初始点 + 若干采样点
  });

  it("PE-02: pause() 后 markDirty() 无效，getLatestResult() 保持为 null", async () => {
    sceneManager.addEntity(makeBall("ball-1", 200, 50));

    // 新引擎尚未计算，结果为 null
    expect(engine.getLatestResult()).toBeNull();

    engine.pause();
    engine.markDirty(); // 播放态，应无效

    // 等待超过 PREDICTION_DEBOUNCE_MS（150ms）
    await new Promise(r => setTimeout(r, 200));

    // 结果仍为 null（markDirty 在 pause 状态下被拦截）
    expect(engine.getLatestResult()).toBeNull();
  });

  it("PE-03: 场景变更后重新 invalidate()，轨迹与新场景一致", () => {
    // 初始场景：小球在左侧
    sceneManager.addEntity(makeBall("ball-1", 100, 50));
    engine.invalidate();
    const result1 = engine.getLatestResult()!;
    const traj1 = result1.trajectories.get("ball-1")!;
    const startX1 = traj1[0].x;

    // 移动小球到右侧
    sceneManager.updateEntity("ball-1", { x: 600, y: 50 });
    engine.invalidate();
    const result2 = engine.getLatestResult()!;
    const traj2 = result2.trajectories.get("ball-1")!;
    const startX2 = traj2[0].x;

    // 轨迹起始点应与新位置一致
    expect(startX1).toBeCloseTo(100, 0);
    expect(startX2).toBeCloseTo(600, 0);
    expect(startX2).not.toBeCloseTo(startX1, 0);
  });

  it("PE-04: Ball 碰撞 MusicBlock 时输出包含正确 noteName 和 volume 的 PredictedNote", () => {
    // 小球在音乐方块正上方，间距 ~10px，自由落体后碰撞
    sceneManager.addEntity(makeBall("ball-1", 400, 154)); // ball bottom = 154+16 = 170
    sceneManager.addEntity(makeMusicBlock("mb-1", 400, 200, "G4", 0.8)); // mb top = 200-10 = 190

    engine.invalidate();

    const result = engine.getLatestResult()!;
    expect(result.predictedNotes.length).toBeGreaterThan(0);

    const note = result.predictedNotes[0];
    expect(note.ballId).toBe("ball-1");
    expect(note.musicBlockId).toBe("mb-1");
    expect(note.noteName).toBe("G4");
    expect(note.volume).toBe(0.8);
  });

  it("PE-05: 多球场景中每球独立产生 PredictedNote，ballId 正确区分", () => {
    // 两个小球各自对准不同的音乐方块
    sceneManager.addEntity(makeBall("ball-A", 200, 154));
    sceneManager.addEntity(makeBall("ball-B", 600, 154));
    sceneManager.addEntity(makeMusicBlock("mb-A", 200, 200, "C4", 0.5));
    sceneManager.addEntity(makeMusicBlock("mb-B", 600, 200, "E4", 0.7));

    engine.invalidate();

    const result = engine.getLatestResult()!;
    expect(result.predictedNotes.length).toBeGreaterThanOrEqual(2);

    // 两个 ballId 都应出现在预测结果中
    const ballIds = new Set(result.predictedNotes.map(n => n.ballId));
    expect(ballIds.has("ball-A")).toBe(true);
    expect(ballIds.has("ball-B")).toBe(true);

    // 每个音符的 musicBlockId 应对应正确的音乐方块
    const noteA = result.predictedNotes.find(n => n.ballId === "ball-A");
    const noteB = result.predictedNotes.find(n => n.ballId === "ball-B");
    expect(noteA?.musicBlockId).toBe("mb-A");
    expect(noteB?.musicBlockId).toBe("mb-B");
  });

  it("PE-06: PredictedNote.timeMs 在有效模拟时间范围内，且轨迹数据与碰撞时间对应", () => {
    const maxTimeMs = PREDICTION_MAX_STEPS * FIXED_DT_MS;

    // 小球上方靠近音乐方块，确保在 5 秒预测窗口内碰撞
    sceneManager.addEntity(makeBall("ball-1", 300, 154));
    sceneManager.addEntity(makeMusicBlock("mb-1", 300, 200));

    engine.invalidate();

    const result = engine.getLatestResult()!;
    expect(result.predictedNotes.length).toBeGreaterThan(0);

    const note = result.predictedNotes[0];

    // timeMs 必须在 [0, maxTimeMs] 范围内
    expect(note.timeMs).toBeGreaterThanOrEqual(0);
    expect(note.timeMs).toBeLessThanOrEqual(maxTimeMs);

    // 轨迹存在且包含采样点
    const traj = result.trajectories.get("ball-1");
    expect(traj).toBeDefined();
    expect(traj!.length).toBeGreaterThan(0);

    // 碰撞时刻对应的采样点序号约为 note.timeMs / (FIXED_DT_MS * TRAJECTORY_SAMPLE_INTERVAL)
    // 样本点在时间上应覆盖碰撞时刻（允许一个采样间隔的误差）
    const sampleInterval = FIXED_DT_MS * TRAJECTORY_SAMPLE_INTERVAL;
    const approxSampleIdx = Math.floor(note.timeMs / sampleInterval);
    // 轨迹样本数必须 >= 该索引（说明预测至少运行到碰撞时刻）
    expect(traj!.length).toBeGreaterThan(approxSampleIdx);
  });
});
