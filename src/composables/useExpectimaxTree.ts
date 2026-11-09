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

/** 焦点节点的子瓦片视图（按排序方式排列；太小的瓦片由布局算法自动聚合） */
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

// ---------------------------------------------------------------------------
// Squarified treemap 布局（参考 refs/SpaceKnife 的 layout 引擎设计）
//
// 设计要点（对应 SpaceKnife layout/squarify.py 与 layout/merge.py）：
// 1. 面积严格线性映射：面积占比 = 预算占比，不做 minCell 钳制、不失真；
// 2. 纯浮点布局，最后取整：相邻块共享精确边界（行末块拉伸到行尾），
//    取整不会产生缝隙或重叠；
// 3. 块间隙：每块自带右/下 gap（容器向右下扩展一个 gap 参与 squarify），
//    行末/列末块的 gap 落在容器外被裁掉，边缘自然贴合；
// 4. 小项聚合：把像素面积阈值换算成预算阈值，低于阈值的叶子合并为
//    「小项 ×N」（SMALL），剩余仍低于阈值的项（含 SMALL 块自身）合并为
//    「＋N 项」（MORE）放在该层最后——放不下的都兜进 ＋N，而不是拉大失真。
// ---------------------------------------------------------------------------

export interface ExRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 聚合块：太小无法单独显示的子节点合并后的占位瓦片 */
export interface ExAggregate<T> {
  kind: 'small' | 'more';
  /** 被聚合的子节点数 */
  count: number;
  /** 聚合块的预算权重（参与面积分配） */
  weight: number;
  /** 被聚合的原始瓦片 */
  members: T[];
  rect: ExRect;
}

export interface ExTreemapResult<T> {
  /** 与 items 同序的矩形；被聚合的项为零面积 */
  rects: ExRect[];
  /** 聚合块，按布局顺序（small 在 more 之前） */
  aggregates: ExAggregate<T>[];
}

export interface ExTreemapOptions<T> {
  /** 预算权重（面积来源） */
  weightOf: (item: T) => number;
  /** 是否叶子（不可下钻）；太小的叶子优先聚合为「小项 ×N」 */
  isLeaf?: (item: T) => boolean;
  /** 最小元素边长（px）：面积低于该值的平方即视为太小而聚合，默认 14 */
  minElement?: number;
  /** 块间隙（px），默认 2 */
  gap?: number;
}

/**
 * 纯浮点 squarified 布局（SpaceKnife squarify.py 的移植）。
 * 假定 areas 已按降序排列；行增长遵循 Bruls/Huizing/van Wijk 2000。
 */
function squarifyCore(areas: number[], x0: number, y0: number, x1: number, y1: number): ExRect[] {
  const n = areas.length;
  const out: ExRect[] = new Array(n);
  const total = areas.reduce((a, b) => a + b, 0);
  if (n === 0 || total <= 0 || x1 <= x0 || y1 <= y0) {
    for (let k = 0; k < n; k++) out[k] = { x: x0, y: y0, w: 0, h: 0 };
    return out;
  }
  const scale = ((x1 - x0) * (y1 - y0)) / total;
  const a = areas.map((v) => v * scale);
  let i = 0;
  let cx0 = x0;
  let cy0 = y0;
  while (i < n) {
    const w = x1 - cx0;
    const h = y1 - cy0;
    if (w <= 0 || h <= 0) {
      for (let k = i; k < n; k++) out[k] = { x: cx0, y: cy0, w: 0, h: 0 };
      break;
    }
    const side = Math.min(w, h);
    const side2 = side * side;
    // 只要最差长宽比还在改善就继续往行里加块
    let rsum = a[i];
    let rmin = a[i];
    let rmax = a[i];
    let best = rsum > 0 ? Math.max((side2 * rmax) / (rsum * rsum), (rsum * rsum) / (side2 * rmin)) : Infinity;
    let j = i + 1;
    while (j < n) {
      const v = a[j];
      const nsum = rsum + v;
      const nmin = Math.min(v, rmin);
      const nmax = Math.max(v, rmax);
      const s2 = nsum * nsum;
      const worst = nmin > 0 ? Math.max((side2 * nmax) / s2, s2 / (side2 * nmin)) : Infinity;
      if (worst > best) break;
      rsum = nsum;
      rmin = nmin;
      rmax = nmax;
      best = worst;
      j++;
    }
    const last = j === n;
    if (w >= h) {
      // 左缘竖列
      const cx = last ? x1 : cx0 + rsum / h;
      let y = cy0;
      for (let k = i; k < j; k++) {
        const ny = k === j - 1 ? y1 : cx > cx0 ? y + a[k] / (cx - cx0) : y;
        out[k] = { x: cx0, y, w: cx - cx0, h: ny - y };
        y = ny;
      }
      cx0 = cx;
    } else {
      // 上缘横行
      const cy = last ? y1 : cy0 + rsum / w;
      let x = cx0;
      for (let k = i; k < j; k++) {
        const nx = k === j - 1 ? x1 : cy > cy0 ? x + a[k] / (cy - cy0) : x;
        out[k] = { x, y: cy0, w: nx - x, h: cy - cy0 };
        x = nx;
      }
      cy0 = cy;
    }
    i = j;
  }
  return out;
}

