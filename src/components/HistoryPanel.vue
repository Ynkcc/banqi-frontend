<script setup lang="ts">
import { computed } from 'vue';
import { useGame } from '../composables/useGame';
import { pieceText, variantDims } from '../domain/pieces';

const { store, inspectMove } = useGame();

const moves = computed(() => store.state?.history ?? []);

const dims = computed(() => {
  const s = store.state;
  return s ? variantDims(s.variant, s.board.length) : { rows: 0, cols: 0 };
});

/** 一手棋的紧凑描述（表格行用；与日志口径一致，机会动作附实际翻出的棋子）。 */
function describe(m: (typeof moves.value)[number]): string {
  if (m.is_flip) {
    return `翻开 ${pieceText(m.revealed ?? '') || '?'}`;
  }
  if (m.is_capture && m.is_chance) {
    return `打暗子 → ${pieceText(m.revealed ?? '') || '?'} 被消灭`;
  }
  if (m.is_capture) {
    return `吃掉 ${pieceText(m.captured ?? '')}`;
  }
  return '移动';
}

/** 格位索引 → 坐标标签（列字母 + 行号，与棋盘口径一致，如 "b3"）。 */
function coord(idx: number): string {
  if (!dims.value.cols) return String(idx);
  const col = idx % dims.value.cols;
  const row = Math.floor(idx / dims.value.cols);
  return `${String.fromCharCode(97 + col)}${row + 1}`;
}
</script>

<template>
  <div class="history-panel">
    <div class="history-header">
      <h3>决策历史</h3>
      <span class="history-count">{{ moves.length }} 手</span>
    </div>
    <div class="history-list">
      <div v-if="moves.length === 0" class="history-empty">
        对局开始后，每手棋（含翻子/打暗子的真实结果）将显示在此处
      </div>
      <button
        v-for="m in moves"
        :key="m.ply"
        class="history-entry"
        :class="{ active: store.inspectPly === m.ply }"
        :title="`点击在棋盘上高亮 第${m.ply}手`"
        @click="inspectMove(m.ply)"
      >
        <span class="history-ply">{{ m.ply }}</span>
        <span class="history-player" :class="m.player === 'Red' ? 'red' : 'black'">
          {{ m.player === 'Red' ? '红' : '黑' }}
        </span>
        <span class="history-desc">{{ describe(m) }}</span>
        <span class="history-coords">
          {{ coord(m.from) }}{{ m.from === m.to ? '' : `→${coord(m.to)}` }}
        </span>
      </button>
    </div>
  </div>
</template>
