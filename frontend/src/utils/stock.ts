import type { HerbMaterial } from '../types/herb-material';
import type { ProcessBatch } from '../types/process-batch';

/** 投料量浮点比较容差（kg） */
export const STOCK_EPS = 1e-6;

/** 单个药材批次的核销情况 */
export interface HerbStock {
  /** 入库投料量（kg） */
  feedKg: number;
  /** 已被工序记录核销的量（锁定与未锁定记录都占用，kg） */
  usedKg: number;
  /** 余量（kg） */
  remainingKg: number;
  /** 余量是否已清零（标为已用完） */
  exhausted: boolean;
}

export type HerbStockMap = Map<string, HerbStock>;

/** 保留三位小数，规避浮点累计误差 */
export function roundKg(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** kg 展示：去掉多余的尾零（120.000 -> 120，0.80 -> 0.8） */
export function formatKg(value: number): string {
  return roundKg(value)
    .toFixed(3)
    .replace(/\.?0+$/, '');
}

/**
 * 按药材批次汇总工序核销情况。
 * 所有工序记录（无论是否锁定）都占用余量；未锁定记录被改动或撤销后，
 * 只要重新调用本函数即可由记录重算出正确余量。
 */
export function buildStockMap(herbs: HerbMaterial[], batches: ProcessBatch[]): HerbStockMap {
  const map: HerbStockMap = new Map();
  herbs.forEach((herb) => {
    map.set(herb.id, {
      feedKg: herb.feedKg,
      usedKg: 0,
      remainingKg: herb.feedKg,
      exhausted: herb.feedKg <= STOCK_EPS,
    });
  });
  batches.forEach((batch) => {
    const stock = map.get(batch.herbId);
    if (stock) {
      stock.usedKg += Number(batch.feedKg) || 0;
    }
  });
  map.forEach((stock) => {
    stock.usedKg = roundKg(stock.usedKg);
    stock.remainingKg = roundKg(stock.feedKg - stock.usedKg);
    stock.exhausted = stock.remainingKg <= STOCK_EPS;
  });
  return map;
}

/** 全部批次的余量合计（首页待炮制量） */
export function totalRemaining(stockMap: HerbStockMap): number {
  return roundKg(Array.from(stockMap.values()).reduce((sum, stock) => sum + Math.max(0, stock.remainingKg), 0));
}

/** 工序投料超出药材批次余量时抛出，message 中带本次可投数量 */
export class StockOverflowError extends Error {
  availableKg: number;

  constructor(availableKg: number, herbName: string, batchNo: string) {
    super(`药材「${herbName}（${batchNo}）」可投数量仅 ${formatKg(availableKg)}kg`);
    this.name = 'StockOverflowError';
    this.availableKg = roundKg(availableKg);
  }
}

/**
 * 校验本次工序投料是否超出对应药材批次的余量，超出则抛 StockOverflowError。
 * @param excludeBatchId 编辑已有工序时排除自身记录的投料
 */
export function assertWithinStock(
  herbs: HerbMaterial[],
  batches: ProcessBatch[],
  herbId: string,
  feedKg: number,
  excludeBatchId?: string,
): void {
  const herb = herbs.find((item) => item.id === herbId);
  if (!herb) {
    throw new Error('所选药材批次不存在或已删除');
  }
  const usedKg = batches
    .filter((batch) => batch.herbId === herbId && batch.id !== excludeBatchId)
    .reduce((sum, batch) => sum + (Number(batch.feedKg) || 0), 0);
  const availableKg = roundKg(herb.feedKg - usedKg);
  if (feedKg > availableKg + STOCK_EPS) {
    throw new StockOverflowError(Math.max(0, availableKg), herb.name, herb.batchNo);
  }
}
