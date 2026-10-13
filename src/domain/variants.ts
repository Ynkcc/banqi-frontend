/**
 * 变体元信息域模块：元数据全部来自后端 `list_variants`（banqi-core 单一真源）。
 *
 * 新增变体只改 banqi-core（Variant 枚举 + config 函数），本模块与所有 UI
 * 组件零改动；不维护本地兜底表（避免与 core 漂移，历史上 4x8-fast 血量
 * 曾与 core 不一致）。
 *
 * 模块加载即发起拉取；同步 helper 在元信息未就绪/拉取失败时使用几何或
 * 默认值回退（见各函数注释），仅影响首帧短暂显示，正常路径以拉取结果为准。
 */

import { api } from '../api/client';
import type { VariantInfo } from '../api/types';

let info: VariantInfo[] = [];

/** 进程启动即拉取；组件也可 await 此 Promise 确保元信息就绪。 */
export const variantsReady: Promise<VariantInfo[]> = api
  .listVariants()
  .then((vs) => (info = vs))
  .catch((err) => {
    console.error('list_variants failed, variant meta unavailable', err);
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
