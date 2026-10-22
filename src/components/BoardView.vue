<script setup lang="ts">
import { useGame } from '../composables/useGame';
import BoardGrid from './BoardGrid.vue';

const { store, inspectMarkers, suggestionSquares, onSquareClick, clearSuggestion } = useGame();
</script>

<template>
  <div class="board-wrap" :class="{ busy: store.busy }">
    <BoardGrid
      v-if="store.state"
      :board="store.state.board"
      :variant="store.state.variant"
      :selected="store.selectedSquare"
      :highlights="store.moveHighlights"
      :action-masks="store.state.action_masks"
      :markers="inspectMarkers"
      :suggest="suggestionSquares"
      @cell-click="onSquareClick"
    />
    <div v-else class="board-empty">加载中…</div>
    <div v-if="store.busy" class="busy-banner">电脑思考中…</div>
    <span v-if="store.autoEnabled" class="pill auto-badge">自动对弈中（解除任一方托管即暂停）</span>
    <button
      v-if="suggestionSquares"
      class="pill suggestion-dismiss"
      title="清除建议走法高亮"
      @click="clearSuggestion"
    >
      清除建议
    </button>
  </div>
</template>

<style scoped>
.suggestion-dismiss {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
}
.auto-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  background: rgba(33, 150, 243, 0.85);
  color: #fff;
}
</style>
