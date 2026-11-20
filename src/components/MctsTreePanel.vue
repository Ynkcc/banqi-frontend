<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from 'vue';
import type { MctsEdge } from '../api/types';
import type { MctsTile } from '../composables/useMctsTree';
import { MCTS_MAX_CHILDREN, MCTS_SORT_OPTIONS, useMctsTree } from '../composables/useMctsTree';
import { useGame } from '../composables/useGame';
import BoardGrid from './BoardGrid.vue';
import MctsLinesPanel from './MctsLinesPanel.vue';

const emit = defineEmits<{ close: [] }>();

const {
  store,
  treeTransform,
  refresh,
  toggle,
  search,
  select,
  clearSelection,
  pvNodeIds,
  buildLayout,
  collectNodes,
  hasChildren,
  focusChildren,
  focusN,
  ownN,
  ensureFocusBoard,
  descend,
  ascendTo,
  toggleSelect,
  pvTileIds,
} = useMctsTree();
const { store: game } = useGame();

// mcts-viz 风格：矩形节点 + 正交折线连线（树形图视图）
const NW = 116;
const NH = 64;
const DX = 138;
const DY = 128;
const PAD = 70;

const wrapEl = ref<HTMLElement | null>(null);

const layout = computed(() => buildLayout());
const nodes = computed(() => (layout.value ? collectNodes(layout.value) : []));
const pvSet = computed(() => (layout.value ? pvNodeIds(layout.value) : new Set<number>()));

const svgViewBox = computed(() => {
  const leafCount = Math.max(1, nodes.value.filter((n) => n.children.length === 0).length);
  const maxDepth = Math.max(0, ...nodes.value.map((n) => n.depth));
  return { width: leafCount * DX + PAD * 2, height: (maxDepth + 1) * DY + PAD * 2 };
});

const rootInfo = computed(() => store.rootInfo);

const px = (n: { x: number }) => PAD + n.x * DX;
const py = (n: { y: number }) => PAD + n.y * DY;

function nodeTitle(n: { id: number; edge: { is_chance: boolean; chance_prob: number; action: number } | null }): string {
  if (rootInfo.value && n.id === rootInfo.value.root.id) return 'ROOT';
  if (!n.edge) return '';
  return n.edge.is_chance ? `翻 ${(n.edge.chance_prob * 100).toFixed(0)}%` : `着法 #${n.edge.action}`;
}

function edgePath(n: { x: number; y: number }, c: { x: number; y: number }): string {
  const y1 = py(n) + NH / 2;
  const y2 = py(c) - NH / 2;
  const mid = (y1 + y2) / 2;
  return `M ${px(n)} ${y1} L ${px(n)} ${mid} L ${px(c)} ${mid} L ${px(c)} ${y2}`;
}

function edgeMidY(n: { y: number }, c: { y: number }): number {
  return (py(n) + NH / 2 + (py(c) - NH / 2)) / 2;
}

function isChosenEdge(n: { edge: { is_chance: boolean; action: number } | null }): boolean {
  const info = store.rootInfo;
  return !!info && !!n.edge && !n.edge.is_chance && n.edge.action === info.chosen_action;
}

function isPvEdge(n: { id: number }, c: { id: number }): boolean {
  return pvSet.value.has(n.id) && pvSet.value.has(c.id);
}

function edgeWidth(n: { edge: { prior: number; is_chance: boolean } | null }): number {
  if (!n.edge || n.edge.is_chance) return 1.5;
  return Math.max(1.5, Math.min(7, (n.edge?.prior ?? 0) * 40));
}

function pathStroke(n: { id: number }, c: { id: number; edge: MctsEdge | null }): string {
  if (isChosenEdge(c)) return '#d32f2f';
  if (isPvEdge(n, c)) return '#0d6efd';
  return c.edge?.is_chance ? '#c9a24b' : '#9a8f7f';
}

function pathWidth(n: { id: number }, c: { id: number; edge: MctsEdge | null }): number {
  if (isChosenEdge(c)) return 4.5;
  if (isPvEdge(n, c)) return Math.max(3, edgeWidth(c) + 1.5);
  return edgeWidth(c);
}

const valueClass = (v: number) => (v > 0 ? 'val-pos' : v < 0 ? 'val-neg' : undefined);

