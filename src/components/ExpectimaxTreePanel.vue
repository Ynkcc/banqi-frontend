<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watchEffect, watch } from 'vue';
import type { ExEdge } from '../api/types';
import type { ExAggregate, ExRect, ExTile } from '../composables/useExpectimaxTree';
import {
  EX_SORT_OPTIONS,
  treemapLayout,
  useExpectimaxTree,
} from '../composables/useExpectimaxTree';
import { outcomeRevealedOf, pruneReasonLabel } from '../composables/useExpectimaxTree';
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
  const pct = `${(e.chance_prob * 100).toFixed(0)}%`;
  // 机会动作分两类：翻子（翻开位置上的暗子）与吃暗子（如炮击暗子）
  const verb = e.is_flip ? '翻' : '击';
  if (e.is_outcome) {
    const piece = outcomeRevealedOf(e);
    return piece ? `${verb} ${pieceText(piece)} ${pct}` : `${verb} ${pct}`;
  }
  if (e.is_chance) return `${verb} #${e.action}`;
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
  // 剪枝分支：灰色斜纹（未实际搜索，无价值信息）
  if (t.pruned) {
    return 'repeating-linear-gradient(45deg, rgba(154, 143, 127, 0.18) 0 6px, rgba(154, 143, 127, 0.05) 6px 12px)';
  }
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

  // 剪枝终止的叶子分支（零预算、不可下钻）：不参与面积分配（会因权重 0
  // 被小项聚合吞掉），改为底部条带中等宽展示，保证「因剪枝而终止的分支」可见。
  const stripTiles = view.tiles.filter((t) => t.pruned && t.spent === 0 && t.childCount === 0);
  const stripSet = new Set(stripTiles);
  const mapTiles = view.tiles.filter((t) => !stripSet.has(t));

  // 底部条带：等宽小格，最多 4 行，放不下的并入「＋N ✂」占位格
  const stripCols = Math.max(1, Math.floor(mapSize.w / 72));
  const stripRows = Math.min(4, Math.ceil(stripTiles.length / stripCols));
  const stripCellH = 24;
  const stripH = stripTiles.length > 0 ? stripRows * (stripCellH + 2) + 2 : 0;
  const mapH = mapSize.h - stripH;

  const { rects, aggregates } = treemapLayout(mapTiles, { x: 0, y: 0, w: mapSize.w, h: mapH }, {
    weightOf: (t) => t.spent,
    isLeaf: (t) => t.childCount === 0,
    minElement: 32,
    gap: 2,
  });
  const out: RenderTile[] = [];
  mapTiles.forEach((tile, i) => {
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
  // 剪枝条带格子
  const stripShown = Math.min(stripTiles.length, stripRows * stripCols);
  const overflow = stripTiles.length - stripShown;
  const cw = mapSize.w / stripCols;
  stripTiles.slice(0, stripShown).forEach((tile, i) => {
    out.push({
      kind: 'tile',
      tile,
      agg: null,
      rect: {
        x: (i % stripCols) * cw,
        y: mapH + Math.floor(i / stripCols) * (stripCellH + 2),
        w: cw - 2,
        h: stripCellH,
      },
      share: 0,
      showValue: false,
      showBudget: false,
    });
  });
  if (overflow > 0) {
    out.push({
      kind: 'agg',
      tile: stripTiles[stripShown],
      agg: {
        kind: 'more',
        count: overflow,
        weight: 0,
        members: stripTiles.slice(stripShown),
        rect: {
          x: (stripShown % stripCols) * cw,
          y: mapH + Math.floor(stripShown / stripCols) * (stripCellH + 2),
          w: mapSize.w - (stripShown % stripCols) * cw - 2,
          h: stripCellH,
        },
      },
      rect: {
        x: (stripShown % stripCols) * cw,
        y: mapH + Math.floor(stripShown / stripCols) * (stripCellH + 2),
        w: mapSize.w - (stripShown % stripCols) * cw - 2,
        h: stripCellH,
      },
      share: 0,
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
    'is-pruned': t.pruned,
    'is-chance': t.edge.is_chance,
    'is-outcome': t.edge.is_outcome,
    'is-drillable': t.childCount > 0,
  };
}

function tileTitle(r: RenderTile): string {
  if (r.agg) {
    if (r.agg.kind === 'more' && r.agg.members[0]?.pruned) return `＋${r.agg.count} 剪枝`;
    return r.agg.kind === 'small' ? `小项 ×${r.agg.count}` : `＋${r.agg.count} 项`;
  }
  const label = edgeLabel(r.tile.edge);
  return r.tile.pruned ? `✂ ${label}` : label;
}

function tileTooltip(r: RenderTile): string {
  if (r.agg) {
    if (r.agg.kind === 'more' && r.agg.members[0]?.pruned) {
      return `＋${r.agg.count} 条剪枝分支（底部条带放不下）· 单击首个成员查看`;
    }
    return (
      (r.agg.kind === 'small' ? `小项 ×${r.agg.count}` : `＋${r.agg.count} 项`) +
      ` · 子树预算 ${fmtNodes(r.agg.weight)}（${r.share.toFixed(1)}%）· 太小无法单独显示`
    );
  }
  const cut = r.tile.pruned
    ? ` · ✂ 剪枝终止（${pruneReasonLabel(r.tile.pruneReason) ?? r.tile.pruneReason}，未实际搜索）`
    : '';
  return `节点 #${r.tile.id} · 子树预算 ${fmtNodes(r.tile.spent)}（${r.share.toFixed(1)}%）${cut}`;
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

/** 机会节点期望值文本（含区间）；未记录返回 null */
function expText(d: { exp_value?: number | null; exp_lower?: number | null; exp_upper?: number | null }): string | null {
  if (d.exp_value == null) return null;
  const v = d.exp_value >= 0 ? '+' : '';
  let s = `${v}${d.exp_value.toFixed(4)}`;
  if (d.exp_lower != null && d.exp_upper != null) {
    s += ` [${d.exp_lower.toFixed(3)}, ${d.exp_upper.toFixed(3)}]`;
  }
  return s;
}

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
    // 只揭示被操作格（吃暗子时 move_coords 末位为目标格，攻击者格保持原样）
    const target = anchor.move_coords[anchor.move_coords.length - 1];
    if (target !== undefined) board[target] = revealed ?? 'Hidden';
    return { ...anchor, state: { ...anchor.state, board } };
  }
  const b = store.selectedBoard;
  if (!b) return store.focusBoard;
  if (b.chance_outcomes.length > 0 && b.move_coords.length > 0) {
    const board = [...b.state.board];
    // 只把被操作格视为暗子（吃暗子时攻击者格保持可见）
    const target = b.move_coords[b.move_coords.length - 1];
    if (target !== undefined) board[target] = 'Hidden';
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
      const verb = store.selectedDetail?.is_flip === false ? '击出' : '翻出';
      return `翻开前形态 · 选中分支${verb} ${piece}（${(o.prob * 100).toFixed(0)}%）`;
    }
    return '翻开前形态';
  }
  if (store.selectedBoard && store.selectedBoard.chance_outcomes.length > 0) {
    return '翻开前形态 · 点击概率分支查看揭示结果';
  }
  return null;
});

