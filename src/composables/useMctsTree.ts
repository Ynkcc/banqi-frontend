import { computed, reactive } from 'vue';
import { api } from '../api/client';
import type { MctsEdge, MctsNodeBoard, MctsNodeDetail, MctsRootInfo } from '../api/types';
import { useToast } from './useToast';
import { appendLog } from './useLogs';

const toast = useToast();

export const MCTS_MAX_CHILDREN = 12;

export interface MctsLayoutNode {
  id: number;
  depth: number;
  edge: MctsEdge | null;
  n: number;
  q: number;
  children: MctsLayoutNode[];
  hiddenCount: number;
  x: number;
  y: number;
}

/** 显示方案：tiles = Expectimax 风格瓦片图（默认），tree = SVG 树，lines = 主变例列表 */
export type MctsViewMode = 'tiles' | 'tree' | 'lines';

/** 焦点节点下子瓦片的排序方式 */
export type MctsSortMode =
  | 'server'
  | 'n-desc'
  | 'n-asc'
  | 'q-desc'
  | 'q-asc'
  | 'action-asc'
  | 'prior-desc';

export const MCTS_SORT_OPTIONS: { value: MctsSortMode; label: string }[] = [
  { value: 'server', label: '服务器顺序' },
  { value: 'n-desc', label: '访问数 ↓' },
  { value: 'n-asc', label: '访问数 ↑' },
  { value: 'q-desc', label: '价值 ↓' },
  { value: 'q-asc', label: '价值 ↑' },
  { value: 'action-asc', label: '着法 # ↑' },
  { value: 'prior-desc', label: '先验 ↓' },
];

/** expectimax 风格瓦片：焦点节点的直接子节点 */
export interface MctsTile {
  id: number;
  edge: MctsEdge;
  n: number;
  q: number;
  prior: number;
  childCount: number;
}

/** 变例列表视图的一步：parent 节点 + 选中的边 + 其余备选 */
export interface PvStep {
  parentId: number;
  parentN: number;
  parentQ: number;
  chosen: MctsEdge;
  alternatives: MctsEdge[];
  isOverride: boolean;
}

interface MctsStore {
  rootInfo: MctsRootInfo | null;
  viewMode: MctsViewMode;
  expanded: Set<number>;
  showAll: boolean;
  searching: boolean;
  selectedId: number | null;
  selectedBoard: MctsNodeBoard | null;
  selectedDetail: MctsNodeDetail | null;
  inspectorLoading: boolean;
  /** 瓦片图焦点节点 id */
  focusId: number;
  /** 从根到当前焦点的边路径（面包屑） */
  focusTrail: MctsEdge[];
  /** 无选中项时检视器兜底展示的焦点局面 */
  focusBoard: MctsNodeBoard | null;
  focusBoardLoading: boolean;
  sortMode: MctsSortMode;
}

const store = reactive<MctsStore>({
  rootInfo: null,
  viewMode: 'tiles',
  expanded: new Set(),
  showAll: false,
  searching: false,
  selectedId: null,
  selectedBoard: null,
  selectedDetail: null,
  inspectorLoading: false,
  focusId: 0,
  focusTrail: [],
  focusBoard: null,
  focusBoardLoading: false,
  sortMode: 'server',
});

/** 变例列表视图：每个分叉点的手动分支选择（parentId -> childId） */
const branchChoice = reactive(new Map<number, number>());
/** childrenCache 为非响应式 Map，用计数器驱动依赖它的 computed 重算 */
const pvNonce = reactive({ value: 0 });
function bumpPv() {
  pvNonce.value += 1;
}
const childNonce = reactive({ value: 0 });
function bumpChildren() {
  childNonce.value += 1;
}

const childrenCache = new Map<number, MctsEdge[]>();
const summaries = new Map<number, { n: number; q: number }>();
const boardCache = new Map<number, MctsNodeBoard>();
const detailCache = new Map<number, MctsNodeDetail>();

export const treeTransform = reactive({ scale: 1, tx: 0, ty: 0 });

function edgeSummary(edge: MctsEdge): { n: number; q: number } {
  return { n: edge.n, q: edge.q };
}

async function ensureChildren(nodeId: number): Promise<MctsEdge[]> {
  const cached = childrenCache.get(nodeId);
  if (cached) return cached;
  const edges = await api.mctsGetChildren(nodeId);
  childrenCache.set(nodeId, edges);
  bumpChildren();
  for (const e of edges) {
    if (!summaries.has(e.child_id)) summaries.set(e.child_id, edgeSummary(e));
  }
  return edges;
}

