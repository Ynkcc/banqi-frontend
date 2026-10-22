<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ExEdge } from '../api/types';
import type { ExLayoutNode } from '../composables/useExpectimaxTree';
import { EX_MAX_CHILDREN, useExpectimaxTree } from '../composables/useExpectimaxTree';
import { useGame } from '../composables/useGame';
import BoardGrid from './BoardGrid.vue';

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
} = useExpectimaxTree();
const { store: game } = useGame();

// mcts-viz 风格：矩形节点 + 正交折线连线（样式类复用 global.css 的 mcts-*）
const NW = 122;
const NH = 64;
const DX = 142;
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
const stats = computed(() => rootInfo.value?.stats ?? null);

const FLAG_BADGE: Record<string, string> = { exact: '=', lower: '≥', upper: '≤', unknown: '?' };
const MARK_LABEL: Record<string, string> = { tt: 'TT', razor: '剪', nmp: '空着' };

function nodeTitle(n: {
  id: number;
  edge: { is_outcome: boolean; chance_prob: number; action: number } | null;
}): string {
  const info = rootInfo.value;
  if (info && n.id === info.root.id) return 'ROOT';
  if (!n.edge) return '';
  if (n.edge.is_outcome) return `翻 ${(n.edge.chance_prob * 100).toFixed(0)}%`;
  return `着法 #${n.edge.action}`;
}

function badge(n: { flag: string; mark: string | null; edge: ExEdge | null }): string {
  const flag = FLAG_BADGE[n.flag] ?? n.flag;
  const mark = n.mark ? MARK_LABEL[n.mark] ?? n.mark : '';
  return mark ? `${mark} ${flag}` : flag;
}