/** 浮点坐标对齐像素网格：相邻块共享边界值，取整不会开缝 */
function snapRect(r: ExRect): ExRect {
  const x0 = Math.round(r.x);
  const y0 = Math.round(r.y);
  return { x: x0, y: y0, w: Math.round(r.x + r.w) - x0, h: Math.round(r.y + r.h) - y0 };
}

/**
 * SpaceKnife 风格的 treemap 布局入口：面积精确线性映射 + 小项聚合，
 * 替代旧的「minCell 钳制换面积失真」方案。
 */
export function treemapLayout<T>(
  items: readonly T[],
  rect: ExRect,
  opts: ExTreemapOptions<T>,
): ExTreemapResult<T> {
  const n = items.length;
  const minElement = opts.minElement ?? 14;
  const gap = opts.gap ?? 2;
  const zero: ExRect = { x: rect.x, y: rect.y, w: 0, h: 0 };
  const rects: ExRect[] = new Array(n);
  for (let i = 0; i < n; i++) rects[i] = zero;
  const result: ExTreemapResult<T> = { rects, aggregates: [] };
  if (n === 0 || rect.w <= 0 || rect.h <= 0) return result;

  const weights = items.map(opts.weightOf);
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);

  // 全部无预算记录（尚未搜索/迭代）：等分网格兜底
  if (total <= 0) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    const cw = rect.w / cols;
    const ch = rect.h / rows;
    for (let i = 0; i < n; i++) {
      rects[i] = {
        x: rect.x + (i % cols) * cw,
        y: rect.y + Math.floor(i / cols) * ch,
        w: cw,
        h: ch,
      };
    }
    return result;
  }

  // 像素面积阈值 → 预算阈值（merge.py: thr_of = threshold * total / containerArea）
  const containerArea = (rect.w + gap) * (rect.h + gap);
  const thr = (minElement * minElement * total) / containerArea;

  // 「小项 ×N」：低于阈值的叶子（无子节点、不可下钻）合并
  const isLeaf = opts.isLeaf ?? (() => true);
  const below = items.map((_, i) => weights[i] < thr);
  let smallAgg: ExAggregate<T> | null = null;
  let restIds: number[] = [];
  const smallIds: number[] = [];
  const aboveIds: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!below[i]) aboveIds.push(i);
    else if (isLeaf(items[i])) smallIds.push(i);
    else restIds.push(i);
  }
  if (smallIds.length >= 2) {
    smallAgg = {
      kind: 'small',
      count: smallIds.length,
      weight: smallIds.reduce((s, i) => s + weights[i], 0),
      members: smallIds.map((i) => items[i]),
      rect: zero,
    };
  } else {
    restIds.push(...smallIds);
  }

  // 「＋N 项」：聚合后仍低于阈值的项（含 SMALL 块自身）合并，放在该层最后
  let moreAgg: ExAggregate<T> | null = null;
  const tinyIds = restIds.filter((i) => below[i]);
  const normalIds = restIds.filter((i) => !below[i]).concat(aboveIds);
  const smallWeight = smallAgg?.weight ?? 0;
  const smallMembers = smallAgg?.members ?? [];
  const smallTooTiny = smallAgg !== null && smallWeight < thr;
  const nTiny = tinyIds.length + (smallTooTiny ? 1 : 0);
  if (nTiny >= 2) {
    moreAgg = {
      kind: 'more',
      count: nTiny,
      weight: tinyIds.reduce((s, i) => s + weights[i], 0) + (smallTooTiny ? smallWeight : 0),
      members: tinyIds.map((i) => items[i]).concat(smallTooTiny ? smallMembers : []),
      rect: zero,
    };
    if (smallTooTiny) smallAgg = null;
  } else {
    normalIds.push(...tinyIds);
  }

  // 布局顺序：常规项按权重降序（squarify 需要），SMALL 按权重插入，MORE 殿后
  normalIds.sort((a, b) => weights[b] - weights[a]);
  const entries: { idx?: number; agg?: ExAggregate<T>; weight: number }[] = normalIds.map((i) => ({
    idx: i,
    weight: weights[i],
  }));
  if (smallAgg) entries.push({ agg: smallAgg, weight: smallAgg.weight });
  entries.sort((a, b) => b.weight - a.weight);
  if (moreAgg) entries.push({ agg: moreAgg, weight: moreAgg.weight });

  // 每块自带右/下 gap：容器向右下扩展一个 gap（engine.py: _Run.container）
  const cells = squarifyCore(
    entries.map((e) => e.weight),
    rect.x,
    rect.y,
    rect.x + rect.w + gap,
    rect.y + rect.h + gap,
  );
  entries.forEach((e, k) => {
    const c = snapRect(cells[k]);
    if (e.idx !== undefined) rects[e.idx] = c;
    else e.agg!.rect = c;
  });
  if (smallAgg) result.aggregates.push(smallAgg);
  if (moreAgg) result.aggregates.push(moreAgg);
  return result;
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
