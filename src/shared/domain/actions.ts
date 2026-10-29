// 动作索引 → (from, to) 表。构建顺序必须与 banqi-core env/actions.rs 保持一致：
// 翻棋单格 → 四邻移动 → 同行长距 → 同列长距。
// 前端用于策略热力落格 / 回放动作定位；改此处前先核对 actions.rs。
export function actionToCoords(rows: number, cols: number): [number, number][] {
  const n = rows * cols
  const out: [number, number][] = []
  // 1) 翻棋：单格 (sq, sq)
  for (let sq = 0; sq < n; sq++) out.push([sq, sq])
  // 2) 四邻移动（上、下、左、右）
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
  // 3) 同行长距 + 4) 同列长距（跳吃）
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
