/**
 * 变体元信息域模块：元数据全部来自后端 `list_variants`（banqi-core 单一真源）。
 *
 * 新增变体只改 banqi-core（Variant 枚举 + config 函数），本模块与所有 UI
 * 组件零改动；仅在 IPC 不可用的兜底场景下保留最小默认表。
 *
 * 模块加载即发起拉取，同步 helper 在元信息未就绪时使用兜底表
 * （兜底表与 core 同源，仅作为首帧/异常的过渡，正常路径以拉取结果为准）。
 */

import { api } from '../api/client';
import type { VariantInfo } from '../api/types';

/** 兜底表：仅在后端 list_variants 未就绪/失败时使用。 */
const FALLBACK: VariantInfo[] = [
  { id: '4x8', label: '暗棋 (4x8)', rows: 4, cols: 8, initial_health: 60, max_consecutive_moves_for_draw: 24 },
  { id: '4x8-fast', label: '快速验证 (4x8-fast)', rows: 4, cols: 8, initial_health: 40, max_consecutive_moves_for_draw: 24 },
  { id: '4x4', label: '暗棋 (4x4)', rows: 4, cols: 4, initial_health: 60, max_consecutive_moves_for_draw: 16 },
  { id: '4x2', label: '迷你暗棋 (4x2)', rows: 4, cols: 2, initial_health: 47, max_consecutive_moves_for_draw: 8 },
];

let info: VariantInfo[] = FALLBACK;

/** 进程启动即拉取；组件也可 await 此 Promise 确保元信息就绪。 */
export const variantsReady: Promise<VariantInfo[]> = api
  .listVariants()
  .then((vs) => (info = vs))
  .catch((err) => {
    console.error('list_variants failed, using fallback', err);
    return info;
  });

/** 当前已就绪的变体元信息（同步读取，拉取完成后即与后端一致）。 */
export function variantInfos(): VariantInfo[] {
  return info;
}

function findInfo(variant: string): VariantInfo | undefined {
  return info.find((v) => v.id === variant);
}

/** 变体显示名（未知变体回退为其 id 本身）。 */
export function variantLabel(variant: string): string {
  return findInfo(variant)?.label ?? variant;
}

/** 棋盘行列：优先查元信息，未知变体按格数反推（4 行）。 */
export function variantDims(variant: string, boardLen: number): { rows: number; cols: number } {
  const v = findInfo(variant);
  if (v) return { rows: v.rows, cols: v.cols };
  return { rows: 4, cols: Math.max(1, Math.round(boardLen / 4)) };
}

/** 初始血量上限（未知变体回退 60）。 */
export function maxHp(variant: string): number {
  return findInfo(variant)?.initial_health ?? 60;
}

/** 连续无吃子判和步数（未知变体回退 24）。 */
export function variantMaxConsecutive(variant: string): number {
  return findInfo(variant)?.max_consecutive_moves_for_draw ?? 24;
}