function nodeClass(n: { id: number; edge: MctsEdge | null }): Record<string, boolean> {
  return {
    'is-chosen': isChosenEdge(n),
    'is-pv': pvSet.value.has(n.id),
    'is-selected': store.selectedId === n.id,
  };
}

async function onNodeClick(nodeId: number) {
  void select(nodeId);
  await toggle(nodeId);
}

const moveLabel = computed(() => {
  const coords = store.selectedBoard?.move_coords ?? [];
  if (coords.length === 0) return '初始局面（无前着）';
  if (coords.length === 1) return `翻开 #${coords[0]}`;
  return `#${coords[0]} → #${coords[1]}`;
});

function onWheel(evt: WheelEvent) {
  evt.preventDefault();
  const factor = evt.deltaY < 0 ? 1.15 : 1 / 1.15;
  const rect = wrapEl.value?.getBoundingClientRect();
  if (!rect) return;
  const cx = evt.clientX - rect.left;
  const cy = evt.clientY - rect.top;
  treeTransform.tx = cx - (cx - treeTransform.tx) * factor;
  treeTransform.ty = cy - (cy - treeTransform.ty) * factor;
  treeTransform.scale = Math.max(0.2, Math.min(4, treeTransform.scale * factor));
}

let dragging = false;
let lastX = 0;
let lastY = 0;

function onDragStart(evt: MouseEvent) {
  if ((evt.target as HTMLElement).closest('g')) return;
  dragging = true;
  lastX = evt.clientX;
  lastY = evt.clientY;
}
function onDragMove(evt: MouseEvent) {
  if (!dragging) return;
  treeTransform.tx += evt.clientX - lastX;
  treeTransform.ty += evt.clientY - lastY;
  lastX = evt.clientX;
  lastY = evt.clientY;
}
function onDragEnd() {
  dragging = false;
}

function transformAttr(): string {
  return `translate(${treeTransform.tx}, ${treeTransform.ty}) scale(${treeTransform.scale})`;
}

// ---------------------------------------------------------------------------
// expectimax 风格瓦片图：等分网格 + 面包屑下钻 + 节点检视
// ---------------------------------------------------------------------------
const mapEl = ref<HTMLElement | null>(null);
const mapSize = reactive({ w: 0, h: 0 });
let ro: ResizeObserver | null = null;

watchEffect(() => {
  const el = mapEl.value;
  if (!el) return;
  if (!ro) {
    ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        mapSize.w = rect.width;
        mapSize.h = rect.height;
      }
    });
  }
  ro.observe(el);
});
onBeforeUnmount(() => ro?.disconnect());

interface RenderTile {
  tile: MctsTile;
  rect: { x: number; y: number; w: number; h: number };
  share: number;
  showValue: boolean;
  showBudget: boolean;
}

const rendered = computed<RenderTile[]>(() => {
  const info = store.rootInfo;
  if (!info || mapSize.w < 24 || mapSize.h < 24) return [];
  const tiles = focusChildren();
  const total = focusN();
  const n = tiles.length;
  if (n === 0) return [];

  // 与 Expectimax 面板一致：等分网格，格子大小不按访问数占比
  const aspect = mapSize.w / mapSize.h;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * aspect)));
  const rows = Math.ceil(n / cols);
  const cw = mapSize.w / cols;
  const ch = mapSize.h / rows;

  return tiles.map((tile, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      tile,
      rect: { x: col * cw + 1, y: row * ch + 1, w: cw - 2, h: ch - 2 },
      share: total > 0 ? (tile.n / total) * 100 : 0,
      showValue: ch > 36 && cw > 64,
      showBudget: ch > 54 && cw > 88,
    };
  });
});

const tilePvSet = computed(() => (store.rootInfo ? pvTileIds() : new Set<number>()));
const stats = computed(() => rootInfo.value?.stats ?? null);
const rootVisits = computed(() => rootInfo.value?.root.n ?? 0);

function fmtNodes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(Math.round(n));
}

function edgeLabel(e: MctsEdge): string {
  return e.is_chance ? `翻 ${(e.chance_prob * 100).toFixed(0)}%` : `着法 #${e.action}`;
}

const breadcrumb = computed(() => [
  { depth: 0, label: '根' },
  ...store.focusTrail.map((e, i) => ({ depth: i + 1, label: edgeLabel(e) })),
]);

