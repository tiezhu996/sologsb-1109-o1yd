import type { HerbMaterial } from '../types/herb-material';
import type { ProcessBatch } from '../types/process-batch';

/** 数量比较容差：浮点误差内视为 0 */
export const KG_EPSILON = 1e-9;

/** 保留 1 位小数，消除浮点尾差（kg 台账最小计到 0.1kg） */
export function roundKg(value: number): number {
  return Math.round((value + KG_EPSILON) * 10) / 10;
}

/** 单个药材批次的核销情况（由全部工序记录实时推导，不单独落库） */
export interface HerbUsage {
  herbId: string;
  /** 入库量（kg） */
  receivedKg: number;
  /** 已用（核销）量（kg），锁定与未锁定工序均占用 */
  usedKg: number;
  /** 余量（kg） */
  remainingKg: number;
  /** 余量是否清零（已用完） */
  exhausted: boolean;
}

/** 统计某药材批次被工序记录核销的总量；excludeBatchId 用于编辑本记录时排除自身占用 */
export function usedKgOfHerb(batches: ProcessBatch[], herbId: string, excludeBatchId?: string): number {
  return roundKg(
    batches
      .filter((b) => b.herbId === herbId && b.id !== excludeBatchId)
      .reduce((sum, b) => sum + (Number(b.feedKg) || 0), 0),
  );
}

/** 某药材批次的余量（不含 excludeBatchId 的占用），历史数据超用时按 0 计 */
export function remainingKgOfHerb(receivedKg: number, batches: ProcessBatch[], herbId: string, excludeBatchId?: string): number {
  return Math.max(0, roundKg(receivedKg - usedKgOfHerb(batches, herbId, excludeBatchId)));
}

/** 单批次核销情况 */
export function usageOfHerb(herb: HerbMaterial, batches: ProcessBatch[], excludeBatchId?: string): HerbUsage {
  const receivedKg = roundKg(Number(herb.feedKg) || 0);
  const usedKg = usedKgOfHerb(batches, herb.id, excludeBatchId);
  const remainingKg = Math.max(0, roundKg(receivedKg - usedKg));
  return {
    herbId: herb.id,
    receivedKg,
    usedKg,
    remainingKg,
    exhausted: remainingKg <= KG_EPSILON,
  };
}

/**
 * 全部药材批次的核销情况。
 * 锁定记录继续占用余量；未锁定工序增删改后随 batches 引用变化自动重算。
 */
export function computeHerbUsage(herbs: HerbMaterial[], batches: ProcessBatch[]): Map<string, HerbUsage> {
  const map = new Map<string, HerbUsage>();
  herbs.forEach((herb) => map.set(herb.id, usageOfHerb(herb, batches)));
  return map;
}
