<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRecentGames } from '../composables/useRecentGames';
import { useToast } from '../composables/useToast';
import { pieceText, variantDims } from '../domain/pieces';
import type { HiddenBag, ReplayStep } from '../api/types';

defineEmits<{ close: [] }>();

const { store, refresh, openGame, closeGame, stepPly, gotoPly, replayAsNew } = useRecentGames();
const toast = useToast();

onMounted(refresh);

/** 复制对局 uuid（供外部工具/排查引用）。 */
async function copyGameId() {
  const id = store.detail?.game_id;
  if (!id) return;
  try {
    await navigator.clipboard.writeText(id);
    toast.success('对局 UUID 已复制到剪贴板', 2000);
  } catch (e) {
    console.error('Copy game id failed:', e);
    toast.error('复制失败: ' + e);
  }
}

// ---------------------------------------------------------------------------
// 上帝视角回放：服务端已重建逐步棋盘（board/revealed_at/hidden_bag/诊断），
// 前端只负责渲染与步进。局面态 0 = 初始局面，N = 终局；态 k 的盘面 = moves[k]
// 的步前棋盘（k < N）或 final_board（k = N）。
// ---------------------------------------------------------------------------

const stateCount = computed(() => (store.replay?.moves.length ?? 0) + 1);

const dims = computed(() => {
  const len = store.replay?.initial_board.length ?? 0;
  return variantDims(store.replay?.variant ?? '', len);
});

interface BoardState {
  board: string[];
  shown: boolean[];
  scores: [number, number];
  /** 盘上暗子格数 */
  hidden: number;
  /** 双方剩余暗子按类型计数（服务端剩余池口径，恒可用） */
  bag: HiddenBag;
}

const boardState = computed<BoardState | null>(() => {
  const r = store.replay;
  if (!r) return null;
  const k = store.plyIndex;
  if (k >= r.moves.length) {
    return {
      board: r.final_board,
      shown: r.final_shown,
      scores: r.final_scores,
      hidden: r.final_shown.filter((s) => !s).length,
      bag: r.final_hidden_bag,
    };
  }
  const m = r.moves[k];
  return {
    board: m.board,
    shown: m.revealed_at,
    scores: m.scores,
    hidden: m.revealed_at.filter((s) => !s).length,
    bag: m.hidden_bag,
  };
});

/** 产出当前态的那手棋（态 0 = 无）。 */
const currentMove = computed<ReplayStep | null>(() => {
  const k = store.plyIndex;
  return k >= 1 ? (store.replay?.moves[k - 1] ?? null) : null;
});

const KIND_LABELS: Record<string, string> = {
  flip: '翻棋',
  move: '移动',
  capture: '吃子',
  'reveal-attack': '吃暗子',
};

const TERMINATION_LABELS: Record<string, string> = {
  decisive: '分出胜负',
  quiet_draw: '无吃子和棋',
  max_steps: '步数上限和棋',
  unspecified: '未终局',
};

const BAG_TYPES = ['Sol', 'Can', 'Hor', 'Cha', 'Ele', 'Adv', 'Gen'] as const;

/** 当前局面双方剩余暗子按类型计数（BAG_TYPES 下标与后端 PieceType 枚举序一致）。 */
const hiddenBag = computed(() => {
  const bag = boardState.value?.bag;
  const red: Record<string, number> = {};
  const black: Record<string, number> = {};
  BAG_TYPES.forEach((t, i) => {
    red[t] = bag?.red[i] ?? 0;
    black[t] = bag?.black[i] ?? 0;
  });
  return { red, black };
});

/** ply 列表行描述（与决策历史面板同口径）。 */
function stepDesc(m: ReplayStep): string {
  const side = m.player === 'Red' ? '红' : '黑';
  if (m.kind === 'flip') return `${side} 翻开 → ${pieceText(m.revealed ?? '') || '?'}`;
  if (m.kind === 'reveal-attack') return `${side} 打暗子 → ${pieceText(m.revealed ?? '') || '?'} 被消灭`;
  if (m.kind === 'capture') return `${side} 吃掉 ${pieceText(m.captured ?? '')}`;
  return `${side} 移动`;
}

function cellClass(value: string, shown: boolean): string {
  if (value === 'Empty') return 'empty';
  if (value === 'Hidden') return 'hidden';
  const cls = value.startsWith('R_') ? 'red' : 'black';
  return shown ? cls : `god-hidden ${cls}`;
}

function winnerLabel(winner?: string): string {
  return winner === 'red' ? '红胜' : winner === 'black' ? '黑胜' : winner === 'draw' ? '和棋' : '—';
}