function isChosen(r: RenderTile): boolean {
  const info = store.rootInfo;
  return !!info && !r.tile.edge.is_chance && r.tile.edge.action === info.chosen_action;
}

function tileBg(r: RenderTile): string {
  const v = Math.max(-1, Math.min(1, r.tile.q));
  const a = 0.1 + 0.28 * Math.abs(v);
  return v >= 0 ? `rgba(58, 145, 92, ${a})` : `rgba(172, 74, 60, ${a})`;
}

function tileStyle(r: RenderTile): Record<string, string> {
  return {
    left: `${r.rect.x}px`,
    top: `${r.rect.y}px`,
    width: `${Math.max(0, r.rect.w)}px`,
    height: `${Math.max(0, r.rect.h)}px`,
    background: tileBg(r),
  };
}

function tileClass(r: RenderTile): Record<string, boolean> {
  return {
    'ex-tile': true,
    'is-chosen': isChosen(r),
    'is-pv': tilePvSet.value.has(r.tile.id),
    'is-selected': store.selectedId === r.tile.id,
    'is-chance': r.tile.edge.is_chance,
    'is-drillable': r.tile.childCount !== 0,
  };
}

function tileTooltip(r: RenderTile): string {
  return `节点 #${r.tile.id} · N=${r.tile.n}（占焦点 ${r.share.toFixed(1)}%）· Q=${r.tile.q.toFixed(3)} · P=${r.tile.prior.toFixed(3)}`;
}

function onTileClick(r: RenderTile) {
  toggleSelect(r.tile.id);
}

function onTileDblClick(r: RenderTile) {
  void descend(r.tile.edge);
  void select(r.tile.id);
}

// 棋盘更新后刷新搜索树；无树时静默保持空态
watch(
  () => game.state,
  () => {
    void refresh();
  },
);
onMounted(() => {
  void refresh();
});

// 无选中项时懒加载焦点节点棋盘（根时即行动前局面）
watchEffect(() => {
  if (store.rootInfo && !store.selectedId && !store.focusBoard) void ensureFocusBoard();
});

/** 检视器展示的棋盘：优先选中节点，否则展示当前焦点节点 */
const inspectorBoard = computed(() => store.selectedBoard ?? store.focusBoard);

const focusQ = computed(() =>
  store.focusTrail.length === 0
    ? (rootInfo.value?.root.q ?? 0)
    : store.focusTrail[store.focusTrail.length - 1].q,
);

const boardCaption = computed(() => {
  if (!store.selectedId) {
    return store.focusTrail.length === 0 ? '行动前局面' : `焦点节点 #${store.focusId} 局面`;
  }
  return `到达着法 · ${moveLabel.value}`;
});
</script>

