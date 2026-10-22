import { reactive } from 'vue';
import { api } from '../api/client';
import type { ExEdge, ExNodeBoard, ExNodeSummary, ExRootInfo } from '../api/types';
import { useToast } from './useToast';
import { appendLog } from './useLogs';

const toast = useToast();

export const EX_MAX_CHILDREN = 12;

export interface ExLayoutNode {
  id: number;
  depth: number;
  edge: ExEdge | null;
  /** 子边值（父视角） */
  value: number;
  flag: string;
  mark: string | null;
  isChance: boolean;
  isOutcome: boolean;
  chanceProb: number;
  children: ExLayoutNode[];
  hiddenCount: number;
  x: number;
  y: number;
}

interface ExStore {
  rootInfo: ExRootInfo | null;
  expanded: Set<number>;
  showAll: boolean;
  searching: boolean;
  selectedId: number | null;
  selectedBoard: ExNodeBoard | null;
  selectedDetail: ExNodeSummary | null;
  inspectorLoading: boolean;
}

const store = reactive<ExStore>({
  rootInfo: null,
  expanded: new Set(),
  showAll: false,
  searching: false,
  selectedId: null,
  selectedBoard: null,
  selectedDetail: null,
  inspectorLoading: false,
});

const childrenCache = new Map<number, ExEdge[]>();
const summaries = new Map<number, { value: number; flag: string; mark: string | null }>();
const boardCache = new Map<number, ExNodeBoard>();
const detailCache = new Map<number, ExNodeSummary>();

export const treeTransform = reactive({ scale: 1, tx: 0, ty: 0 });

function resetView() {
  treeTransform.scale = 1;
  treeTransform.tx = 0;
  treeTransform.ty = 0;
}

async function ensureChildren(nodeId: number): Promise<ExEdge[]> {
  const cached = childrenCache.get(nodeId);
  if (cached) return cached;
  const edges = await api.nnueGetChildren(nodeId);
  childrenCache.set(nodeId, edges);
  for (const e of edges) {
    if (!summaries.has(e.child_id)) {
      summaries.set(e.child_id, { value: -e.value, flag: e.flag, mark: e.mark });
    }
  }
  return edges;
}

async function refresh(): Promise<void> {
  try {
    const info = await api.nnueGetRoot();
    store.rootInfo = info;
    store.expanded = new Set([info.root.id]);
    childrenCache.clear();
    summaries.clear();
    summaries.set(info.root.id, {
      value: info.root.value,
      flag: info.root.flag,
      mark: info.root.mark,
    });
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
  } catch (e) {
    console.error('nnue node inspector failed:', e);
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

async function toggle(nodeId: number) {
  if (store.expanded.has(nodeId)) {
    store.expanded.delete(nodeId);
  } else {
    try {
      await ensureChildren(nodeId);
      store.expanded.add(nodeId);
    } catch (e) {
      console.error('nnue_get_children failed:', e);
    }
  }
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

/**
 * 主变例（PV）：从根沿「精确值最优」的子边追踪——决策节点取 flag=exact 且
 * value 最大的子（无 exact 时取 value 最大）；机会节点取概率最大的 outcome。
 * 仅覆盖已加载（缓存）的边。
 */
function pvNodeIds(root: ExLayoutNode): Set<number> {
  const pv = new Set<number>();
  let node: ExLayoutNode | undefined = root;
  while (node) {
    pv.add(node.id);
    if (node.children.length === 0) break;
    const exact: ExLayoutNode[] = node.children.filter((c) => c.flag === 'exact' && !c.isOutcome);
    const pool: ExLayoutNode[] = exact.length > 0 ? exact : node.children;
    node = pool.reduce((best: ExLayoutNode, c: ExLayoutNode) => (c.value > best.value ? c : best));
  }
  return pv;
}

function buildLayout(): ExLayoutNode | null {
  const info = store.rootInfo;
  if (!info) return null;

  function build(id: number, depth: number, edge: ExEdge | null): ExLayoutNode {
    const summary = summaries.get(id) ?? { value: 0, flag: 'unknown', mark: null };
    const node: ExLayoutNode = {
      id,
      depth,
      edge,
      value: summary.value,
      flag: summary.flag,
      mark: summary.mark,
      isChance: edge?.is_chance ?? false,
      isOutcome: edge?.is_outcome ?? false,
      chanceProb: edge?.chance_prob ?? 1,
      children: [],
      hiddenCount: 0,
      x: 0,
      y: depth,
    };
    if (store.expanded.has(id)) {
      const edges = childrenCache.get(id) ?? [];
      const shown = store.showAll ? edges : edges.slice(0, EX_MAX_CHILDREN);
      node.hiddenCount = edges.length - shown.length;
      node.children = shown.map((e) => build(e.child_id, depth + 1, e));
    }
    return node;
  }

  const leafCounter = { value: 0 };
  function assign(node: ExLayoutNode): ExLayoutNode {
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

function collectNodes(root: ExLayoutNode): ExLayoutNode[] {
  const out: ExLayoutNode[] = [];
  (function walk(n: ExLayoutNode) {
    out.push(n);
    n.children.forEach(walk);
  })(root);
  return out;
}

export function useExpectimaxTree() {
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
    hasChildren(id: number) {
      return store.expanded.has(id) || (childrenCache.get(id)?.length ?? 0) > 0;
    },
  };
}