function fmtTime(unix: number): string {
  const d = new Date(unix * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function roleLabel(side: 'red' | 'black'): string {
  return side === 'red'
    ? (store.replay?.side_red ?? store.detail?.slots.red.kind ?? '—')
    : (store.replay?.side_black ?? store.detail?.slots.black.kind ?? '—');
}

function statRow(label: string, value?: number | string | boolean): string {
  return value === undefined ? `${label} —` : `${label} ${value}`;
}
</script>

<template>
  <aside class="sidebar">
    <header class="sidebar-header">
      <h3>最近对局</h3>
      <div class="recent-header-actions">
        <button class="mini" :disabled="store.loading" title="刷新列表" @click="refresh">
          刷新
        </button>
        <button class="icon-button" aria-label="关闭" @click="$emit('close')">×</button>
      </div>
    </header>
    <div class="sidebar-body">
      <!-- ==================== 上帝视角回放视图 ==================== -->
      <template v-if="store.detail && store.replay">
        <div class="replay-summary">
          <div class="recent-row-top">
            <span class="recent-variant">{{ store.replay.variant }}</span>
            <span class="recent-winner" :class="store.replay.winner">
              {{ winnerLabel(store.replay.winner) }} · {{ store.replay.moves.length }} 步
            </span>
            <span class="recent-time">{{ fmtTime(store.detail.finished_at) }}</span>
          </div>
          <div class="recent-roles">
            红 {{ roleLabel('red') }} vs 黑 {{ roleLabel('black') }}
            <span class="termination-badge">{{ TERMINATION_LABELS[store.replay.termination] ?? store.replay.termination }}</span>
            <span v-if="store.replay.board_source === 'replay'" class="source-badge" title="快照缺失，由动作序列推断重建">动作推断</span>
          </div>
          <div class="recent-roles">
            <button
              class="source-badge game-id-badge"
              :title="'点击复制完整 UUID: ' + store.detail.game_id"
              @click="copyGameId"
            >
              UUID {{ store.detail.game_id.slice(0, 8) }}…（点击复制）
            </button>
          </div>
        </div>

        <div class="mini-board-host">
          <div
            v-if="boardState"
            class="mini-board"
            :style="{ '--board-cols': dims.cols, '--board-rows': dims.rows }"
          >
            <div
              v-for="(value, i) in boardState.board"
              :key="i"
              class="chess-cell"
              :class="cellClass(value, boardState.shown[i])"
            >
              {{ pieceText(value) }}<span v-if="cellClass(value, boardState.shown[i]).includes('god-hidden')" class="god-mark">?</span>
            </div>
          </div>
        </div>

        <!-- 当前步信息 -->
        <div class="replay-state-bar">
          <span class="state-score">红 {{ boardState?.scores[0] }} · 黑 {{ boardState?.scores[1] }}</span>
          <span class="state-hidden">暗子 {{ boardState?.hidden }}</span>
          <span v-if="currentMove" class="kind-badge" :class="currentMove.kind">
            {{ KIND_LABELS[currentMove.kind] ?? currentMove.kind }}
          </span>
        </div>

        <div class="replay-toolbar">
          <button class="mini" :disabled="store.plyIndex === 0" @click="stepPly(-1)">
            ◀ 上一步
          </button>
          <span class="ply-indicator">
            第 {{ store.plyIndex }} / {{ stateCount - 1 }} 步
          </span>
          <button
            class="mini"
            :disabled="store.plyIndex >= stateCount - 1"
            @click="stepPly(1)"
          >
            下一步 ▶
          </button>
        </div>

        <!-- 侧栏：暗子袋 + 决策诊断 -->
        <div class="replay-side-panels">
          <div class="side-panel">
            <h4>剩余暗子</h4>
            <table class="bag-table">
              <thead>
                <tr><th>类型</th><th>红</th><th>黑</th></tr>
              </thead>
              <tbody>
                <tr v-for="t in BAG_TYPES" :key="t">
                  <td>{{ pieceText('R_' + t) }}{{ pieceText('B_' + t) }}</td>
                  <td>{{ hiddenBag.red[t] }}</td>
                  <td>{{ hiddenBag.black[t] }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="side-panel">
            <h4>决策诊断</h4>
            <template v-if="currentMove?.stats">
              <div v-if="currentMove.stats.mcts" class="stat-block">
                <div class="stat-title">MCTS</div>
                <div class="stat-line">{{ statRow('模拟', currentMove.stats.mcts.actual_sims) }} / {{ currentMove.stats.mcts.budget }}</div>
                <div class="stat-line">{{ statRow('深度', currentMove.stats.mcts.max_depth) }} · {{ statRow('节点', currentMove.stats.mcts.nodes) }}</div>
                <div class="stat-line">{{ statRow('耗时', currentMove.stats.mcts.elapsed_ms + 'ms') }}</div>
              </div>
              <div v-if="currentMove.stats.nnue" class="stat-block">
                <div class="stat-title">
                  {{ currentMove.stats.nnue.engine === 'rule' ? 'Expectimax（规则评估器）' : 'NNUE' }}
                </div>
                <div class="stat-line">{{ statRow('深度', currentMove.stats.nnue.reached_depth) }} / {{ currentMove.stats.nnue.depth }}</div>
                <div class="stat-line">{{ statRow('节点', currentMove.stats.nnue.nodes) }}</div>
                <div class="stat-line">{{ statRow('耗时', currentMove.stats.nnue.elapsed_ms + 'ms') }}</div>
              </div>
            </template>
            <div v-else class="stat-empty">
              {{ currentMove ? '该步无搜索诊断（人类 / 规则步）' : '初始局面' }}
            </div>
          </div>
        </div>

        <div class="replay-ply-list">
          <button
            class="replay-ply-row"
            :class="{ active: store.plyIndex === 0 }"
            @click="gotoPly(0)"
          >
            <span class="history-ply">0</span>
            <span class="replay-ply-desc">初始局面</span>
          </button>
          <button
            v-for="(m, i) in store.replay.moves"
            :key="m.ply"
            class="replay-ply-row"
            :class="{ active: store.plyIndex === i + 1 }"
            @click="gotoPly(i + 1)"
          >
            <span class="history-ply">{{ m.ply }}</span>
            <span class="replay-ply-desc">{{ stepDesc(m) }}</span>
            <span class="replay-ply-kind">{{ KIND_LABELS[m.kind] ?? m.kind }}</span>
          </button>
        </div>

        <div class="btn-row">
          <button :disabled="store.busy" @click="replayAsNew(store.detail.game_id, store.plyIndex)">
            复演为对局（从当前步数重走）
          </button>
        </div>
        <button class="replay-back" @click="closeGame">← 返回最近对局列表</button>
      </template>

      <!-- ==================== 列表视图 ==================== -->
      <template v-else>
        <div v-if="store.games.length === 0 && !store.loading" class="recent-empty">
          {{ store.error ? `加载失败: ${store.error}` : '暂无终局归档（完成一局对局后自动记录）' }}
        </div>
        <div v-for="g in store.games" :key="g.game_id" class="recent-row">
          <div class="recent-row-top">
            <span class="recent-variant">{{ g.variant }}</span>
            <span class="recent-winner" :class="g.winner">
              {{ winnerLabel(g.winner) }} · {{ g.total_steps }} 步
            </span>
            <span class="recent-time">{{ fmtTime(g.finished_at) }}</span>
          </div>
          <div class="recent-roles">
            红 {{ g.slots.red.kind
            }}<template v-if="g.slots.red.model_file">（{{ g.slots.red.model_file }}）</template>
            vs 黑 {{ g.slots.black.kind
            }}<template v-if="g.slots.black.model_file">（{{ g.slots.black.model_file }}）</template>
          </div>
          <div class="recent-actions">
            <button class="mini" :disabled="store.busy" @click="openGame(g.game_id)">推演</button>
            <button class="mini" :disabled="store.busy" @click="replayAsNew(g.game_id)">复演</button>
          </div>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
/* 上帝视角暗子：身份可见但半透明 + 角标 "?" */
.god-hidden {
  opacity: 0.55;
  position: relative;
}
.god-mark {
  position: absolute;
  top: 1px;
  right: 3px;
  font-size: 0.6em;
  opacity: 0.8;
}
.termination-badge,
.source-badge {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 0.75em;
  background: var(--panel-2, rgba(127, 140, 141, 0.2));
}
.source-badge {
  color: var(--warn, #e67e22);
}
.game-id-badge {
  margin-left: 0;
  border: none;
  cursor: pointer;
  color: var(--text-dim, #7f8c8d);
  font: inherit;
  font-size: 0.75em;
  font-family: monospace;
}
.game-id-badge:hover {
  color: var(--accent, #3498db);
}
.replay-state-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 0;
  font-size: 0.9em;
}
.kind-badge {
  padding: 1px 8px;
  border-radius: 8px;
  background: var(--panel-2, rgba(127, 140, 141, 0.2));
}
.kind-badge.flip,
.kind-badge.reveal-attack {
  color: var(--accent, #e67e22);
}
.kind-badge.capture {
  color: var(--danger, #c0392b);
}
.replay-side-panels {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}
.side-panel {
  flex: 1;
  border: 1px solid var(--border, rgba(127, 140, 141, 0.3));
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 0.8em;
}
.side-panel h4 {
  margin: 0 0 4px;
  font-size: 0.9em;
}
.bag-table {
  width: 100%;
  border-collapse: collapse;
}
.bag-table th,
.bag-table td {
  text-align: center;
  padding: 1px 2px;
}
.stat-block {
  margin-bottom: 6px;
}
.stat-title {
  font-weight: 600;
}
.stat-line {
  opacity: 0.85;
}
.stat-empty {
  opacity: 0.6;
}
.replay-ply-kind {
  margin-left: auto;
  opacity: 0.6;
  font-size: 0.85em;
}
</style>
