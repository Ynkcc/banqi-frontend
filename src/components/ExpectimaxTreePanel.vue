<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watchEffect, watch } from 'vue';
import type { ExEdge } from '../api/types';
import type { ExAggregate, ExRect, ExTile } from '../composables/useExpectimaxTree';
import {
  EX_SORT_OPTIONS,
  treemapLayout,
  useExpectimaxTree,
} from '../composables/useExpectimaxTree';
import { outcomeRevealedOf } from '../composables/useExpectimaxTree';
import { useGame } from '../composables/useGame';
import { pieceText } from '../domain/pieces';
import BoardGrid from './BoardGrid.vue';

const emit = defineEmits<{ close: [] }>();

const {
  store,
  refresh,
  search,
  select,
  toggleSelect,
  clearSelection,
  ensureFocusBoard,
  descend,
  ascendTo,
  focusChildren,
  focusSpent,
  pvIds,
} = useExpectimaxTree();
const { store: game } = useGame();

const FLAG_BADGE: Record<string, string> = { exact: '=', lower: '≥', upper: '≤', unknown: '?' };
const MARK_LABEL: Record<string, string> = { tt: 'TT', razor: '剪', nmp: '空着' };

const valueClass = (v: number) => (v > 0 ? 'val-pos' : v < 0 ? 'val-neg' : undefined);

function fmtNodes(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(Math.round(n));
}

function edgeLabel(e: ExEdge): string {
  if (e.is_outcome) {
    const piece = outcomeRevealedOf(e);
    return piece ? `翻 ${pieceText(piece)} ${(e.chance_prob * 100).toFixed(0)}%` : `翻 ${(e.chance_prob * 100).toFixed(0)}%`;
  }
  if (e.is_chance) return `翻 #${e.action}`;
  return `#${e.action}`;
}

function isChosen(r: RenderTile): boolean {
  const info = store.rootInfo;
  return (
    !!info && r.kind === 'tile' && !r.tile.edge.is_chance && r.tile.edge.action === info.chosen_action
  );
}

function tileBg(r: RenderTile): string {
  if (r.kind === 'agg') return 'rgba(138, 131, 120, 0.12)';
  const t = r.tile;
  if (t.edge.is_chance) return 'rgba(201, 162, 75, 0.16)';
  const v = Math.max(-1, Math.min(1, t.value));
  const a = 0.1 + 0.28 * Math.abs(v);
  return v >= 0 ? `rgba(58, 145, 92, ${a})` : `rgba(172, 74, 60, ${a})`;
}

// ---------------------------------------------------------------------------
// treemap 布局
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
  kind: 'tile' | 'agg';
  tile: ExTile;
  agg: ExAggregate<ExTile> | null;
  rect: ExRect;
  share: number;
  showValue: boolean;
  showBudget: boolean;
}

const rendered = computed<RenderTile[]>(() => {
  const info = store.rootInfo;
  if (!info || mapSize.w < 24 || mapSize.h < 24) return [];
  const view = focusChildren();
  const total = focusSpent();
  const { rects, aggregates } = treemapLayout(view.tiles, { x: 0, y: 0, w: mapSize.w, h: mapSize.h }, {
    weightOf: (t) => t.spent,
    isLeaf: (t) => t.childCount === 0,
    minElement: 32,
    gap: 2,
  });
  const out: RenderTile[] = [];
  view.tiles.forEach((tile, i) => {
    const rect = rects[i];
    if (rect.w <= 0 || rect.h <= 0) return; // 已被聚合
    out.push({
      kind: 'tile',
      tile,
      agg: null,
      rect,
      share: total > 0 ? (tile.spent / total) * 100 : 0,
      showValue: rect.h > 36 && rect.w > 64,
      showBudget: rect.h > 54 && rect.w > 88,
    });
  });
  for (const agg of aggregates) {
    out.push({
      kind: 'agg',
      tile: agg.members[0],
      agg,
      rect: agg.rect,
      share: total > 0 ? (agg.weight / total) * 100 : 0,
      showValue: false,
      showBudget: false,
    });
  }
  return out;
});

const pvSet = computed(() => (store.rootInfo ? pvIds() : new Set<number>()));

const info = computed(() => store.rootInfo);
const stats = computed(() => info.value?.stats ?? null);

const rootSpent = computed(() => info.value?.root.spent_nodes ?? 0);

/** 焦点节点的自耗 = 子树预算 − 各子瓦片预算和 */
const ownSpent = computed(() => {
  const total = focusSpent();
  const sum = focusChildren().tiles.reduce((s, t) => s + t.spent, 0);
  return Math.max(0, total - sum);
});

