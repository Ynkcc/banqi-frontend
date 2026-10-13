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

/** 显示方案：tree = 原 SVG 树，lines = 主变例列表（方案 G） */
export type MctsViewMode = 'tree' | 'lines';

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
}

const store = reactive<MctsStore>({
  rootInfo: null,
  viewMode: 'tree',
  expanded: new Set(),
  showAll: false,
  searching: false,
  selectedId: null,
  selectedBoard: null,
  selectedDetail: null,
  inspectorLoading: false,
});

/** 变例列表视图：每个分叉点的手动分支选择（parentId -> childId） */
const branchChoice = reactive(new Map<number, number>());
/** childrenCache 为非响应式 Map，用计数器驱动依赖它的 computed 重算 */
const pvNonce = reactive({ value: 0 });
function bumpPv() {
  pvNonce.value += 1;
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
    resetView();
    await ensureChildren(info.root.id);
  } catch (e) {
    store.rootInfo = null;
    toast.info(String(e));
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
    hasChildren(id: number) {
      return store.expanded.has(id) || (childrenCache.get(id)?.length ?? 0) > 0;
    },
  };
}
