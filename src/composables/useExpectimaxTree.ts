import { reactive } from 'vue';
import { api } from '../api/client';
import type { ExEdge, ExNodeBoard, ExNodeSummary, ExRootInfo } from '../api/types';
import { useToast } from './useToast';
import { appendLog } from './useLogs';

const toast = useToast();

/** 焦点节点下子瓦片的排序方式 */
export type ExSortMode = 'server' | 'action-asc' | 'action-desc' | 'value-desc' | 'value-asc';

export const EX_SORT_OPTIONS: { value: ExSortMode; label: string }[] = [
  { value: 'server', label: '服务器顺序' },
  { value: 'value-desc', label: '价值 ↓' },
  { value: 'value-asc', label: '价值 ↑' },
  { value: 'action-asc', label: '着法 # ↑' },
  { value: 'action-desc', label: '着法 # ↓' },
];

/** 剪枝原因 → 展示标签（对应核心库 st_mark_pruned 的 reason） */
export const PRUNE_REASON_LABELS: Record<string, string> = {
  beta_cut: 'β截断',
  futility: '静态剪',
  flip_once: '翻子限',
  q_topk: '扇出限',
  q_delta: 'δ剪',
  q_see: 'SEE剪',
};

export function pruneReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return PRUNE_REASON_LABELS[reason] ?? reason;
}

/** treemap 瓦片模型（焦点节点的直接子节点） */
export interface ExTile {
  id: number;
  edge: ExEdge;
  /** 边值（父视角） */
  value: number;
  flag: string;
  mark: string | null;
  /** 该分支因剪枝而终止（未实际搜索） */
  pruned: boolean;
  /** 剪枝原因原始标识符 */
  pruneReason: string | null;
  /** 子树消耗的预算（tick 数） */
  spent: number;
  childCount: number;
}

export interface ExChildrenView {
  tiles: ExTile[];
}

interface ExStore {
  rootInfo: ExRootInfo | null;
  searching: boolean;
  selectedId: number | null;
  selectedBoard: ExNodeBoard | null;
  selectedDetail: ExNodeSummary | null;
  inspectorLoading: boolean;
  /** 焦点节点棋盘（根时即行动前局面）：无选中项时检视器兜底展示 */
  focusBoard: ExNodeBoard | null;
  focusBoardLoading: boolean;
  /** 选中 outcome 分支时锚定的父机会节点棋盘（保持翻开前形态与高亮不变） */
  outcomeAnchor: ExNodeBoard | null;
  /** 从根到当前焦点的边路径（面包屑） */
  focusTrail: ExEdge[];
  /** 当前焦点节点 id（0 = 根） */
  focusId: number;
  sortMode: ExSortMode;
}

const store = reactive<ExStore>({
  rootInfo: null,
  searching: false,
  selectedId: null,
  selectedBoard: null,
  selectedDetail: null,
  inspectorLoading: false,
  focusBoard: null,
  focusBoardLoading: false,
  outcomeAnchor: null,
  focusTrail: [],
  focusId: 0,
  sortMode: 'server',
});

const childrenCache = new Map<number, ExEdge[]>();
const boardCache = new Map<number, ExNodeBoard>();
const detailCache = new Map<number, ExNodeSummary>();

function rootId(): number {
  return store.rootInfo?.root.id ?? 0;
}

async function ensureChildren(nodeId: number): Promise<ExEdge[]> {
  const cached = childrenCache.get(nodeId);
  if (cached) return cached;
  const edges = await api.nnueGetChildren(nodeId);
  childrenCache.set(nodeId, edges);
  return edges;
}

async function refresh(): Promise<void> {
  try {
    const info = await api.nnueGetRoot();
    store.rootInfo = info;
    childrenCache.clear();
    boardCache.clear();
    detailCache.clear();
    store.focusTrail = [];
    store.focusId = info.root.id;
    store.selectedId = null;
    store.selectedBoard = null;
    store.selectedDetail = null;
    store.inspectorLoading = false;
    store.focusBoard = null;
    store.focusBoardLoading = false;
    store.outcomeAnchor = null;
    await ensureChildren(info.root.id);
    store.focusBoard = boardCache.get(info.root.id) ?? null;
    void ensureFocusBoard();
  } catch (e) {
    store.rootInfo = null;
    toast.info(String(e));
  }
}

