// 棋子域逻辑已收敛到共享模块 src/shared/domain/pieces.ts（Vue/React 双入口共用）。
// 本文件保留 re-export，消费方 import 路径不变。
export {
  PIECE_META,
  TYPE_BY_ABBR,
  slotPlayer,
  pieceText,
  coordText,
} from '../../shared/domain/pieces'
