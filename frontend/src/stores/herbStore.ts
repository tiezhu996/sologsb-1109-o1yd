import { create } from 'zustand';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { buildStockMap } from '../utils/stock';
import { useBatchStore } from './batchStore';
import type { HerbGroupSummary, HerbMaterial, HerbOrigin, HerbPart } from '../types/herb-material';

export interface HerbInput {
  name: string;
  origin: HerbOrigin;
  part: HerbPart;
  batchNo: string;
  feedKg: number;
  receivedAt?: string;
  remark?: string;
}

interface HerbState {
  herbs: HerbMaterial[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addHerb: (input: HerbInput) => Promise<HerbMaterial>;
  updateHerb: (id: string, patch: Partial<HerbInput>) => Promise<void>;
  /** 删除药材批次；已被工序记录核销（含未锁定）时返回 false，避免占用量悬空 */
  removeHerb: (id: string) => Promise<boolean>;
  /** 按药材分组回显批次与待炮制量（按余量合计） */
  groupSummary: () => HerbGroupSummary[];
}

export const useHerbStore = create<HerbState>()((set, get) => ({
  herbs: [],
  hydrated: false,

  hydrate: async () => {
    const herbs = await db.herbs.orderBy('receivedAt').reverse().toArray();
    set({ herbs, hydrated: true });
  },

  addHerb: async (input) => {
    const herb: HerbMaterial = {
      id: uid('herb'),
      name: input.name.trim(),
      origin: input.origin,
      part: input.part,
      batchNo: input.batchNo.trim(),
      feedKg: Number(input.feedKg) || 0,
      receivedAt: input.receivedAt ?? new Date().toISOString(),
      remark: input.remark?.trim() || undefined,
    };
    await db.herbs.put(herb);
    set({ herbs: [herb, ...get().herbs] });
    return herb;
  },

  updateHerb: async (id, patch) => {
    const current = get().herbs.find((h) => h.id === id);
    if (!current) {
      return;
    }
    const next: HerbMaterial = { ...current, ...patch, feedKg: patch.feedKg !== undefined ? Number(patch.feedKg) : current.feedKg };
    await db.herbs.put(next);
    set({ herbs: get().herbs.map((h) => (h.id === id ? next : h)) });
  },

  removeHerb: async (id) => {
    // 已有工序核销记录的批次不能直接删除（锁定记录会一直占用），需先撤销相关工序
    const referenced = useBatchStore.getState().batches.some((b) => b.herbId === id);
    if (referenced) {
      return false;
    }
    await db.herbs.delete(id);
    set({ herbs: get().herbs.filter((h) => h.id !== id) });
    return true;
  },

  groupSummary: () => {
    // 待炮制量取各批次余量（入库量 − 工序核销，锁定记录也占用）
    const stockMap = buildStockMap(get().herbs, useBatchStore.getState().batches);
    const map = new Map<string, HerbGroupSummary>();
    get().herbs.forEach((herb) => {
      const stock = stockMap.get(herb.id);
      const feedKg = stock?.feedKg ?? herb.feedKg;
      const usedKg = stock?.usedKg ?? 0;
      const remainingKg = Math.max(0, stock?.remainingKg ?? herb.feedKg);
      const existed = map.get(herb.name);
      if (existed) {
        existed.batches += 1;
        existed.feedKg += feedKg;
        existed.usedKg += usedKg;
        existed.pendingKg += remainingKg;
      } else {
        map.set(herb.name, { name: herb.name, origin: herb.origin, part: herb.part, batches: 1, feedKg, usedKg, pendingKg: remainingKg });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.pendingKg - a.pendingKg);
  },
}));