/**
 * 选中 outcome 分支时，定位其父机会节点棋盘作为检视器锚点
 * （ outcome 分支棋盘为揭示后形态，直接展示会导致高亮/棋盘跳变）。
 */
async function outcomeParentBoard(nodeId: number): Promise<ExNodeBoard | null> {
  for (const [pid, edges] of childrenCache) {
    if (!edges.some((e) => e.child_id === nodeId && e.is_outcome)) continue;
    try {
      const board = boardCache.get(pid) ?? (await api.nnueGetNodeBoard(pid));
      boardCache.set(pid, board);
      return board;
    } catch (e) {
      console.error('nnue outcome parent board failed:', e);
      return null;
    }
  }
  return null;
}

async function select(nodeId: number): Promise<void> {
  store.selectedId = nodeId;
  store.selectedBoard = boardCache.get(nodeId) ?? null;
  store.selectedDetail = detailCache.get(nodeId) ?? null;
  store.inspectorLoading = true;
  try {
    const [board, detail] = await Promise.all([
      boardCache.get(nodeId) ?? api.nnueGetNodeBoard(nodeId),
      fetchDetail(nodeId),
    ]);
    boardCache.set(nodeId, board);
    if (store.selectedId !== nodeId) return;
    store.selectedBoard = board;
    store.selectedDetail = detail;
    store.outcomeAnchor = detail?.is_outcome ? await outcomeParentBoard(nodeId) : null;
  } catch (e) {
    console.error('nnue node inspector failed:', e);
    if (store.selectedId === nodeId) {
      store.selectedBoard = null;
      store.selectedDetail = null;
      store.outcomeAnchor = null;
    }
  } finally {
    if (store.selectedId === nodeId) store.inspectorLoading = false;
  }
}

/** 选中切换：再次点击已选中的节点即取消选中 */
function toggleSelect(nodeId: number): void {
  if (store.selectedId === nodeId) {
    clearSelection();
  } else {
    void select(nodeId);
  }
}

function clearSelection() {
  store.selectedId = null;
  store.selectedBoard = null;
  store.selectedDetail = null;
  store.inspectorLoading = false;
  store.outcomeAnchor = null;
}

/** 懒加载焦点节点棋盘（根时即行动前局面），供检视器在无选中项时兜底展示 */
async function ensureFocusBoard(): Promise<void> {
  if (!store.rootInfo || store.focusBoard || store.focusBoardLoading) return;
  const fid = store.focusId;
  store.focusBoardLoading = true;
  try {
    const board = boardCache.get(fid) ?? (await api.nnueGetNodeBoard(fid));
    boardCache.set(fid, board);
    if (store.focusId === fid) store.focusBoard = board;
  } catch (e) {
    console.error('nnue focus board failed:', e);
  } finally {
    store.focusBoardLoading = false;
  }
}

/** 焦点变化后同步焦点棋盘：缓存命中立即展示，否则异步拉取 */
function syncFocusBoard(): void {
  store.focusBoard = boardCache.get(store.focusId) ?? null;
  void ensureFocusBoard();
}

async function fetchDetail(nodeId: number): Promise<ExNodeSummary | null> {
  const cached = detailCache.get(nodeId);
  if (cached) return cached;
  try {
    const detail = await api.nnueGetNodeDetail(nodeId);
    detailCache.set(nodeId, detail);
    return detail;
  } catch {
    return null;
  }
}

/** outcome 边对应的揭示棋子（依赖父机会节点棋盘缓存；未缓存时返回 null） */
export function outcomeRevealedOf(edge: ExEdge): string | null {
  if (!edge.is_outcome) return null;
  for (const [, board] of boardCache) {
    const o = board.chance_outcomes.find((c) => c.child_id === edge.child_id);
    if (o) return o.revealed ?? null;
  }
  return null;
}