function resetView() {
  treeTransform.scale = 1;
  treeTransform.tx = 0;
  treeTransform.ty = 0;
}

async function refresh(): Promise<void> {
  try {
    const info = await api.mctsGetRoot();
    store.rootInfo = info;
    store.expanded = new Set([info.root.id]);
    childrenCache.clear();
    branchChoice.clear();
    bumpPv();
    summaries.clear();
    summaries.set(info.root.id, { n: info.root.n, q: info.root.q });
    // 树重建后节点 id 全部失效，需清空局面/详情缓存与选中态
    boardCache.clear();
    detailCache.clear();
    store.selectedId = null;
    store.selectedBoard = null;
    store.selectedDetail = null;
    store.inspectorLoading = false;
    store.focusTrail = [];
    store.focusId = info.root.id;
    store.focusBoard = null;
    store.focusBoardLoading = false;
    resetView();
    await ensureChildren(info.root.id);
    void ensureFocusBoard();
  } catch (e) {
    store.rootInfo = null;
    // 对局中尚无 MCTS 树属正常空态，静默处理
    if ((e as { code?: string } | null)?.code !== 'MCTS_TREE_MISSING') {
      toast.info(String(e));
    }
  }
}

/** 选中某个节点并在右侧检视区展示其局面与统计。 */
async function select(nodeId: number): Promise<void> {
  store.selectedId = nodeId;
  store.selectedBoard = boardCache.get(nodeId) ?? null;
  store.selectedDetail = detailCache.get(nodeId) ?? null;
  store.inspectorLoading = true;
  try {
    const [board, detail] = await Promise.all([
      boardCache.get(nodeId) ?? api.mctsGetNodeBoard(nodeId),
      fetchDetail(nodeId),
    ]);
    boardCache.set(nodeId, board);
    if (store.selectedId !== nodeId) return;
    store.selectedBoard = board;
    store.selectedDetail = detail;
  } catch (e) {
    console.error('mcts node inspector failed:', e);
    if (store.selectedId === nodeId) {
      store.selectedBoard = null;
      store.selectedDetail = null;
    }
  } finally {
    if (store.selectedId === nodeId) store.inspectorLoading = false;
  }
}

function clearSelection() {
  store.selectedId = null;
  store.selectedBoard = null;
  store.selectedDetail = null;
  store.inspectorLoading = false;
}

/** 从根沿访问次数最大的子节点走到叶：主变例路径（仅覆盖已加载的边）。 */
function pvNodeIds(root: MctsLayoutNode): Set<number> {
  const pv = new Set<number>();
  let node: MctsLayoutNode | undefined = root;
  while (node) {
    pv.add(node.id);
    if (node.children.length === 0) break;
    node = node.children.reduce((best, c) => (c.n > best.n ? c : best));
  }
  return pv;
}

async function toggle(nodeId: number) {
  if (store.expanded.has(nodeId)) {
    store.expanded.delete(nodeId);
  } else {
    try {
      await ensureChildren(nodeId);
      store.expanded.add(nodeId);
    } catch (e) {
      console.error('mcts_get_children failed:', e);
    }
  }
}

async function search() {
  store.searching = true;
  try {
    const info = await api.mctsSearch();
    const s = info.stats;
    appendLog(
      `MCTS 手动搜索: ${s.reused ? '复用搜索树' : '全新建树'}，` +
        `实际模拟 ${s.actual_sims}/${s.budget} 次，` +
        `树深度 ${s.max_depth}，节点 ${s.nodes}`,
    );
    await refresh();
  } catch (e) {
    toast.error('MCTS 搜索失败：' + e);
  } finally {
    store.searching = false;
  }
}

async function fetchDetail(nodeId: number): Promise<MctsNodeDetail | null> {
  const cached = detailCache.get(nodeId);
  if (cached) return cached;
  try {
    const detail = await api.mctsGetNodeDetail(nodeId);
    detailCache.set(nodeId, detail);
    return detail;
  } catch {
    return null;
  }
}