<template>
  <aside class="sidebar mcts-sidebar">
    <header class="sidebar-header">
      <h3>MCTS 搜索树</h3>
      <button class="icon-button" aria-label="关闭" @click="emit('close')">×</button>
    </header>
    <div class="mcts-toolbar">
      <div class="mcts-view-switch" role="tablist">
        <button
          role="tab"
          :aria-selected="store.viewMode === 'tiles'"
          :class="{ active: store.viewMode === 'tiles' }"
          @click="store.viewMode = 'tiles'"
        >
          瓦片图
        </button>
        <button
          role="tab"
          :aria-selected="store.viewMode === 'tree'"
          :class="{ active: store.viewMode === 'tree' }"
          @click="store.viewMode = 'tree'"
        >
          树形图
        </button>
        <button
          role="tab"
          :aria-selected="store.viewMode === 'lines'"
          :class="{ active: store.viewMode === 'lines' }"
          @click="store.viewMode = 'lines'"
        >
          变例列表
        </button>
      </div>
      <button :disabled="store.searching" @click="search">
        {{ store.searching ? '搜索中…' : '重新搜索' }}
      </button>
      <button @click="refresh">刷新</button>
      <select v-if="store.viewMode === 'tiles'" v-model="store.sortMode" class="ex-sort" title="子节点排序方式">
        <option v-for="opt in MCTS_SORT_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <label v-if="store.viewMode === 'tree'">
        <input v-model="store.showAll" type="checkbox" /> 显示全部子节点
      </label>
      <span v-if="rootInfo" class="mcts-info">根 N={{ rootInfo.root.n }}
        <span :class="valueClass(rootInfo.root.q)">Q={{ rootInfo.root.q.toFixed(3) }}</span>
        选择动作 #{{ rootInfo.chosen_action }}
        <template v-if="stats"> · {{ stats.actual_sims }} 次模拟 / {{ stats.elapsed_ms }}ms</template>
      </span>
    </div>

    <nav v-if="store.viewMode === 'tiles' && rootInfo" class="ex-crumbs" aria-label="节点路径">
      <template v-for="(c, i) in breadcrumb" :key="i">
        <span v-if="i > 0" class="ex-crumbs-sep">›</span>
        <button
          class="ex-crumb"
          :class="{ 'is-current': c.depth === store.focusTrail.length }"
          @click="ascendTo(c.depth)"
        >
          {{ c.label }}
        </button>
      </template>
      <span class="ex-crumb-spacer" />
      <span class="ex-crumb-meta">
        子树 N={{ focusN() }}
        <template v-if="store.focusTrail.length > 0">· 占根 {{ ((focusN() / rootVisits) * 100).toFixed(1) }}%</template>
        <template v-if="ownN() > 0">· 自身 {{ ownN() }}</template>
      </span>
    </nav>

    <div class="mcts-body">
      <div v-if="store.viewMode === 'tiles'" class="ex-map-col">
        <div ref="mapEl" class="mcts-tree-zone ex-map-zone">
          <div v-if="!rootInfo" class="mcts-empty">
            暂无搜索树：请先让 MCTS 对手（DL / ONNX / NNUE）走一步，或点击「搜索」手动触发
          </div>
          <template v-else>
            <div
              v-for="r in rendered"
              :key="r.tile.id"
              :style="tileStyle(r)"
              :class="tileClass(r)"
              :title="tileTooltip(r)"
              @click="onTileClick(r)"
              @dblclick="onTileDblClick(r)"
            >
              <span v-if="r.tile.childCount !== 0" class="ex-tile-drill">▸</span>
              <span class="ex-tile-title">{{ edgeLabel(r.tile.edge) }}</span>
              <span v-if="r.showValue" class="ex-tile-value">
                <span :class="valueClass(r.tile.q)">
                  Q={{ r.tile.q >= 0 ? '+' : '' }}{{ r.tile.q.toFixed(2) }}
                </span>
                <span class="ex-tile-flag">P={{ r.tile.prior.toFixed(2) }}</span>
              </span>
              <span v-if="r.showBudget" class="ex-tile-budget">
                N={{ fmtNodes(r.tile.n) }} · {{ r.share.toFixed(0) }}%
              </span>
            </div>
          </template>
        </div>
      </div>

      <div
        v-else-if="store.viewMode === 'tree'"
        ref="wrapEl"
        class="mcts-tree-zone"
        @wheel="onWheel"
        @mousedown="onDragStart"
        @mousemove="onDragMove"
        @mouseup="onDragEnd"
        @mouseleave="onDragEnd"
      >
        <div v-if="!rootInfo" class="mcts-empty">
          暂无搜索树：请先让 MCTS 对手（DL / ONNX / NNUE）走一步，或手动搜索
        </div>
        <svg v-else :viewBox="`0 0 ${svgViewBox.width} ${svgViewBox.height}`" width="100%" height="100%">
          <g :transform="transformAttr()">
            <!-- 正交折线连线（mcts-viz 风格；蓝=主变例，红=根实际选择） -->
            <template v-for="n in nodes" :key="`edges-${n.id}`">
              <template v-for="c in n.children" :key="`e-${n.id}-${c.id}`">
                <path
                  :d="edgePath(n, c)"
                  fill="none"
                  :stroke="pathStroke(n, c)"
                  :stroke-width="pathWidth(n, c)"
                  :stroke-dasharray="c.edge?.is_chance ? '5 4' : undefined"
                />
                <text
                  v-if="(c.edge?.prior ?? 0) > 0"
                  :x="px(c) + 5"
                  :y="edgeMidY(n, c) - 4"
                  font-size="10"
                  fill="#8a8378"
                >
                  P={{ c.edge!.prior.toFixed(2) }} N={{ c.n }}
                </text>
              </template>
            </template>

            <!-- 矩形节点 -->
            <g
              v-for="n in nodes"
              :key="`n-${n.id}`"
              :transform="`translate(${px(n)}, ${py(n)})`"
              class="mcts-node"
              @click.stop="onNodeClick(n.id)"
            >
              <rect
                class="mcts-node-rect"
                :x="-NW / 2"
                :y="-NH / 2"
                :width="NW"
                :height="NH"
                rx="8"
                :class="nodeClass(n)"
              />
              <text :y="-6" text-anchor="middle" class="mcts-node-title">
                {{ nodeTitle(n) }}
              </text>
              <text :y="14" text-anchor="middle" class="mcts-node-stats">
                <tspan>N={{ n.n }}</tspan>
                <tspan dx="4" :class="valueClass(n.q)">Q={{ n.q.toFixed(2) }}</tspan>
              </text>
              <g v-if="hasChildren(n.id)" class="mcts-collapse">
                <circle :cy="NH / 2" r="9" />
                <text :y="NH / 2 + 4" text-anchor="middle">
                  {{ store.expanded.has(n.id) ? '−' : '+' }}
                </text>
              </g>
            </g>

            <template v-for="n in nodes" :key="`hidden-${n.id}`">
              <text
                v-if="store.expanded.has(n.id) && n.hiddenCount > 0"
                :x="px(n)"
                :y="py(n) + DY - 24"
                text-anchor="middle"
                font-size="10"
                fill="#b0651f"
              >
                …还有 {{ n.hiddenCount }} 个子节点（前 {{ MCTS_MAX_CHILDREN }} 个）
              </text>
            </template>
          </g>
        </svg>
      </div>

      <MctsLinesPanel v-else class="mcts-lines-host" />

      <aside class="mcts-inspector">
        <h4>{{ store.viewMode === 'tiles' ? '节点检视' : '节点局面' }}</h4>
        <p v-if="store.viewMode === 'tiles'" class="ex-legend">
          <span class="ex-legend-item">子节点等分区域（大小不按访问数占比）</span>
          <span class="ex-legend-item"><span class="swatch pv" /> 主变例（访问数最大链）</span>
          <span class="ex-legend-item"><span class="swatch chosen" /> 根选择</span>
          <span class="ex-legend-item"><span class="swatch chance" /> 机会边（虚线）</span>
          <span class="ex-legend-item">绿=正价值 / 红=负价值 · P=先验 · N=访问数</span>
        </p>
        <p v-if="store.inspectorLoading && !inspectorBoard" class="mcts-inspector-empty">
          加载中…
        </p>
        <template v-else-if="inspectorBoard">
          <div class="mcts-board-host">
            <BoardGrid
              :board="inspectorBoard.state.board"
              :variant="inspectorBoard.state.variant"
              :markers="inspectorBoard.move_coords"
              readonly
            />
          </div>
          <p v-if="boardCaption" class="ex-board-caption">{{ boardCaption }}</p>
          <dl class="mcts-stats">
            <div>
              <dt>节点</dt>
              <dd>
                #{{ store.selectedId ?? store.focusId }}
                <span v-if="store.selectedDetail">
                  （{{ store.selectedDetail.player === 'Red' ? '红方' : '黑方' }}行棋）
                </span>
              </dd>
            </div>
            <template v-if="!store.selectedId">
              <div><dt>焦点 N</dt><dd>{{ focusN() }}</dd></div>
              <div>
                <dt>焦点 Q</dt>
                <dd :class="valueClass(focusQ)">{{ focusQ.toFixed(4) }}</dd>
              </div>
            </template>
            <div v-if="store.selectedDetail?.is_chance"><dt>类型</dt><dd>机会节点</dd></div>
            <div v-if="store.selectedDetail?.is_terminal"><dt>类型</dt><dd>终局</dd></div>
            <div>
              <dt>轮到</dt>
              <dd>{{ inspectorBoard.state.current_player === 'Red' ? '红方' : '黑方' }}</dd>
            </div>
            <div>
              <dt>血量</dt>
              <dd>
                红 {{ inspectorBoard.state.hp_red }} / 黑 {{ inspectorBoard.state.hp_black }}
              </dd>
            </div>
            <div>
              <dt>步数</dt>
              <dd>
                {{ inspectorBoard.state.total_step_counter }}（无吃子
                {{ inspectorBoard.state.move_counter }}）
              </dd>
            </div>
            <template v-if="store.selectedDetail">
              <div><dt>N</dt><dd>{{ store.selectedDetail.n }}</dd></div>
              <div>
                <dt>Q</dt>
                <dd :class="valueClass(store.selectedDetail.q)">
                  {{ store.selectedDetail.q.toFixed(4) }}
                </dd>
              </div>
              <div><dt>prior</dt><dd>{{ store.selectedDetail.prior.toFixed(4) }}</dd></div>
              <div><dt>logit</dt><dd>{{ store.selectedDetail.logit.toFixed(3) }}</dd></div>
              <div>
                <dt>V 先验</dt>
                <dd :class="valueClass(store.selectedDetail.initial_value)">
                  {{ store.selectedDetail.initial_value.toFixed(4) }}
                </dd>
              </div>
              <div>
                <dt>子树</dt>
                <dd>
                  {{ store.selectedDetail.child_count }} 子节点 /
                  {{ store.selectedDetail.outcome_count }} 机会结果
                </dd>
              </div>
            </template>
          </dl>
          <button v-if="store.selectedId" class="mini mcts-clear" @click="clearSelection">
            取消选中
          </button>
        </template>
        <p v-else class="mcts-inspector-empty">
          点击任意瓦片查看该节点的棋盘与搜索统计；双击可下钻到该节点
        </p>
      </aside>
    </div>
  </aside>
