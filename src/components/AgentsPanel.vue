<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { AgentView, NnueGreedyAction } from '../api/types';
import { strategyNeedsModel } from '../api/types';
import { variantsReady } from '../domain/variants';
import { useAgents } from '../composables/useAgents';
import { useGame } from '../composables/useGame';
import { useSettings } from '../composables/useSettings';
import AgentWindow from './AgentWindow.vue';

const {
  store,
  AGENT_KINDS,
  modelsFor,
  refresh,
  create,
  remove,
  draftOf,
  applySettings,
  suggest,
  step,
  bind,
  unbind,
} = useAgents();
const { capabilities, ptModels, nnueModels, refreshModels } = useSettings();
const { store: game } = useGame();

// 变体列表由后端 list_variants 下发（与 ControlPanel 同源）
const VARIANTS = ref<{ value: string; label: string }[]>([]);
onMounted(async () => {
  const infos = await variantsReady;
  VARIANTS.value = infos.map((v) => ({ value: v.id, label: v.label }));
  await refresh();
});

// 仅展示后端已编译进去的推理后端对应的策略种类
const KINDS = computed(() => AGENT_KINDS.filter((o) => o.feature === undefined || capabilities[o.feature]));

/** 当前对局中各阵营绑定的 Agent ID。 */
function boundAgent(side: 'red' | 'black'): string | undefined {
  return game.state?.slots?.[side].agent_id;
}

function kindLabel(agent: AgentView): string {
  return AGENT_KINDS.find((k) => k.value === agent.kind)?.label ?? agent.kind;
}

/** 纯网络贪心（NnueGreedy）最近一次「建议」的逐分量明细（版本对齐才显示）。 */
const greedyDetail = computed(() => {
  const s = game.suggestion;
  if (!s || !game.state || s.version !== game.state.version) return null;
  return s.nnue_greedy ?? null;
});

function actionLabel(a: NnueGreedyAction): string {
  if (a.is_flip) return `翻@${a.to}`;
  return `${a.from}→${a.to}${a.is_capture ? '吃' : ''}`;
}
</script>

