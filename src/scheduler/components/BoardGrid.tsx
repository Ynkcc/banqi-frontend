import { coordText, pieceText, slotPlayer } from '../domain/pieces'

// BoardGrid 只读棋盘（上帝视角回放渲染）。
// board: 每格身份短码（"Empty" | "R_Sol"…，含未翻开暗子的真实身份）；
// shown: 每格是否已翻开（false = 渲染为暗面，但身份仍以半透明小字叠加显示）；
// lastFrom/lastTo: 上一步起止格高亮；
// policyHot: 教师根策略热力（格 → 0..1，绿色叠加 + 数值角标）。
export default function BoardGrid({
  board,
  shown,
  cols,
  lastFrom,
  lastTo,
  policyHot,
}: {
  board: string[]
  shown: boolean[]
  cols: number
  lastFrom?: number
  lastTo?: number
  policyHot?: Map<number, number>
}) {
  return (
    <div className="chess-board" style={{ ['--board-cols' as string]: String(cols) }}>
      {board.map((slot, idx) => {
        const isShown = !!shown[idx]
        const player = slotPlayer(slot)
        const classes = ['chess-cell']
        if (slot === 'Empty') classes.push('empty')
        else if (!isShown) classes.push('hidden')
        else classes.push(player === 'Red' ? 'red' : 'black')
        if (idx === lastFrom) classes.push('last-from')
        if (idx === lastTo) classes.push('last-to')
        const hot = policyHot?.get(idx) ?? 0
        return (
          <div
            key={idx}
            className={classes.join(' ')}
            style={
              hot > 0
                ? { boxShadow: `inset 0 0 0 ${2 + 3 * hot}px rgba(82, 196, 26, ${0.35 + 0.6 * hot})` }
                : undefined
            }
          >
            {slot === 'Empty' && <span className="coord-label">{coordText(idx, cols)}</span>}
            {isShown ? (
              pieceText(slot)
            ) : (
              <span className={`true-piece ${player === 'Red' ? 'tp-red' : 'tp-black'}`}>{pieceText(slot)}</span>
            )}
            {hot > 0 && (
              <span className="policy-badge" style={{ opacity: 0.45 + 0.55 * hot }}>
                {(hot * 100).toFixed(0)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