function px(n: { x: number }) {
  return PAD + n.x * DX;
}
function py(n: { y: number }) {
  return PAD + n.y * DY;
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

function isChosenEdge(n: Pick<ExLayoutNode, 'edge'>): boolean {
  const info = rootInfo.value;
  return !!info && !!n.edge && !n.edge.is_chance && n.edge.action === info.chosen_action;
}

function isPvEdge(n: Pick<ExLayoutNode, 'id'>, c: Pick<ExLayoutNode, 'id'>): boolean {
  return pvSet.value.has(n.id) && pvSet.value.has(c.id);
}

function isCut(n: Pick<ExLayoutNode, 'mark'>): boolean {
  return n.mark === 'tt';
}

function pathStroke(n: Pick<ExLayoutNode, 'id'>, c: ExLayoutNode): string {
  if (isChosenEdge(c)) return '#d32f2f';
  if (isPvEdge(n, c)) return '#0d6efd';
  return c.edge?.is_chance ? '#c9a24b' : '#9a8f7f';
}

function pathWidth(n: Pick<ExLayoutNode, 'id'>, c: ExLayoutNode): number {
  if (isChosenEdge(c)) return 4.5;
  if (isPvEdge(n, c)) return 3.5;
  return 2;
}

const valueClass = (v: number) => (v > 0 ? 'val-pos' : v < 0 ? 'val-neg' : undefined);

function nodeClass(n: ExLayoutNode): Record<string, boolean> {
  return {
    'is-chosen': isChosenEdge(n),
    'is-pv': pvSet.value.has(n.id),
    'is-selected': store.selectedId === n.id,
    'ex-cut': isCut(n),
  };
}

async function onNodeClick(nodeId: number) {
  void select(nodeId);
  await toggle(nodeId);
}

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

// 打开面板或棋盘更新且面板开启时刷新树
watch(
  () => game.state,
  () => {
    if (store.rootInfo) void refresh();
  },
);

function transformAttr(): string {
  return `translate(${treeTransform.tx}, ${treeTransform.ty}) scale(${treeTransform.scale})`;
}
</script>

<template>
  <aside class="sidebar mcts-sidebar">
    <header class="sidebar-header">
      <h3>Expectimax 搜索树</h3>
      <button class="icon-button" aria-label="关闭" @click="emit('close')">×</button>
    </header>
    <div class="mcts-toolbar">
      <button :disabled="store.searching" @click="search">
        {{ store.searching ? '搜索中…' : '搜索' }}
      </button>
      <button @click="refresh">刷新</button>
      <label><input v-model="store.showAll" type="checkbox" /> 显示全部子节点</label>
      <span v-if="rootInfo" class="mcts-info">
        深度 {{ stats?.reached_depth }} / 节点 {{ stats?.nodes }} /
        {{ stats?.elapsed_ms }}ms，选择 #{{ rootInfo.chosen_action }}
      </span>
    </div>
    <div class="mcts-body">
      <div
        ref="wrapEl"
        class="mcts-tree-zone"
        @wheel="onWheel"
        @mousedown="onDragStart"
        @mousemove="onDragMove"
        @mouseup="onDragEnd"
        @mouseleave="onDragEnd"
      >
        <div v-if="!rootInfo" class="mcts-empty">
          暂无搜索树：让 NNUE 对手走一步，或点击「搜索」手动触发
        </div>
        <svg v-else :viewBox="`0 0 ${svgViewBox.width} ${svgViewBox.height}`" width="100%" height="100%">
          <g :transform="transformAttr()">
            <template v-for="n in nodes" :key="`edges-${n.id}`">
              <template v-for="c in n.children" :key="`e-${n.id}-${c.id}`">
                <path
                  :d="edgePath(n, c)"
                  fill="none"
                  :stroke="pathStroke(n, c)"
                  :stroke-width="pathWidth(n, c)"
                  :stroke-dasharray="c.isOutcome ? '5 4' : undefined"
                  :opacity="isCut(c) ? 0.45 : undefined"
                />
                <text
                  :x="px(c) + 5"
                  :y="edgeMidY(n, c) - 4"
                  font-size="10"
                  fill="#8a8378"
                >
                  {{ c.value >= 0 ? '+' : '' }}{{ c.value.toFixed(2) }}
                </text>
              </template>
            </template>

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
              <text :y="-8" text-anchor="middle" class="mcts-node-title">
                {{ nodeTitle(n) }}
                <tspan v-if="n.edge?.is_chance && !n.isOutcome" dx="2" fill="#c9a24b">翻</tspan>
              </text>
              <text :y="12" text-anchor="middle" class="mcts-node-stats">
                <tspan :class="valueClass(n.value)">
                  {{ n.value >= 0 ? '+' : '' }}{{ n.value.toFixed(2) }}
                </tspan>
                <tspan dx="4" fill="#8a8378" font-size="10">d{{ n.edge?.depth ?? n.depth }}</tspan>
                <tspan dx="4" font-size="10" :fill="n.mark ? '#b0651f' : '#9a8f7f'">
                  {{ badge(n) }}
                </tspan>
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
                …还有 {{ n.hiddenCount }} 个子节点（前 {{ EX_MAX_CHILDREN }} 个）
              </text>
            </template>
          </g>
        </svg>
      </div>

      <aside class="mcts-inspector">
        <h4>节点检视</h4>
        <p class="ex-legend">
          <span class="ex-legend-item"><span class="swatch pv" /> 主变例（精确链）</span>
          <span class="ex-legend-item"><span class="swatch chosen" /> 根选择</span>
          <span class="ex-legend-item"><span class="swatch chance" /> 机会边</span>
          <span class="ex-legend-item">= 精确 / ≥ 下界 / ≤ 上界 / TT 截断 / 剪 razoring / 空着 NMP</span>
        </p>
        <p v-if="!store.selectedId" class="mcts-inspector-empty">
          点击任意节点查看该节点的棋盘与窗口 / 界信息
        </p>
        <p v-else-if="store.inspectorLoading && !store.selectedBoard" class="mcts-inspector-empty">
          加载中…
        </p>
        <template v-else-if="store.selectedBoard">
          <div class="mcts-board-host">
            <BoardGrid
              :board="store.selectedBoard.state.board"
              :variant="store.selectedBoard.state.variant"
              :markers="store.selectedBoard.move_coords"
              readonly
            />
          </div>
          <dl v-if="store.selectedDetail" class="mcts-stats">
            <div><dt>节点</dt><dd>#{{ store.selectedId }}</dd></div>
            <div>
              <dt>值（行棋方视角）</dt>
              <dd :class="valueClass(store.selectedDetail.value)">
                {{ store.selectedDetail.value.toFixed(4) }}
              </dd>
            </div>
            <div>
              <dt>窗口 α/β</dt>
              <dd>[{{ store.selectedDetail.alpha.toFixed(2) }}, {{ store.selectedDetail.beta.toFixed(2) }}]</dd>
            </div>
            <div>
              <dt>界类型</dt>
              <dd>{{ store.selectedDetail.flag }}<template v-if="store.selectedDetail.mark">（{{ MARK_LABEL[store.selectedDetail.mark] ?? store.selectedDetail.mark }}）</template></dd>
            </div>
            <div><dt>剩余深度</dt><dd>{{ store.selectedDetail.depth }}</dd></div>
            <div>
              <dt>类型</dt>
              <dd>
                {{ store.selectedDetail.is_root ? '根' : store.selectedDetail.is_null_probe ? 'null 探测' : store.selectedDetail.is_outcome ? '机会结果' : store.selectedDetail.is_chance ? '机会节点' : '决策节点' }}
                · {{ store.selectedDetail.player === 'Red' ? '红方' : '黑方' }}行棋
              </dd>
            </div>
            <div v-if="store.selectedDetail.is_outcome">
              <dt>概率</dt>
              <dd>{{ (store.selectedDetail.chance_prob * 100).toFixed(1) }}%</dd>
            </div>
            <div><dt>子节点</dt><dd>{{ store.selectedDetail.child_count }}</dd></div>
          </dl>
          <button class="mini mcts-clear" @click="clearSelection">取消选中</button>
        </template>
      </aside>
    </div>
  </aside>
</template>

<style scoped>
.ex-cut {
  opacity: 0.45;
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
</style>