</template>

<style scoped>
.ex-sort {
  padding: 2px 6px;
  font-size: 12px;
}
.ex-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 12px;
  border-bottom: 1px solid #e3ddd0;
  font-size: 12px;
}
.ex-crumbs-sep {
  color: #b5ac9c;
}
.ex-crumb {
  border: 1px solid #ddd6c8;
  border-radius: 10px;
  background: #faf8f3;
  padding: 1px 10px;
  font-size: 12px;
  cursor: pointer;
}
.ex-crumb:hover {
  background: #f0ece2;
}
.ex-crumb.is-current {
  background: #e7e0d0;
  font-weight: 600;
  cursor: default;
}
.ex-crumb-spacer {
  flex: 1;
}
.ex-crumb-meta {
  color: #8a8378;
  font-size: 11px;
}
.ex-map-zone {
  overflow: hidden;
  cursor: default;
}
.ex-map-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ex-tile {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid rgba(154, 143, 127, 0.5);
  border-radius: 4px;
  overflow: hidden;
  padding: 4px 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  cursor: pointer;
  user-select: none;
}
.ex-tile:hover {
  border-color: #8a8378;
  filter: brightness(1.05);
}
.ex-tile.is-drillable:hover {
  border-style: solid;
  border-color: #5f5748;
}
.ex-tile.is-chosen {
  border: 2px solid #d32f2f;
}
.ex-tile.is-pv:not(.is-chosen) {
  border: 2px solid #0d6efd;
}
.ex-tile.is-selected {
  outline: 2px solid #2b2b2b;
  outline-offset: -2px;
}
.ex-tile.is-chance {
  border-style: dashed;
}
.ex-tile-drill {
  position: absolute;
  right: 4px;
  top: 2px;
  font-size: 10px;
  color: #7c7466;
}
.ex-tile-title {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
}
.ex-tile-value {
  display: flex;
  gap: 6px;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
}
.ex-tile-flag {
  color: #8a8378;
  font-size: 10px;
}
.ex-tile-budget {
  font-size: 10px;
  color: #6f675a;
  white-space: nowrap;
  overflow: hidden;
}
.ex-share {
  color: #8a8378;
  font-size: 11px;
}
.ex-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: #8a8378;
  margin: 0 0 8px;
}
.ex-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.swatch {
  display: inline-block;
  width: 14px;
  height: 3px;
  border-radius: 2px;
}
.swatch.pv {
  background: #0d6efd;
}
.swatch.chosen {
  background: #d32f2f;
}
.swatch.chance {
  background: repeating-linear-gradient(90deg, #c9a24b 0 4px, transparent 4px 7px);
}
.ex-board-caption {
  margin: 4px 0 0;
  font-size: 11px;
  color: #8a8378;
}
</style>
