import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

export const shortSha = (sha: string, n = 12) => (sha ? sha.slice(0, n) : '-')

export const fmtTime = (unix: number) => (unix ? dayjs.unix(unix).format('YYYY-MM-DD HH:mm:ss') : '-')

export const fmtAgo = (unix: number) => (unix ? dayjs.unix(unix).fromNow() : '-')

export const fmtMemory = (mb: number) => (mb > 0 ? `${(mb / 1024).toFixed(1)} GiB` : '-')

/** 大数缩写：1234 → 1234，12345 → 12.3k，1234567 → 1.2M（局数/步数展示用） */
export const fmtCount = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : String(n)

/** 数值安全格式化：null / 非有限值（旧后端可能下发）时显示占位符，避免 toFixed 崩溃白屏 */
export const fmtNum = (v: number | null | undefined, digits: number, fallback = '—') =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : fallback

export const winnerText = (winner: number) => (winner > 0 ? '红胜' : winner < 0 ? '黑胜' : '和棋')

/** 数据类别 → Tag 颜色：resnet=蓝 / nnue=紫 / none=灰（不产训练数据的对局记录）。 */
export const kindTagColor = (kind: string) =>
  kind === 'nnue' ? 'purple' : kind === 'none' ? 'default' : 'blue'
