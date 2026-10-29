// 棋子域逻辑已收敛到共享模块 src/shared/domain/pieces.ts（Vue/React 双入口共用）。
// 本文件保留 re-export，消费方 import 路径不变；Vue 侧特有的辅助导出留在本文件。

import type { Slot } from '../api/types';

export {
  PIECE_META,
  TYPE_BY_ABBR,
  slotPlayer,
  pieceText,
  coordText,
} from '../shared/domain/pieces';

export const PIECE_TYPE_ORDER = [
  'General',
  'Advisor',
  'Elephant',
  'Chariot',
  'Horse',
  'Cannon',
  'Soldier',
] as const;

export const BITBOARD_ORDER: { key: string; label: string }[] = [
  { key: 'hidden', label: 'Hidden (暗子)' },
  { key: 'empty', label: 'Empty (空位)' },
  { key: 'red_revealed', label: 'Red All (红方)' },
  { key: 'black_revealed', label: 'Black All (黑方)' },
  { key: 'red_soldier', label: 'R_Sol (红兵)' },
  { key: 'black_soldier', label: 'B_Sol (黑卒)' },
  { key: 'red_advisor', label: 'R_Adv (红仕)' },
  { key: 'black_advisor', label: 'B_Adv (黑士)' },
  { key: 'red_general', label: 'R_Gen (红帅)' },
  { key: 'black_general', label: 'B_Gen (黑将)' },
  { key: 'red_cannon', label: 'R_Can (红炮)' },
  { key: 'black_cannon', label: 'B_Can (黑砲)' },
  { key: 'red_horse', label: 'R_Hor (红馬)' },
  { key: 'black_horse', label: 'B_Hor (黑馬)' },
  { key: 'red_chariot', label: 'R_Cha (红車)' },
  { key: 'black_chariot', label: 'B_Cha (黑車)' },
  { key: 'red_elephant', label: 'R_Ele (红相)' },
  { key: 'black_elephant', label: 'B_Ele (黑象)' },
];

export function isRevealed(slot: Slot): boolean {
  return slot !== 'Empty' && slot !== 'Hidden';
}

export function countByType(names: string[] | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of PIECE_TYPE_ORDER) counts[t] = 0;
  for (const name of names ?? []) {
    if (name in counts) counts[name] += 1;
  }
  return counts;
}

// 变体相关派生信息（dims / maxHp）已收敛到 variants.ts（后端单一真源），此处仅转出。
export { variantDims, maxHp, variantLabel } from './variants';
