// 动作索引 → 坐标逻辑已收敛到共享模块 src/shared/domain/actions.ts（与 banqi-core
// env/actions.rs 构建顺序对齐）。本文件保留 re-export 与 React 侧特有的展示组件。
export { actionToCoords } from '../../shared/domain/actions'

// Sparkline 内联折线图（自适应归一化）——React 特有，留在本侧。
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
