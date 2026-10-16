<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Opponent } from '../api/types';
import { variantsReady } from '../domain/variants';
import { useGame } from '../composables/useGame';
import { useSettings } from '../composables/useSettings';
import { useToast } from '../composables/useToast';

const { store, resetGame, copyFen, loadFen, undoMove } = useGame();
const {
  settings,
  capabilities,
  ptModels,
  nnueModels,
  modelsDir,
  refreshModels,
  openModelsDir,
  applyEngineBudget,
  applyMctsIters,
  applyNnue,
  loadModel,
} = useSettings();
const toast = useToast();

const ALL_OPPONENTS: { value: Opponent; label: string; feature?: 'torch' | 'onnx' }[] = [
  { value: 'PvP', label: '本地双人 (PvP)' },
  { value: 'Random', label: '随机' },
  { value: 'RevealFirst', label: '优先翻棋' },
  { value: 'CaptureFirst', label: '优先吃子' },
  { value: 'MctsDL', label: 'MCTS+DL', feature: 'torch' },
  { value: 'MctsOnnx', label: 'MCTS+ONNX', feature: 'onnx' },
  { value: 'Engine', label: 'Expectimax' },
  { value: 'Nnue', label: 'Expectimax+NNUE' },
];

// 仅展示后端已编译进去的推理后端对应的对手
const OPPONENTS = computed(() =>
  ALL_OPPONENTS.filter((o) => o.feature === undefined || capabilities[o.feature]),
);

// 变体列表由后端 list_variants 下发（banqi-core 单一真源），前端不再硬编码。
const VARIANTS = ref<{ value: string; label: string }[]>([]);
onMounted(async () => {
  const infos = await variantsReady;
  VARIANTS.value = infos.map((v) => ({ value: v.id, label: v.label }));
});

const ENGINE_LEVELS = [
  { value: 50000, label: '轻量（5万节点）' },
  { value: 300000, label: '标准（30万节点）' },
  { value: 1000000, label: '深度（100万节点）' },
  { value: 3000000, label: '极深（300万节点）' },
];

function showEngineSettings(): boolean {
  return settings.opponent === 'Engine';
}
function showMctsSettings(): boolean {
  return settings.opponent === 'MctsDL' || settings.opponent === 'MctsOnnx';
}
function showNnueSettings(): boolean {
  return settings.opponent === 'Nnue';
}

const mctsModelHint = computed(() =>
  capabilities.torch
    ? '先加载模型（.pt 走 MCTS+DL，.onnx 走 MCTS+ONNX），再选择对应对手开始新游戏。'
    : '先加载 .onnx 模型（走 MCTS+ONNX），再选择对应对手开始新游戏。',
);

function onNewGame() {
  // 用户选择的模型与对局绑定（REST 后端建局时按 modelFile 加载；
  // Tauri 后端经「加载模型」按钮绑定，忽略该参数）
  resetGame(settings.opponent, settings.variant, settings.ptModel || undefined);
}

async function onLoadPtModel() {
  const finalPath = settings.ptModel;
  if (!finalPath) {
    toast.error('请先在列表中选择模型');
    return;
  }
  if (await loadModel(finalPath)) {
    settings.opponent = finalPath.toLowerCase().endsWith('.onnx') ? 'MctsOnnx' : 'MctsDL';
  }
}

async function onLoadNnueModel() {
  const finalPath = settings.nnueModel;
  if (!finalPath) {
    toast.error('请先在列表中选择 .nnue 模型');
    return;
  }
  if (await loadModel(finalPath)) {
    settings.opponent = 'Nnue';
  }
}

/** 粘贴重建：输入框里的 BFEN 局面串非空才可触发。 */
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
        <span>对手</span>
        <select v-model="settings.opponent">
          <option v-for="o in OPPONENTS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <div class="btn-row">
        <button class="primary" :disabled="store.busy" @click="onNewGame">开始新游戏</button>
        <button :disabled="store.busy || !store.canUndo" @click="undoMove">悔棋</button>
      </div>
      <p class="hint">悔棋回到当前行棋方上次行动前，可连续悔棋反悔自己的所有行动。</p>
    </section>

    <section v-if="showEngineSettings()" class="panel-card">
      <h3>强引擎设置</h3>
      <label class="field">
        <span>难度</span>
        <select v-model.number="settings.engineLevel">
          <option v-for="l in ENGINE_LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </label>
      <button @click="applyEngineBudget">应用难度</button>
      <p class="hint">αβ + Star1 + 置换表 + 迭代加深，节点预算越高越强、耗时越长。</p>
    </section>

    <section v-if="showMctsSettings()" class="panel-card">
      <h3>MCTS+DL 设置（TorchScript / ONNX）</h3>
      <label class="field">
        <span>模型</span>
        <select v-model="settings.ptModel">
          <option v-if="ptModels.length === 0" value="">未找到 .pt / .onnx 模型</option>
          <option v-for="m in ptModels" :key="m.path" :value="m.path">{{ m.path }}</option>
        </select>
      </label>
      <div class="btn-row">
        <button :disabled="store.busy" @click="refreshModels">刷新列表</button>
        <button :disabled="store.busy" @click="onLoadPtModel">加载模型</button>
      </div>
      <label class="field">
        <span>搜索次数</span>
        <input v-model.number="settings.mctsIters" type="number" min="1" />
      </label>
      <button @click="applyMctsIters">应用搜索次数</button>
      <p class="hint">{{ mctsModelHint }}</p>
    </section>

    <section v-if="showNnueSettings()" class="panel-card">
      <h3>NNUE 设置（Expectimax + .nnue）</h3>
      <label class="field">
        <span>模型</span>
        <select v-model="settings.nnueModel">
          <option v-if="nnueModels.length === 0" value="">未找到 .nnue 模型</option>
          <option v-for="m in nnueModels" :key="m.path" :value="m.path">{{ m.path }}</option>
        </select>
      </label>
      <div class="btn-row">
        <button :disabled="store.busy" @click="refreshModels">刷新列表</button>
        <button :disabled="store.busy" @click="onLoadNnueModel">加载模型</button>
      </div>
      <label class="field">
        <span>搜索深度</span>
        <input v-model.number="settings.nnueDepth" type="number" min="1" />
      </label>
      <label class="field">
        <span>节点预算</span>
        <input v-model.number="settings.nnueBudget" type="number" min="1" />
      </label>
      <button @click="applyNnue">应用设置</button>
      <p class="hint">模型特征维度需与所选变体匹配。</p>
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
      <p class="hint">把 .pt / .onnx / .nnue 文件复制到此目录（含子目录）后，点上方「刷新列表」即可选中。</p>
      <p class="hint">{{ modelsDir || '读取中…' }}</p>
      <button :disabled="store.busy" @click="openModelsDir">打开模型目录</button>
    </section>
  </div>
</template>

<style scoped>
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
