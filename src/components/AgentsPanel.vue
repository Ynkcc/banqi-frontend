<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { AgentView } from '../api/types';
import { strategyNeedsModel } from '../api/types';
import { variantsReady } from '../domain/variants';
import { useAgents } from '../composables/useAgents';
import { useGame } from '../composables/useGame';
import { useSettings } from '../composables/useSettings';

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
      <label v-if="store.form.kind === 'MctsOnnx' || store.form.kind === 'MctsDL'" class="field">
        <span>搜索次数</span>
        <input v-model.number="store.form.mctsSims" type="number" min="1" />
      </label>
      <label v-if="store.form.kind === 'Expectimax'" class="field">
        <span>节点预算</span>
        <input v-model.number="store.form.engineBudget" type="number" min="1" />
      </label>
      <template v-if="store.form.kind === 'ExpectimaxNnue'">
        <label class="field">
          <span>预算模式</span>
          <select v-model="store.form.nnueBudgetMode">
            <option value="nodes">纯节点预算</option>
            <option value="depth_nodes">深度 + 节点预算</option>
            <option value="time">用时</option>
          </select>
        </label>
        <label v-if="store.form.nnueBudgetMode !== 'time'" class="field">
          <span>节点预算</span>
          <input v-model.number="store.form.nnueBudget" type="number" min="1" />
        </label>
        <label v-if="store.form.nnueBudgetMode === 'depth_nodes'" class="field">
          <span>搜索深度</span>
          <input v-model.number="store.form.nnueDepth" type="number" min="1" />
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

    <div v-for="agent in store.agents" :key="agent.id" class="agent-card">
      <div class="agent-head">
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
      </div>

      <!-- 搜索配置：唯一可实时调整的字段 -->
      <div class="agent-settings">
        <label v-if="agent.mcts_sims !== undefined" class="field">
          <span>搜索次数</span>
          <input v-model.number="draftOf(agent).mcts_sims" type="number" min="1" />
        </label>
        <label v-if="agent.engine_budget !== undefined" class="field">
          <span>节点预算</span>
          <input v-model.number="draftOf(agent).engine_budget" type="number" min="1" />
        </label>
        <label v-if="agent.budget_mode" class="field">
          <span>预算模式</span>
          <select v-model="draftOf(agent).nnue_budget_mode">
            <option value="nodes">纯节点预算</option>
            <option value="depth_nodes">深度 + 节点预算</option>
            <option value="time">用时</option>
          </select>
        </label>
        <label v-if="agent.budget_mode && draftOf(agent).nnue_budget_mode !== 'time'" class="field">
          <span>节点预算</span>
          <input v-model.number="draftOf(agent).nnue_budget" type="number" min="1" />
        </label>
        <label
          v-if="agent.budget_mode && draftOf(agent).nnue_budget_mode === 'depth_nodes'"
          class="field"
        >
          <span>搜索深度</span>
          <input v-model.number="draftOf(agent).nnue_depth" type="number" min="1" />
        </label>
        <label v-if="agent.budget_mode && draftOf(agent).nnue_budget_mode === 'time'" class="field">
          <span>时间预算（毫秒）</span>
          <input v-model.number="draftOf(agent).nnue_time_ms" type="number" min="1" />
        </label>
        <label v-if="agent.search_timeout_ms !== undefined" class="field">
          <span>搜索超时（毫秒）</span>
          <input v-model.number="draftOf(agent).search_timeout_ms" type="number" min="1" />
        </label>
        <button v-if="agent.mcts_sims !== undefined || agent.engine_budget !== undefined || agent.budget_mode !== undefined" @click="applySettings(agent)">
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
    </div>
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
.agent-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}
.agent-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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
button.danger {
  margin-left: auto;
}
</style>
