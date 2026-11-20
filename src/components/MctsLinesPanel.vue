<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import type { MctsEdge } from '../api/types';
import { useMctsTree } from '../composables/useMctsTree';

const { store, select, clearSelection, pvSteps, setBranch, resetBranch, extendPv, hasBranchOverride } =
  useMctsTree();

const steps = computed(() => pvSteps.value);
const hasOverride = computed(() => hasBranchOverride());

function edgeTitle(edge: MctsEdge): string {
  return edge.is_chance ? `翻棋 ${(edge.chance_prob * 100).toFixed(0)}%` : `#${edge.action}`;
}

const valueClass = (v: number) => (v > 0 ? 'val-pos' : v < 0 ? 'val-neg' : undefined);

function isChosenEdge(edge: MctsEdge): boolean {
  const info = store.rootInfo;
  return !!info && !edge.is_chance && edge.action === info.chosen_action;
}

// 面板打开 / 树重建 / 主变例末端变化（含切换分支）时，继续懒加载延伸
onMounted(() => void extendPv());
watch(
  () => store.rootInfo,
  (info) => {
    if (info) void extendPv();
  },
);
watch(
  () => steps.value.map((s) => s.chosen.child_id).join(','),
  () => void extendPv(),
);
</script>

<template>
  <div class="mcts-lines-zone">
    <div v-if="!store.rootInfo" class="mcts-empty mcts-lines-empty">
      暂无搜索树：请先让 MctsDL / MctsOnnx / MCTS+NNUE 对手走一步，或手动搜索
    </div>
    <template v-else>
      <div class="mcts-lines-toolbar">
        <span class="mcts-lines-hint">沿访问次数最大的着法显示主变例，点击备选可切换分支</span>
        <button v-if="hasOverride" class="mini" @click="resetBranch">恢复主变例</button>
        <button v-if="store.selectedId" class="mini" @click="clearSelection">取消选中</button>
      </div>
      <ol class="mcts-lines-list">
        <li v-for="(step, i) in steps" :key="step.parentId" class="mcts-line-step">
          <div
            class="mcts-line-row"
            :class="{ 'is-override': step.isOverride }"
            role="button"
            @click="select(step.chosen.child_id)"
          >
            <span class="mcts-line-index">{{ i + 1 }}</span>
            <span class="mcts-line-move" :class="{ 'is-chosen-edge': isChosenEdge(step.chosen) }">
              {{ edgeTitle(step.chosen) }}
            </span>
            <span v-if="step.chosen.is_chance" class="mcts-line-chance">机会边</span>
            <span class="mcts-line-stat">P={{ step.chosen.prior.toFixed(2) }}</span>
            <span class="mcts-line-stat">N={{ step.chosen.n }}</span>
            <span class="mcts-line-stat" :class="valueClass(step.chosen.q)">
              Q={{ step.chosen.q.toFixed(3) }}
            </span>
          </div>
          <div v-if="step.alternatives.length > 0" class="mcts-line-alts">
            <button
              v-for="alt in step.alternatives"
              :key="alt.child_id"
              class="mcts-alt-chip"
              :class="{ 'is-chosen-edge': isChosenEdge(alt) }"
              :title="`P=${alt.prior.toFixed(2)} N=${alt.n} Q=${alt.q.toFixed(3)}`"
              @click.stop="setBranch(step.parentId, alt.child_id)"
            >
              {{ edgeTitle(alt) }}
              <em>N={{ alt.n }}</em>
              <em :class="valueClass(alt.q)">Q={{ alt.q.toFixed(2) }}</em>
            </button>
          </div>
        </li>
        <li v-if="steps.length === 0" class="mcts-line-step mcts-lines-empty">
          根节点暂无已加载的子节点
        </li>
      </ol>
    </template>
  </div>
</template>