/** 双击瓦片：下钻到该子节点 */
async function descend(edge: ExEdge): Promise<void> {
  if (edge.child_count === 0) return;
  try {
    await ensureChildren(edge.child_id);
  } catch (e) {
    console.error('nnue_get_children failed:', e);
  }
  store.focusTrail.push(edge);
  store.focusId = edge.child_id;
  syncFocusBoard();
}

/** 面包屑跳转：depth 0 = 根，n = 第 n 条边之后 */
function ascendTo(depth: number): void {
  if (depth < 0 || depth > store.focusTrail.length) return;
  store.focusTrail.splice(depth);
  store.focusId = depth === 0 ? rootId() : store.focusTrail[depth - 1].child_id;
  syncFocusBoard();
}

function sortEdges(edges: ExEdge[]): ExEdge[] {
  const arr = [...edges];
  switch (store.sortMode) {
    case 'action-asc':
      arr.sort((a, b) => a.action - b.action);
      break;
    case 'action-desc':
      arr.sort((a, b) => b.action - a.action);
      break;
    case 'value-desc':
      arr.sort((a, b) => b.value - a.value);
      break;
    case 'value-asc':
      arr.sort((a, b) => a.value - b.value);
      break;
  }
  return arr;
}

function tileOf(e: ExEdge): ExTile {
  return {
    id: e.child_id,
    edge: e,
    // 机会节点（翻子）在窗口截断时 value 是边界值（兄弟节点常相同），
    // 展示以期望值为准（父视角 = -exp）
    value: e.exp_value != null ? -e.exp_value : e.value,
    flag: e.flag,
    mark: e.mark,
    pruned: e.pruned,
    pruneReason: e.prune_reason ?? null,
    spent: e.spent_nodes,
    childCount: e.child_count,
  };
}

/** 焦点节点的子瓦片视图（按排序方式排列；面板以等分网格展示，不聚合） */
function focusChildren(): ExChildrenView {
  return {
    tiles: sortEdges(childrenCache.get(store.focusId) ?? []).map(tileOf),
  };
}

/** 焦点节点子树消耗的预算（根时 = 整棵树最后一次迭代的消耗） */
function focusSpent(): number {
  if (store.focusTrail.length === 0) return store.rootInfo?.root.spent_nodes ?? 0;
  return store.focusTrail[store.focusTrail.length - 1].spent_nodes;
}

/** 主变例（PV）：仅覆盖已缓存的边。决策层取 exact 且 value 最大的子，否则取 value 最大。 */
function pvIds(): Set<number> {
  const pv = new Set<number>();
  let id: number | undefined = rootId();
  let guard = 0;
  while (id !== undefined && guard++ < 64) {
    pv.add(id);
    const edges = childrenCache.get(id);
    if (!edges || edges.length === 0) break;
    const exact = edges.filter((e) => e.flag === 'exact' && !e.is_outcome);
    const searched = edges.filter((e) => !e.pruned && !e.is_outcome);
    const pool = exact.length > 0 ? exact : searched.length > 0 ? searched : edges;
    id = pool.reduce((best, e) => (e.value > best.value ? e : best)).child_id;
  }
  return pv;
}

async function search() {
  store.searching = true;
  try {
    const info = await api.nnueSearch();
    const s = info.stats;
    appendLog(
      `Expectimax 手动搜索: 模式 ${s.mode}，完成深度 ${s.reached_depth}，` +
        `节点 ${s.nodes}，耗时 ${s.elapsed_ms}ms`,
    );
    await refresh();
  } catch (e) {
    toast.error('Expectimax 搜索失败：' + e);
  } finally {
    store.searching = false;
  }
}

/** 子瓦片矩形（等分网格布局用） */
export interface ExRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function useExpectimaxTree() {
  return {
    store,
    refresh,
    search,
    fetchDetail,
    select,
    toggleSelect,
    clearSelection,
    ensureFocusBoard,
    descend,
    ascendTo,
    sortEdges,
    focusChildren,
    focusSpent,
    pvIds,
  };
}
