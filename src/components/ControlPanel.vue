<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { variantsReady } from '../domain/variants';
import { useGame } from '../composables/useGame';
import { useSettings } from '../composables/useSettings';
import { api } from '../api/client';
import type { OpeningScenarioCfg, ScenarioInfo, ScenarioParamInfo } from '../api/types';
import { useToast } from '../composables/useToast';

const { store, resetGame, copyFen, loadFen, undoMove } = useGame();
const { settings, modelsDir, refreshModels } = useSettings();
const toast = useToast();

// 变体列表由后端 list_variants 下发（banqi-core 单一真源），前端不再硬编码。
const VARIANTS = ref<{ value: string; label: string }[]>([]);
onMounted(async () => {
  const infos = await variantsReady;
  VARIANTS.value = infos.map((v) => ({ value: v.id, label: v.label }));
});

// ============================================================================
// 开局场景：前端零硬编码——支持矩阵、场景名称 / 说明 / 参数 schema 全部由
// 后端 GET /api/scenarios 下发（banqi-core 场景注册表单一真源），本组件按
// schema 动态渲染选择项与参数输入；未选择场景时走标准初始化行为。
// ============================================================================

/** 变体 → 支持的场景元信息（后端矩阵）。 */
const scenariosByVariant = ref<Record<string, ScenarioInfo[]>>({});
onMounted(async () => {
  try {
    const rows = await api.listScenarios();
    const map: Record<string, ScenarioInfo[]> = {};
    for (const r of rows) map[r.variant] = r.scenarios;
    scenariosByVariant.value = map;
  } catch (e) {
    console.error('list_scenarios failed, scenario picker disabled', e);
  }
});

const SCENARIO_NONE = '';
const scenarioId = ref<string>(SCENARIO_NONE);
/** 当前变体支持的场景选项（无则仅「标准开局」）。 */
const scenarioOptions = computed<ScenarioInfo[]>(
  () => scenariosByVariant.value[settings.variant] ?? [],
);
/** 当前选中场景的元信息（含参数 schema；未选择时为 null）。 */
const selectedScenario = computed<ScenarioInfo | null>(
  () => scenarioOptions.value.find((s) => s.id === scenarioId.value) ?? null,
);

// 场景参数输入（键 = 参数名；字符串输入，建局时统一解析校验）
const paramInputs = ref<Record<string, string>>({});

/** 切换场景 / 变体时重建参数输入（有缺省值的参数预填缺省值）。 */
function resetParamInputs(info: ScenarioInfo | null) {
  const inputs: Record<string, string> = {};
  if (info) {
    for (const p of info.params) {
      if (p.default_value !== null) inputs[p.name] = String(p.default_value);
    }
  }
  paramInputs.value = inputs;
}
watch(scenarioId, () => resetParamInputs(selectedScenario.value));

// 切换变体后当前选择不再受支持时自动回退标准开局
watch(
  () => settings.variant,
  () => {
    if (scenarioId.value !== SCENARIO_NONE && !selectedScenario.value) {
      scenarioId.value = SCENARIO_NONE;
    }
  },
);

function parseParam(raw: string, p: ScenarioParamInfo): number {
  const t = raw.trim();
  if (!t) throw new Error(`请填写「${p.label}」`);
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) throw new Error(`「${p.label}」须为非负整数`);
  return n;
}

/** 由表单按所选场景的参数 schema 组装请求体（未选择场景时返回 undefined）。 */
function buildScenario(): OpeningScenarioCfg | undefined {
  const info = selectedScenario.value;
  if (!info) return undefined;
  const cfg: OpeningScenarioCfg = { kind: info.id };
  for (const p of info.params) {
    const raw = (paramInputs.value[p.name] ?? '').trim();
    if (!raw) {
      if (p.required) throw new Error(`请填写「${p.label}」`);
      continue; // 可选参数留空即省略（缺省语义由后端处理）
    }
    cfg[p.name] = parseParam(raw, p);
  }
  return cfg;
}

function onNewGame() {
  // 建局默认双方均为本人操作；红/黑策略托管请在 Agent 面板创建 Agent 后
  // 使用「托管红方 / 托管黑方」（对局中随时可切换）。
  let scenario: OpeningScenarioCfg | undefined;
  try {
    scenario = buildScenario();
  } catch (e) {
    toast.error((e as Error)?.message ?? String(e), 2500);
    return;
  }
  resetGame({ red: { kind: 'Human' }, black: { kind: 'Human' } }, settings.variant, scenario);
}

/** 粘贴重建：输入框里的 BFEN 局面串非空才可触发（槽位配置沿用当前设置）。 */
const fenInput = ref('');
async function onLoadFen() {
  if (!fenInput.value.trim()) return;
  await loadFen(fenInput.value);
}
</script>

<template>
  <div class="control-panel">
    <section class="panel-card">
      <h3>对局设置</h3>
      <label class="field">
        <span>变体</span>
        <select v-model="settings.variant">
          <option v-for="v in VARIANTS" :key="v.value" :value="v.value">{{ v.label }}</option>
        </select>
      </label>
      <label class="field">
        <span>开局场景</span>
        <select v-model="scenarioId">
          <option :value="''">标准开局（随机）</option>
          <option v-for="s in scenarioOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </label>
      <template v-if="selectedScenario">
        <div class="scenario-params">
          <label v-for="p in selectedScenario.params" :key="p.name" class="field">
            <span>{{ p.label }}{{ p.required ? ' *' : '' }}</span>
            <input
              v-model="paramInputs[p.name]"
              inputmode="numeric"
              :placeholder="p.required ? '必填' : '可选'"
            />
          </label>
        </div>
        <p class="hint">{{ selectedScenario.description }}。格位 = 行 × 列数 + 列。</p>
      </template>
      <div class="btn-row">
        <button class="primary" :disabled="store.busy" @click="onNewGame">开始新游戏</button>
        <button :disabled="store.busy || !store.canUndo" @click="undoMove">悔棋</button>
      </div>
      <p class="hint">
        红方 / 黑方策略托管：在下方 Agent 面板创建 Agent 后使用「托管红方 / 托管黑方」，
        对局中随时可切换或解除；「建议 / 单步」永远作用于当前行动方。
      </p>
    </section>

    <section class="panel-card">
      <h3>局面 FEN</h3>
      <div class="btn-row">
        <button :disabled="store.busy || !store.state?.fen" @click="copyFen">复制当前局面</button>
        <button :disabled="store.busy || !fenInput.trim()" @click="onLoadFen">粘贴重建对局</button>
      </div>
      <textarea
        v-model="fenInput"
        class="fen-input"
        rows="3"
        spellcheck="false"
        placeholder="在此粘贴 BFEN 局面串（可先「复制当前局面」取得）…"
      ></textarea>
      <p class="hint">BFEN 含变体、盘面、行棋方、血量与暗子袋；重建后走子历史清空。</p>
    </section>

    <section class="panel-card">
      <h3>模型目录</h3>
      <p class="hint">服务器模型目录（含子目录）：把 .pt / .onnx / .nnue 文件放入后，点「刷新模型」即可在创建 Agent 时选中。</p>
      <div class="btn-row">
        <button :disabled="store.busy" @click="refreshModels">刷新模型</button>
      </div>
      <p class="hint">{{ modelsDir || '读取中…' }}</p>
    </section>
  </div>
</template>

<style scoped>
.scenario-params {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 8px 0;
}
.scenario-params input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  font-size: 12px;
}
.fen-input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  padding: 6px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.4;
  resize: vertical;
  word-break: break-all;
}
</style>