function buildLayout(): MctsLayoutNode | null {
  const info = store.rootInfo;
  if (!info) return null;

  function build(id: number, depth: number, edge: MctsEdge | null): MctsLayoutNode {
    const summary = summaries.get(id) ?? { n: 0, q: 0 };
    const node: MctsLayoutNode = { id, depth, edge, n: summary.n, q: summary.q, children: [], hiddenCount: 0, x: 0, y: depth };
    if (store.expanded.has(id)) {
      const edges = childrenCache.get(id) ?? [];
      const shown = store.showAll ? edges : edges.slice(0, MCTS_MAX_CHILDREN);
      node.hiddenCount = edges.length - shown.length;
      node.children = shown.map((e) => build(e.child_id, depth + 1, e));
    }
    return node;
  }

  const leafCounter = { value: 0 };
  function assign(node: MctsLayoutNode): MctsLayoutNode {
    if (node.children.length === 0) {
      node.x = (leafCounter.value += 1) - 0.5;
    } else {
      node.children.forEach(assign);
      node.x = (node.children[0].x + node.children[node.children.length - 1].x) / 2;
    }
    return node;
  }

  return assign(build(info.root.id, 0, null));
}

function collectNodes(root: MctsLayoutNode): MctsLayoutNode[] {
  const out: MctsLayoutNode[] = [];
  (function walk(n: MctsLayoutNode) {
    out.push(n);
    n.children.forEach(walk);
  })(root);
  return out;
}

/* ===================== 变例列表视图（方案 G）===================== */

/** 沿已缓存子节点走出当前主变例（含手动分支选择），不发起网络请求。 */
function pvSteps(): PvStep[] {
  void pvNonce.value; // 注册依赖：childrenCache 更新后重算
  const info = store.rootInfo;
  if (!info) return [];
  const steps: PvStep[] = [];
  let id = info.root.id;
  for (let guard = 0; guard < 128; guard += 1) {
    const edges = childrenCache.get(id);
    if (!edges || edges.length === 0) break;
    const overrideId = branchChoice.get(id);
    const chosen =
      (overrideId !== undefined ? edges.find((e) => e.child_id === overrideId) : undefined) ??
      edges.reduce((best, e) => (e.n > best.n ? e : best));
    const alternatives = edges
      .filter((e) => e.child_id !== chosen.child_id)
      .sort((a, b) => b.n - a.n);
    const parentSummary = summaries.get(id) ?? { n: 0, q: 0 };
    steps.push({
      parentId: id,
      parentN: parentSummary.n,
      parentQ: parentSummary.q,
      chosen,
      alternatives,
      isOverride: overrideId !== undefined && edges.some((e) => e.child_id === overrideId),
    });
    id = chosen.child_id;
  }
  return steps;
}

const pvStepsComputed = computed(() => pvSteps());

/** 在某个分叉点切换分支（点击备选着法时调用）。 */
function setBranch(parentId: number, childId: number) {
  branchChoice.set(parentId, childId);
  void select(childId);
}

/** 清除所有手动分支选择，回到访问次数最大的主变例。 */
function resetBranch() {
  branchChoice.clear();
}

/** 沿当前主变例逐层懒加载子节点，直到叶子或无可加载分支。 */
async function extendPv(): Promise<void> {
  const info = store.rootInfo;
  if (!info) return;
  for (let round = 0; round < 128; round += 1) {
    let id = info.root.id;
    // 先沿缓存路径走到底
    for (let guard = 0; guard < 128; guard += 1) {
      const edges = childrenCache.get(id);
      if (!edges || edges.length === 0) break;
      const overrideId = branchChoice.get(id);
      const chosen =
        (overrideId !== undefined ? edges.find((e) => e.child_id === overrideId) : undefined) ??
        edges.reduce((best, e) => (e.n > best.n ? e : best));
      id = chosen.child_id;
    }
    await ensureChildren(id);
    const loaded = childrenCache.get(id);
    bumpPv();
    if (!loaded || loaded.length === 0) return; // 叶子/终局
  }
}

/* ===================== expectimax 风格瓦片视图 ===================== */

function sortEdges(edges: MctsEdge[]): MctsEdge[] {
  const arr = [...edges];
  switch (store.sortMode) {
    case 'n-desc':
      arr.sort((a, b) => b.n - a.n);
      break;
    case 'n-asc':
      arr.sort((a, b) => a.n - b.n);
      break;
    case 'q-desc':
      arr.sort((a, b) => b.q - a.q);
      break;
    case 'q-asc':
      arr.sort((a, b) => a.q - b.q);
      break;
    case 'action-asc':
      arr.sort((a, b) => a.action - b.action);
      break;
    case 'prior-desc':
      arr.sort((a, b) => b.prior - a.prior);
      break;
  }
  return arr;
}

