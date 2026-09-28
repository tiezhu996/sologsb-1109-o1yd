import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { useHerbStore } from './herbStore';
import { KG_EPSILON, remainingKgOfHerb, roundKg } from '../utils/herb-usage';
import type { FireLevel } from '../types/processing-method';
import type { ProcessBatch, ProcessDegree } from '../types/process-batch';

export interface BatchInput {
  batchNo: string;
  herbId: string;
  methodId: string;
  feedKg: number;
  auxUsedKg: number;
  fireLevel: FireLevel;
  startedAt: string;
  endedAt: string;
  yieldRate: number;
  degree: ProcessDegree;
  operator: string;
  remark?: string;
}

interface BatchState {
  batches: ProcessBatch[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  createBatch: (input: BatchInput, lock?: boolean) => Promise<ProcessBatch>;
  updateBatch: (id: string, patch: Partial<BatchInput>, force?: boolean) => Promise<boolean>;
  /** 撤销未锁定工序（锁定记录需先由质检员放行）；删除后余量回补 */
  removeBatch: (id: string) => Promise<boolean>;
  /** 提交得率与程度判定后锁定该批 */
  lockBatch: (id: string) => Promise<void>;
  /** 质检员放行/改判：仅质检员可解锁 */
  unlockAsQc: (id: string, qcBy: string) => Promise<void>;
  degreeCount: () => Record<ProcessDegree, number>;
  pendingBatches: () => ProcessBatch[];
  batchesOfHerb: (herbId: string) => ProcessBatch[];
}

export const useBatchStore = create<BatchState>()((set, get) => ({
  batches: [],
  hydrated: false,

  hydrate: async () => {
    const batches = await db.batches.orderBy('startedAt').reverse().toArray();
    set({ batches, hydrated: true });
  },

  createBatch: async (input, lock = false) => {
    const feedKg = Number(input.feedKg) || 0;
    // 核销校验：投料量不得超过药材批次余量（锁定工序同样占用）
    const remaining = remainingKgOfHerb(
      useHerbStore.getState().herbs.find((h) => h.id === input.herbId)?.feedKg ?? 0,
      get().batches,
      input.herbId,
    );
    if (feedKg > remaining + KG_EPSILON) {
      throw new Error(`投料量超出该药材批次余量，最多可投 ${roundKg(remaining)}kg`);
    }
    const batch: ProcessBatch = {
      id: uid('batch'),
      batchNo: input.batchNo.trim(),
      herbId: input.herbId,
      methodId: input.methodId,
      feedKg,
      auxUsedKg: Number(input.auxUsedKg) || 0,
      fireLevel: input.fireLevel,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      yieldRate: Number(input.yieldRate) || 0,
      degree: input.degree,
      operator: input.operator.trim(),
      locked: lock,
      lockedAt: lock ? new Date().toISOString() : undefined,
      remark: input.remark?.trim() || undefined,
    };
    await db.batches.put(batch);
    set({ batches: [batch, ...get().batches] });
    return batch;
  },

  updateBatch: async (id, patch, force = false) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return false;
    }
    if (current.locked && !force) {
      return false;
    }
    const next: ProcessBatch = { ...current, ...patch, feedKg: patch.feedKg !== undefined ? Number(patch.feedKg) : current.feedKg };
    // 余量重算：排除本记录自身占用后，新投料量不得超过余量
    const remaining = remainingKgOfHerb(
      useHerbStore.getState().herbs.find((h) => h.id === next.herbId)?.feedKg ?? 0,
      get().batches,
      next.herbId,
      id,
    );
    if (next.feedKg > remaining + KG_EPSILON) {
      throw new Error(`投料量超出该药材批次余量，最多可投 ${roundKg(remaining)}kg`);
    }
    if (force) {
      next.qcBy = next.qcBy ?? '质检员 · 赵敏';
    }
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
    return true;
  },

  removeBatch: async (id) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return false;
    }
    // 锁定记录继续占用余量，必须先由质检员放行才能撤销
    if (current.locked) {
      return false;
    }
    await db.batches.delete(id);
    set({ batches: get().batches.filter((b) => b.id !== id) });
    return true;
  },

  lockBatch: async (id) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return;
    }
    const next: ProcessBatch = { ...current, locked: true, lockedAt: new Date().toISOString() };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
  },

  unlockAsQc: async (id, qcBy) => {
    const current = get().batches.find((b) => b.id === id);
    if (!current) {
      return;
    }
    const next: ProcessBatch = { ...current, locked: false, qcBy };
    await db.batches.put(next);
    set({ batches: get().batches.map((b) => (b.id === id ? next : b)) });
  },

  degreeCount: () => {
    const result: Record<ProcessDegree, number> = { 不及: 0, 适中: 0, 太过: 0 };
    get().batches.forEach((b) => {
      result[b.degree] += 1;
    });
    return result;
  },

  pendingBatches: () => get().batches.filter((b) => !b.locked),

  batchesOfHerb: (herbId) => get().batches.filter((b) => b.herbId === herbId),
}));
