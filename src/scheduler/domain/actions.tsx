// 动作索引 → (from, to) 表（与 banqi-core env/actions.rs 构建顺序对齐：
// 翻棋单格 → 四邻移动 → 同行长距 → 同列长距）。前端用于策略热力落格。
export function actionToCoords(rows: number, cols: number): [number, number][] {
  const n = rows * cols
  const out: [number, number][] = []
  for (let sq = 0; sq < n; sq++) out.push([sq, sq])
  const dirs: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]
  for (let r1 = 0; r1 < rows; r1++) {
    for (let c1 = 0; c1 < cols; c1++) {
      const from = r1 * cols + c1
      for (const [dr, dc] of dirs) {
        const r2 = r1 + dr
        const c2 = c1 + dc
        if (r2 >= 0 && r2 < rows && c2 >= 0 && c2 < cols) {
          out.push([from, r2 * cols + c2])
        }
      }
    }
  }
  for (let r1 = 0; r1 < rows; r1++) {
    for (let c1 = 0; c1 < cols; c1++) {
      const from = r1 * cols + c1
      for (let c2 = 0; c2 < cols; c2++) {
        if (Math.abs(c1 - c2) > 1) out.push([from, r1 * cols + c2])
      }
      for (let r2 = 0; r2 < rows; r2++) {
        if (Math.abs(r1 - r2) > 1) out.push([from, r2 * cols + c1])
      }
    }
  }
  return out
}

// Sparkline 内联折线图（自适应归一化）。
export function Sparkline({
  values,
  color,
  height = 56,
  zeroLine = false,
}: {
  values: number[]
  color: string
  height?: number
  zeroLine?: boolean
}) {
  const w = 100 // viewBox 宽，等比缩放
  if (values.length < 2) return <svg className="replay-chart" style={{ height }} viewBox={`0 0 ${w} ${height}`} />
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (zeroLine) {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }
  const span = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = height - 4 - ((v - min) / span) * (height - 8)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  return (
    <svg className="replay-chart" style={{ height }} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      {zeroLine && min < 0 && max > 0 && (
        <line x1="0" x2={w} y1={height - 4 - ((0 - min) / span) * (height - 8)} y2={height - 4 - ((0 - min) / span) * (height - 8)} stroke="#d9d9d9" strokeWidth="0.5" strokeDasharray="2 2" />
      )}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