/** 焦点节点的子瓦片（等分网格展示；childCount < 0 表示子节点尚未加载） */
function focusChildren(): MctsTile[] {
  void childNonce.value;
  return sortEdges(childrenCache.get(store.focusId) ?? []).map((e) => ({
    id: e.child_id,
    edge: e,
    n: e.n,
    q: e.q,
    prior: e.prior,
    childCount: childrenCache.get(e.child_id)?.length ?? -1,
  }));
}

/** 焦点节点子树访问数 */
function focusN(): number {
  void childNonce.value;
  if (store.focusTrail.length === 0) return store.rootInfo?.root.n ?? 0;
  return store.focusTrail[store.focusTrail.length - 1].n;
}

/** 焦点节点自身访问数 = 子树访问数 − 各子瓦片访问数和 */
function ownN(): number {
  const sum = focusChildren().reduce((s, t) => s + t.n, 0);
  return Math.max(0, focusN() - sum);
}

async function ensureFocusBoard(): Promise<void> {
  if (!store.rootInfo || store.focusBoard || store.focusBoardLoading) return;
  const fid = store.focusId;
  store.focusBoardLoading = true;
  try {
    const board = boardCache.get(fid) ?? (await api.mctsGetNodeBoard(fid));
    boardCache.set(fid, board);
    if (store.focusId === fid) store.focusBoard = board;
  } catch (e) {
    console.error('mcts focus board failed:', e);
  } finally {
    store.focusBoardLoading = false;
  }
}

function syncFocusBoard(): void {
  store.focusBoard = boardCache.get(store.focusId) ?? null;
  void ensureFocusBoard();
}

/** 双击瓦片：先加载其子节点，再下钻为焦点 */
async function descend(edge: MctsEdge): Promise<void> {
  if ((childrenCache.get(edge.child_id)?.length ?? 0) === 0) {
    try {
      await ensureChildren(edge.child_id);
    } catch (e) {
      console.error('mcts_get_children failed:', e);
    }
  }
  store.focusTrail.push(edge);
  store.focusId = edge.child_id;
  syncFocusBoard();
}

/** 面包屑跳转：depth 0 = 根 */
function ascendTo(depth: number): void {
  if (depth < 0 || depth > store.focusTrail.length) return;
  store.focusTrail.splice(depth);
  store.focusId = depth === 0 ? (store.rootInfo?.root.id ?? 0) : store.focusTrail[depth - 1].child_id;
  syncFocusBoard();
}

function toggleSelect(nodeId: number): void {
  if (store.selectedId === nodeId) clearSelection();
  else void select(nodeId);
}

/** 瓦片视图主变例：从根沿访问数最大的子节点（尊重变例列表的手动分支选择） */
function pvTileIds(): Set<number> {
  void childNonce.value;
  void pvNonce.value;
  const info = store.rootInfo;
  const pv = new Set<number>();
  if (!info) return pv;
  let id: number | undefined = info.root.id;
  for (let guard = 0; id !== undefined && guard < 128; guard += 1) {
    pv.add(id);
    const edges = childrenCache.get(id);
    if (!edges || edges.length === 0) break;
    const overrideId = branchChoice.get(id);
    const chosen =
      (overrideId !== undefined ? edges.find((e) => e.child_id === overrideId) : undefined) ??
      edges.reduce((best, e) => (e.n > best.n ? e : best));
    id = chosen.child_id;
  }
  return pv;
}

export function useMctsTree() {
  return {
    store,
    treeTransform,
    refresh,
    toggle,
    search,
    fetchDetail,
    select,
    clearSelection,
    pvNodeIds,
    buildLayout,
    collectNodes,
    // 变例列表视图（方案 G）
    pvSteps: pvStepsComputed,
    setBranch,
    resetBranch,
    extendPv,
    hasBranchOverride: () => branchChoice.size > 0,
    // expectimax 风格瓦片视图
    focusChildren,
    focusN,
    ownN,
    ensureFocusBoard,
    descend,
    ascendTo,
    toggleSelect,
    pvTileIds,
    hasChildren(id: number) {
      return store.expanded.has(id) || (childrenCache.get(id)?.length ?? 0) > 0;
    },
  };
}
