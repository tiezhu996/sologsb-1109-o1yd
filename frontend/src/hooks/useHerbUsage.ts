import { useMemo } from 'react';
import { useHerbStore } from '../stores/herbStore';
import { useBatchStore } from '../stores/batchStore';
import { computeHerbUsage, type HerbUsage } from '../utils/herb-usage';

/**
 * 药材批次核销情况（入库量 / 已用 / 余量）。
 * 同时订阅药材台账与工序记录：工序被新增、改动或撤销后余量自动重算。
 */
export function useHerbUsage(): Map<string, HerbUsage> {
  const herbs = useHerbStore((s) => s.herbs);
  const batches = useBatchStore((s) => s.batches);
  return useMemo(() => computeHerbUsage(herbs, batches), [herbs, batches]);
}