<template>
  <section class="panel-card agents-panel">
    <h3>Agent（玩家）</h3>
    <p class="hint">
      Agent 是可复用的策略配置：创建后只读，仅搜索配置可实时调整（对绑定它的对局立即生效）。
      「建议 / 单步」永远作用于当前行动方，与托管阵营无关；「托管」把该 Agent 绑定到红/黑槽位。
    </p>

    <div class="agent-create">
      <label class="field">
        <span>变体</span>
        <select v-model="store.form.variant">
          <option v-for="v in VARIANTS" :key="v.value" :value="v.value">{{ v.label }}</option>
        </select>
      </label>
      <label class="field">
        <span>类型</span>
        <select v-model="store.form.kind">
          <option v-for="o in KINDS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <label v-if="strategyNeedsModel(store.form.kind as any)" class="field">
        <span>模型文件</span>
        <select v-model="store.form.modelFile">
          <option v-if="modelsFor(store.form.kind, ptModels, nnueModels).length === 0" value="">无可选模型</option>
          <option v-for="m in modelsFor(store.form.kind, ptModels, nnueModels)" :key="m.path" :value="m.path">{{ m.path }}</option>
        </select>
      </label>
      <label
        v-if="store.form.kind === 'MctsOnnx' || store.form.kind === 'MctsDL' || store.form.kind === 'MctsNnue'"
        class="field"
      >
        <span>搜索次数</span>
        <input v-model.number="store.form.mctsSims" type="number" min="1" />
      </label>
      <template v-if="store.form.kind === 'Expectimax'">
        <label class="field">
          <span>预算模式</span>
          <select v-model="store.form.engineBudgetMode">
            <option value="depth">深度</option>
            <option value="time">用时</option>
          </select>
        </label>
        <label v-if="store.form.engineBudgetMode === 'depth'" class="field">
          <span>确定性深度</span>
          <input v-model.number="store.form.engineDeterministicDepth" type="number" min="1" />
        </label>
        <label v-if="store.form.engineBudgetMode === 'depth'" class="field">
          <span>Chance 展开深度</span>
          <input v-model.number="store.form.engineChanceOutcomeDepth" type="number" min="0" />
        </label>
        <label v-if="store.form.engineBudgetMode === 'time'" class="field">
          <span>时间预算（毫秒）</span>
          <input v-model.number="store.form.engineTimeMs" type="number" min="1" />
        </label>
        <label class="field">
          <span>搜索超时（毫秒）</span>
          <input v-model.number="store.form.searchTimeoutMs" type="number" min="1" />
        </label>
      </template>
      <template v-if="store.form.kind === 'ExpectimaxNnue'">
        <label class="field">
          <span>预算模式</span>
          <select v-model="store.form.nnueBudgetMode">
            <option value="depth">深度</option>
            <option value="time">用时</option>
          </select>
        </label>
        <label v-if="store.form.nnueBudgetMode === 'depth'" class="field">
          <span>确定性深度</span>
          <input v-model.number="store.form.nnueDeterministicDepth" type="number" min="1" />
        </label>
        <label v-if="store.form.nnueBudgetMode === 'depth'" class="field">
          <span>Chance 展开深度</span>
          <input v-model.number="store.form.nnueChanceOutcomeDepth" type="number" min="0" />
        </label>
        <label v-if="store.form.nnueBudgetMode === 'time'" class="field">
          <span>时间预算（毫秒）</span>
          <input v-model.number="store.form.nnueTimeMs" type="number" min="1" />
        </label>
        <label class="field">
          <span>搜索超时（毫秒）</span>
          <input v-model.number="store.form.searchTimeoutMs" type="number" min="1" />
        </label>
      </template>
      <div class="btn-row">
        <button class="primary" :disabled="store.loading" @click="create">创建 Agent</button>
        <button :disabled="store.loading" @click="refreshModels">刷新模型</button>
      </div>
    </div>

    <p v-if="store.agents.length === 0" class="hint">暂无 Agent，请在上方创建。</p>
    <p v-else class="hint">已创建的 Agent 以浮动窗口展示，可拖动标题栏移动、点击「—」收起。</p>

    <!-- 每个已创建的 Agent 渲染为一个可拖动的浮动窗口 -->
    <Teleport to="body">
      <AgentWindow v-for="(agent, i) in store.agents" :key="agent.id" :index="i">
        <template #head>
          <strong>{{ kindLabel(agent) }}</strong>
          <span class="agent-meta">{{ agent.variant }}</span>
          <span v-if="agent.model_file" class="agent-meta">{{ agent.model_file }}</span>
          <span
            v-if="boundAgent('red') === agent.id || boundAgent('black') === agent.id"
            class="pill agent-bound"
          >
            托管中（{{ boundAgent('red') === agent.id ? '红方' : '黑方' }}）
          </span>
          <button class="danger" title="删除该 Agent" @click="remove(agent)">删除</button>
        </template>

        <!-- 搜索配置：唯一可实时调整的字段 -->
        <div class="agent-settings">
        <label v-if="agent.mcts_sims !== undefined" class="field">
          <span>搜索次数</span>
          <input v-model.number="draftOf(agent).mcts_sims" type="number" min="1" />
        </label>
        <label
          v-if="agent.kind === 'Expectimax' && draftOf(agent).engine_budget_mode"
          class="field"
        >
          <span>预算模式</span>
          <select v-model="draftOf(agent).engine_budget_mode">
            <option value="depth">深度</option>
            <option value="time">用时</option>
          </select>
        </label>
        <label
          v-if="agent.kind === 'Expectimax' && draftOf(agent).engine_budget_mode === 'depth'"
          class="field"
        >
          <span>确定性深度</span>
          <input v-model.number="draftOf(agent).engine_deterministic_depth" type="number" min="1" />
        </label>
        <label
          v-if="agent.kind === 'Expectimax' && draftOf(agent).engine_budget_mode === 'depth'"
          class="field"
        >
          <span>Chance 展开深度</span>
          <input v-model.number="draftOf(agent).engine_chance_outcome_depth" type="number" min="0" />
        </label>
        <label
          v-if="agent.kind === 'Expectimax' && draftOf(agent).engine_budget_mode === 'time'"
          class="field"
        >
          <span>时间预算（毫秒）</span>
          <input v-model.number="draftOf(agent).engine_time_ms" type="number" min="1" />
        </label>
        <label
          v-if="agent.kind === 'ExpectimaxNnue' && agent.budget_mode"
          class="field"
        >
          <span>预算模式</span>
          <select v-model="draftOf(agent).nnue_budget_mode">
            <option value="depth">深度</option>
            <option value="time">用时</option>
          </select>
        </label>
        <label
          v-if="agent.kind === 'ExpectimaxNnue' && draftOf(agent).nnue_budget_mode === 'depth'"
          class="field"
        >
          <span>确定性深度</span>
          <input v-model.number="draftOf(agent).nnue_deterministic_depth" type="number" min="1" />
        </label>
        <label
          v-if="agent.kind === 'ExpectimaxNnue' && draftOf(agent).nnue_budget_mode === 'depth'"
          class="field"
        >
          <span>Chance 展开深度</span>
          <input v-model.number="draftOf(agent).nnue_chance_outcome_depth" type="number" min="0" />
        </label>
        <label
          v-if="agent.kind === 'ExpectimaxNnue' && draftOf(agent).nnue_budget_mode === 'time'"
          class="field"
        >
          <span>时间预算（毫秒）</span>
          <input v-model.number="draftOf(agent).nnue_time_ms" type="number" min="1" />
        </label>
        <label v-if="agent.search_timeout_ms !== undefined" class="field">
          <span>搜索超时（毫秒）</span>
          <input v-model.number="draftOf(agent).search_timeout_ms" type="number" min="1" />
        </label>
        <button v-if="agent.mcts_sims !== undefined || agent.budget_mode !== undefined" @click="applySettings(agent)">
          应用配置
        </button>
      </div>

      <div class="btn-row">
        <button :disabled="store.loading || !game.state" @click="suggest(agent)">建议</button>
        <button :disabled="store.loading || !game.state || game.busy" @click="step(agent)">单步</button>
        <button :disabled="store.loading || !game.state || boundAgent('red') === agent.id" @click="bind(agent, 'red')">
          托管红方
        </button>
        <button :disabled="store.loading || !game.state || boundAgent('black') === agent.id" @click="bind(agent, 'black')">
          托管黑方
        </button>
        <button :disabled="store.loading || !game.state" @click="unbind('red')">解除红方</button>
        <button :disabled="store.loading || !game.state" @click="unbind('black')">解除黑方</button>
      </div>
      <p v-if="agent.variant !== game.state?.variant" class="hint warn">
        该 Agent 的变体（{{ agent.variant }}）与当前对局（{{ game.state?.variant }}）不一致，
        建议 / 单步 / 托管将被服务端拒绝。
      </p>

      <!-- 纯网络贪心：建议的 WDL/mw/ml 独立分量明细 -->
      <div
        v-if="agent.kind === 'NnueGreedy' && greedyDetail"
        class="nnue-greedy-detail"
      >
        <p class="nnue-greedy-v">
          V(s) = {{ greedyDetail.v.value.toFixed(4) }}
          = p_w·mw − p_l·ml
          = {{ greedyDetail.v.wdl[2].toFixed(3) }}·{{ greedyDetail.v.mw.toFixed(3) }}
          − {{ greedyDetail.v.wdl[0].toFixed(3) }}·{{ greedyDetail.v.ml.toFixed(3) }}
          <span class="nnue-greedy-probs">
            （p_l {{ greedyDetail.v.wdl[0].toFixed(3) }} / p_d {{ greedyDetail.v.wdl[1].toFixed(3) }}
            / p_w {{ greedyDetail.v.wdl[2].toFixed(3) }}）
          </span>
        </p>
        <table class="nnue-greedy-table">
          <thead>
            <tr>
              <th>动作</th>
              <th>p_l</th><th>p_d</th><th>p_w</th>
              <th>mw</th><th>ml</th><th>Q</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in greedyDetail.actions"
              :key="a.action"
              :class="{ best: a.action === game.suggestion?.action }"
            >
              <td>{{ actionLabel(a) }}</td>
              <td>{{ a.q.wdl[0].toFixed(3) }}</td>
              <td>{{ a.q.wdl[1].toFixed(3) }}</td>
              <td>{{ a.q.wdl[2].toFixed(3) }}</td>
              <td>{{ a.q.mw.toFixed(3) }}</td>
              <td>{{ a.q.ml.toFixed(3) }}</td>
              <td>{{ a.q.value.toFixed(4) }}</td>
            </tr>
          </tbody>
        </table>
        <p class="hint">Q = p_w·mw − p_l·ml（合成前各独立项）；按 Q 降序，选中行 = 建议动作。</p>
      </div>
      </AgentWindow>
    </Teleport>
  </section>
</template>

<style scoped>
.agents-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.agent-create {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 8px;
}
.agent-meta {
  font-size: 12px;
  opacity: 0.7;
}
.agent-bound {
  font-size: 11px;
}
.agent-settings {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: flex-end;
}
.agent-settings .field {
  margin: 0;
  min-width: 90px;
}
.hint.warn {
  color: #f7c06b;
}
.nnue-greedy-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nnue-greedy-v {
  margin: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.nnue-greedy-probs {
  opacity: 0.7;
}
.nnue-greedy-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.nnue-greedy-table th,
.nnue-greedy-table td {
  padding: 2px 4px;
  text-align: right;
}
.nnue-greedy-table th:first-child,
.nnue-greedy-table td:first-child {
  text-align: left;
}
.nnue-greedy-table thead th {
  opacity: 0.7;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}
.nnue-greedy-table tr.best {
  background: rgba(102, 187, 106, 0.18);
}
button.danger {
  margin-left: auto;
}
</style>