const breadcrumb = computed(() => {
  const trail = store.focusTrail.map((e, i) => ({ depth: i + 1, label: edgeLabel(e) }));
  return [{ depth: 0, label: '根' }, ...trail];
});

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
  if (r.agg) {
    return { 'ex-tile': true, 'is-agg': true, [`is-${r.agg.kind}`]: true };
  }
  const t = r.tile;
  return {
    'ex-tile': true,
    'is-chosen': isChosen(r),
    'is-pv': pvSet.value.has(t.id),
    'is-selected': store.selectedId === t.id,
    'is-cut': t.mark === 'tt',
    'is-chance': t.edge.is_chance,
    'is-outcome': t.edge.is_outcome,
    'is-drillable': t.childCount > 0,
  };
}

function tileTitle(r: RenderTile): string {
  if (r.agg) return r.agg.kind === 'small' ? `小项 ×${r.agg.count}` : `＋${r.agg.count} 项`;
  return edgeLabel(r.tile.edge);
}

function tileTooltip(r: RenderTile): string {
  if (r.agg) {
    return (
      (r.agg.kind === 'small' ? `小项 ×${r.agg.count}` : `＋${r.agg.count} 项`) +
      ` · 子树预算 ${fmtNodes(r.agg.weight)}（${r.share.toFixed(1)}%）· 太小无法单独显示`
    );
  }
  return `节点 #${r.tile.id} · 子树预算 ${fmtNodes(r.tile.spent)}（${r.share.toFixed(1)}%）`;
}

function onTileClick(r: RenderTile) {
  if (r.agg) return;
  toggleSelect(r.tile.id);
}

function onTileDblClick(r: RenderTile) {
  if (r.agg || r.tile.childCount === 0) return;
  void descend(r.tile.edge);
  void select(r.tile.id);
}

// 棋盘更新且面板已有搜索树时刷新树（watch 避免因 refresh 自身赋值造成循环）
watch(
  () => game.state,
  () => {
    if (store.rootInfo) void refresh();
  },
);

// 无选中项时懒加载焦点节点棋盘（根时即行动前局面）
watchEffect(() => {
  if (store.rootInfo && !store.selectedId && !store.focusBoard) void ensureFocusBoard();
});

/**
 * 检视器展示的棋盘：
 * - 选中 outcome 分支：锚定父机会节点翻开前形态（高亮格不变），被操作格标注该分支翻出的棋子；
 * - 选中机会节点：翻开前形态（被操作格视为暗子）；
 * - 其他选中项：选中节点棋盘；
 * - 无选中项：当前焦点节点棋盘（下钻后不再回退到根局面）。
 */
const inspectorBoard = computed(() => {
  const anchor = store.outcomeAnchor;
  if (anchor) {
    const board = [...anchor.state.board];
    const revealed =
      anchor.chance_outcomes.find((o) => o.child_id === store.selectedId)?.revealed ?? null;
    for (const c of anchor.move_coords) board[c] = revealed ?? 'Hidden';
    return { ...anchor, state: { ...anchor.state, board } };
  }
  const b = store.selectedBoard;
  if (!b) return store.focusBoard;
  if (b.chance_outcomes.length > 0 && b.move_coords.length > 0) {
    const board = [...b.state.board];
    for (const c of b.move_coords) board[c] = 'Hidden';
    return { ...b, state: { ...b.state, board } };
  }
  return b;
});

const boardCaption = computed(() => {
  if (!store.selectedId) {
    return store.focusTrail.length === 0 ? '行动前局面' : `焦点节点 #${store.focusId} 局面`;
  }
  const anchor = store.outcomeAnchor;
  if (anchor) {
    const o = anchor.chance_outcomes.find((x) => x.child_id === store.selectedId);
    if (o) {
      const piece = o.revealed ? pieceText(o.revealed) : '？';
      return `翻开前形态 · 选中分支翻出 ${piece}（${(o.prob * 100).toFixed(0)}%）`;
    }
    return '翻开前形态';
  }
  if (store.selectedBoard && store.selectedBoard.chance_outcomes.length > 0) {
    return '翻开前形态 · 点击概率分支查看揭示结果';
  }
  return null;
});

