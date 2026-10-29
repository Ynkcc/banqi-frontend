// 共享棋子域逻辑：Vue 棋盘应用与 React 调度后台共同引用，消除双份实现的漂移源。
// 短码格式与 banqi-server GameStateView.board 一致："R_Sol" / "B_Gen" / "Hidden" / "Empty"。
// 本模块不得依赖任何一侧的 API 类型定义（保持纯函数、参数用 string）。

// 全名 → 红黑文字
export const PIECE_META: Record<string, { red: string; black: string }> = {
  General: { red: '帥', black: '將' },
  Advisor: { red: '仕', black: '士' },
  Elephant: { red: '相', black: '象' },
  Chariot: { red: '車', black: '車' },
  Horse: { red: '馬', black: '馬' },
  Cannon: { red: '炮', black: '砲' },
  Soldier: { red: '兵', black: '卒' },
}

// 短码 → 全名（dead_pieces / PIECE_TYPE_ORDER 使用）
export const TYPE_BY_ABBR: Record<string, string> = {
  Sol: 'Soldier',
  Can: 'Cannon',
  Hor: 'Horse',
  Cha: 'Chariot',
  Ele: 'Elephant',
  Adv: 'Advisor',
  Gen: 'General',
}

// slotPlayer 短码所属方："R_"→Red / "B_"→Black / 其他 → null。
export function slotPlayer(slot: string): 'Red' | 'Black' | null {
  if (slot.startsWith('R_')) return 'Red'
  if (slot.startsWith('B_')) return 'Black'
  return null
}

// pieceText 短码 → 汉字；"Empty" → ''，"Hidden" → '?'；
// 未知短码回退显示其缩写（banqi-core 不会产出未知缩写，此分支仅作容错）。
export function pieceText(slot: string): string {
  if (slot === 'Empty') return ''
  if (slot === 'Hidden') return '?'
  const player = slotPlayer(slot)
  if (!player) return ''
  const abbr = slot.slice(2)
  const type = TYPE_BY_ABBR[abbr]
  const meta = type ? PIECE_META[type] : undefined
  return meta ? meta[player === 'Red' ? 'red' : 'black'] : abbr
}

// coordText 格子坐标标注（列字母 a.. + 行号 1..，两侧同口径）。
export function coordText(idx: number, cols: number): string {
  return `${String.fromCharCode(97 + (idx % cols))}${Math.floor(idx / cols) + 1}`
}
