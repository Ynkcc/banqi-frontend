<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { variantsReady } from '../domain/variants';
import { useGame } from '../composables/useGame';
import { useSettings } from '../composables/useSettings';

const { store, resetGame, copyFen, loadFen, undoMove } = useGame();
const { settings, modelsDir, refreshModels } = useSettings();

// 变体列表由后端 list_variants 下发（banqi-core 单一真源），前端不再硬编码。
const VARIANTS = ref<{ value: string; label: string }[]>([]);
onMounted(async () => {
  const infos = await variantsReady;
  VARIANTS.value = infos.map((v) => ({ value: v.id, label: v.label }));
});

function onNewGame() {
  // 建局默认双方均为本人操作；红/黑策略托管请在 Agent 面板创建 Agent 后
  // 使用「托管红方 / 托管黑方」（对局中随时可切换）。
  resetGame({ red: { kind: 'Human' }, black: { kind: 'Human' } }, settings.variant);
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