function badge(t: ExTile): string {
  const flag = FLAG_BADGE[t.flag] ?? t.flag;
  const mark = t.mark ? MARK_LABEL[t.mark] ?? t.mark : '';
  return mark ? `${mark} ${flag}` : flag;
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
      <select v-model="store.sortMode" class="ex-sort" title="子节点排序方式">
        <option v-for="opt in EX_SORT_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <span v-if="info" class="mcts-info">
        深度 {{ stats?.reached_depth }} / 节点 {{ stats?.nodes }} /
        {{ stats?.elapsed_ms }}ms，选择 #{{ info.chosen_action }}
      </span>
    </div>

    <nav v-if="info" class="ex-crumbs" aria-label="节点路径">
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
        子树 {{ fmtNodes(focusSpent()) }}
        <template v-if="store.focusTrail.length > 0">· 占根 {{ ((focusSpent() / rootSpent) * 100).toFixed(1) }}%</template>
        <template v-if="ownSpent > 0">· 自耗 {{ fmtNodes(ownSpent) }}</template>
      </span>
    </nav>

    <div class="mcts-body">
      <div ref="mapEl" class="mcts-tree-zone ex-map-zone">
        <div v-if="!info" class="mcts-empty">
          暂无搜索树：让 NNUE 对手走一步，或点击「搜索」手动触发
        </div>
        <template v-else>
          <div
            v-for="(r, ri) in rendered"
            :key="r.agg ? `agg-${r.agg.kind}-${ri}` : r.tile.id"
            :style="tileStyle(r)"
            :class="tileClass(r)"
            :title="tileTooltip(r)"
            @click="onTileClick(r)"
            @dblclick="onTileDblClick(r)"
          >
            <span v-if="!r.agg && r.tile.childCount > 0" class="ex-tile-drill">▸</span>
            <span class="ex-tile-title">{{ tileTitle(r) }}</span>
            <template v-if="!r.agg">
              <span v-if="r.showValue" class="ex-tile-value">
                <span :class="valueClass(r.tile.value)">
                  {{ r.tile.value >= 0 ? '+' : '' }}{{ r.tile.value.toFixed(2) }}
                </span>
                <span class="ex-tile-flag">{{ badge(r.tile) }}</span>
              </span>
              <span v-if="r.showBudget" class="ex-tile-budget">
                {{ fmtNodes(r.tile.spent) }} · {{ r.share.toFixed(0) }}%
              </span>
            </template>
            <template v-else>
              <span class="ex-tile-budget">
                {{ fmtNodes(r.agg.weight) }} · {{ r.share.toFixed(0) }}%
              </span>
              <span class="ex-tile-hidden-note">太小，无法单独显示</span>
            </template>
          </div>
          <div class="ex-map-hint">
            双击瓦片下钻（面积 = 子树预算）· 单击选中 / 再击取消 · 面包屑返回 · 太小项自动聚合
          </div>
        </template>
      </div>

      <aside class="mcts-inspector">
        <h4>节点检视</h4>
        <p class="ex-legend">
          <span class="ex-legend-item">面积 = 子节点子树消耗的预算（线性映射）</span>
          <span class="ex-legend-item"><span class="swatch pv" /> 主变例（精确链）</span>
          <span class="ex-legend-item"><span class="swatch chosen" /> 根选择</span>
          <span class="ex-legend-item"><span class="swatch chance" /> 机会边</span>
          <span class="ex-legend-item">小项 / ＋N：太小的子节点聚合占位</span>
          <span class="ex-legend-item">= 精确 / ≥ 下界 / ≤ 上界 / TT 截断 / 剪 razoring / 空着 NMP</span>
        </p>
        <p v-if="store.inspectorLoading && !store.selectedBoard" class="mcts-inspector-empty">
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
            <div>
              <dt>子树预算</dt>
              <dd>
                {{ fmtNodes(store.selectedDetail.spent_nodes) }}
                <span v-if="rootSpent > 0" class="ex-share">
                  （占根 {{ ((store.selectedDetail.spent_nodes / rootSpent) * 100).toFixed(1) }}%）
                </span>
              </dd>
            </div>
          </dl>
          <button v-if="store.selectedId" class="mini mcts-clear" @click="clearSelection">
            取消选中
          </button>
        </template>
        <p v-else class="mcts-inspector-empty">
          点击任意瓦片查看该节点的棋盘与窗口 / 界信息
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
.ex-map-hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 4px 10px;
  font-size: 11px;
  color: #a29a8a;
  background: rgba(250, 248, 243, 0.85);
  pointer-events: none;
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
.ex-tile.is-cut {
  opacity: 0.55;
}
.ex-tile.is-outcome {
  border-style: dotted;
}
.ex-tile.is-agg {
  border-style: dashed;
}
.ex-tile.is-agg.is-more {
  border-style: dotted;
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
.ex-tile-hidden-note {
  font-size: 10px;
  color: #8a8378;
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