function badge(t: ExTile): string {
  if (t.pruned) {
    const cut = `✂ ${pruneReasonLabel(t.pruneReason) ?? t.pruneReason ?? '剪枝'}`;
    const flag = FLAG_BADGE[t.flag] ?? t.flag;
    return `${cut} ${flag}`;
  }
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
      <div class="ex-map-col">
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
                <span v-if="r.tile.pruned" class="ex-tile-pruned-tag">
                  ✂ {{ pruneReasonLabel(r.tile.pruneReason) ?? '剪枝' }}
                </span>
                <span v-else :class="valueClass(r.tile.value)">
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
          </template>
        </div>
      </div>

      <aside class="mcts-inspector">
        <h4>节点检视</h4>
        <p class="ex-legend">
          <span class="ex-legend-item">面积 = 子节点子树消耗的预算（线性映射）</span>
          <span class="ex-legend-item"><span class="swatch pv" /> 主变例（精确链）</span>
          <span class="ex-legend-item"><span class="swatch chosen" /> 根选择</span>
          <span class="ex-legend-item"><span class="swatch chance" /> 机会边</span>
          <span class="ex-legend-item">小项 / ＋N：太小的子节点聚合占位</span>
          <span class="ex-legend-item">= 精确 / ≥ 下界 / ≤ 上界 / TT 截断</span>
          <span class="ex-legend-item">
            <span class="swatch pruned" /> 底部条带 / 斜纹灰 = 剪枝终止分支：β截断 / 静态剪 / 翻子限 / 扇出限 / δ / SEE
          </span>
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
                <span
                  v-if="store.selectedDetail.exp_value != null"
                  class="ex-share"
                  title="窗口截断时此值为 α-β 边界，翻子期望见下行"
                >（窗口边界）</span>
              </dd>
            </div>
            <div v-if="expText(store.selectedDetail)">
              <dt>翻子期望（行棋方视角）</dt>
              <dd>{{ expText(store.selectedDetail) }}</dd>
            </div>
            <div>
              <dt>界类型</dt>
              <dd>{{ store.selectedDetail.flag }}<template v-if="store.selectedDetail.mark">（{{ MARK_LABEL[store.selectedDetail.mark] ?? store.selectedDetail.mark }}）</template></dd>
            </div>
            <div v-if="store.selectedDetail.pruned">
              <dt>剪枝终止</dt>
              <dd>
                ✂ {{ pruneReasonLabel(store.selectedDetail.prune_reason) ?? store.selectedDetail.prune_reason }}
                （未实际搜索，无子树预算）
              </dd>
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
.ex-map-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.ex-map-hint {
  flex: none;
  padding: 3px 10px;
  font-size: 11px;
  color: #a29a8a;
  background: #faf8f3;
  border-top: 1px solid #e3ddd0;
  pointer-events: none;
  user-select: none;
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
.ex-tile.is-pruned {
  border-style: dashed;
  border-color: rgba(154, 143, 127, 0.75);
  cursor: pointer;
}
.ex-tile.is-pruned.is-selected {
  outline-color: #6b6357;
}
.ex-tile-pruned-tag {
  color: #6b6357;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
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
.swatch.pruned {
  background: repeating-linear-gradient(45deg, rgba(154, 143, 127, 0.7) 0 4px, rgba(154, 143, 127, 0.15) 4px 8px);
}
.ex-board-caption {
  margin: 4px 0 0;
  font-size: 11px;
  color: #8a8378;
}
</style>
