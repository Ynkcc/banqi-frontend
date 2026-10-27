<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRecentGames } from '../composables/useRecentGames';
import { useGame } from '../composables/useGame';
import { pieceText } from '../domain/pieces';
import type { HistoryMove, Slot } from '../api/types';

defineEmits<{ close: [] }>();

const { store, refresh, openGame, closeGame, stepPly, gotoPly, replayAsNew } = useRecentGames();
const { slotKindLabel } = useGame();

onMounted(refresh);

// ---------------------------------------------------------------------------
// 推演视图：逐 ply 局面预览
//
// 推演端点只下发 BFEN 文本（不重建 GameState），前端解析 BFEN 的 placement
// 字段还原盘面（'*' = 暗子、字母 = 明子、数字 = 连续空位），用迷你棋盘预览。
// 字母 → 短码映射与 banqi-core fen.rs 的 PIECE_LETTERS 对齐。
// ---------------------------------------------------------------------------

const LETTER_TO_TYPE: Record<string, string> = {
  P: 'Sol',
  C: 'Can',
  N: 'Hor',
  R: 'Cha',
  B: 'Ele',
  A: 'Adv',
  K: 'Gen',
};

function parsePlacement(fen: string): { rows: number; cols: number; cells: Slot[] } {
  const placement = fen.split(' ')[1] ?? '';
  const rowFields = placement.split('/');
  const cells: Slot[] = [];
  for (const row of rowFields) {
    for (const ch of row) {
      if (ch === '*') {
        cells.push('Hidden');
      } else if (ch >= '1' && ch <= '9') {
        for (let i = 0; i < Number(ch); i++) cells.push('Empty');
      } else {
        const type = LETTER_TO_TYPE[ch.toUpperCase()];
        cells.push(type ? `${ch === ch.toUpperCase() ? 'R_' : 'B_'}${type}` : 'Hidden');
      }
    }
  }
  const rows = rowFields.length;
  return { rows, cols: rows ? cells.length / rows : 0, cells };
}

const currentPly = computed(() => store.replay?.plies[store.plyIndex] ?? null);

const miniBoard = computed(() => {
  const fen = currentPly.value?.fen;
  return fen ? parsePlacement(fen) : null;
});

/** 一手棋的紧凑描述（与决策历史面板同口径）。 */
function describe(m: HistoryMove): string {
  if (m.is_flip) return `翻开 → ${pieceText(m.revealed ?? '') || '?'}`;
  if (m.is_capture && m.is_chance) return `打暗子 → ${pieceText(m.revealed ?? '') || '?'} 被消灭`;
  if (m.is_capture) return `吃掉 ${pieceText(m.captured ?? '')}`;
  return '移动';
}

/** ply 行描述（ply 0 = 初始局面；其余取归档的逐子记录）。 */
function plyDesc(index: number): string {
  if (index === 0) return '初始局面';
  const m = store.detail?.moves[index - 1];
  if (!m) return `动作 ${store.replay?.plies[index]?.last_action ?? '?'}`;
  return `${m.player === 'Red' ? '红' : '黑'} ${describe(m)}`;
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
  const slot = store.detail?.slots[side];
  if (!slot) return '—';
  return slotKindLabel(slot.kind);
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
      <!-- ==================== 推演视图 ==================== -->
      <template v-if="store.detail && store.replay">
        <div class="replay-summary">
          <div class="recent-row-top">
            <span class="recent-variant">{{ store.detail.variant }}</span>
            <span class="recent-winner" :class="store.detail.winner">
              {{ winnerLabel(store.detail.winner) }} · {{ store.detail.total_steps }} 步
            </span>
            <span class="recent-time">{{ fmtTime(store.detail.finished_at) }}</span>
          </div>
          <div class="recent-roles">红 {{ roleLabel('red') }} vs 黑 {{ roleLabel('black') }}</div>
        </div>

        <div class="mini-board-host">
          <div
            v-if="miniBoard"
            class="mini-board"
            :style="{ '--board-cols': miniBoard.cols, '--board-rows': miniBoard.rows }"
          >
            <div
              v-for="(slot, i) in miniBoard.cells"
              :key="i"
              class="chess-cell"
              :class="[
                slot === 'Hidden'
                  ? 'hidden'
                  : slot === 'Empty'
                    ? 'empty'
                    : slot.startsWith('R_')
                      ? 'red'
                      : 'black',
              ]"
            >
              {{ pieceText(slot) }}
            </div>
          </div>
        </div>

        <div class="replay-toolbar">
          <button class="mini" :disabled="store.plyIndex === 0" @click="stepPly(-1)">
            ◀ 上一步
          </button>
          <span class="ply-indicator">
            第 {{ store.plyIndex }} / {{ store.replay.plies.length - 1 }} 步
          </span>
          <button
            class="mini"
            :disabled="store.plyIndex >= store.replay.plies.length - 1"
            @click="stepPly(1)"
          >
            下一步 ▶
          </button>
        </div>

        <div class="replay-ply-list">
          <button
            v-for="(ply, i) in store.replay.plies"
            :key="ply.ply"
            class="replay-ply-row"
            :class="{ active: store.plyIndex === i }"
            @click="gotoPly(i)"
          >
            <span class="history-ply">{{ ply.ply }}</span>
            <span class="replay-ply-desc">{{ plyDesc(i) }}</span>
          </button>
        </div>

        <div class="btn-row">
          <button :disabled="store.busy" @click="replayAsNew(store.detail.game_id)">
            复演为对局（从初始局面重走）
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
