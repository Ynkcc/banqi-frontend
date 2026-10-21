import { reactive, ref, watch } from 'vue';
import { api } from '../api/client';
import type { Capabilities, ModelEntry, NnueBudgetMode, Opponent, Variant } from '../api/types';
import { appendLog } from './useLogs';
import { useToast } from './useToast';

const toast = useToast();

// ============================================================================
// 设置持久化（localStorage）：变体 / 对手 / 各引擎参数 / 选中模型随页面刷新保留。
// ============================================================================

const STORAGE_KEY = 'banqi:settings:v1';

const DEFAULTS = {
  variant: '4x8' as Variant,
  opponent: 'PvP' as Opponent,
  engineLevel: 300000,
  mctsIters: 200,
  /** NNUE 预算模式：纯节点预算 / 深度+节点预算 / 用时 */
  nnueBudgetMode: 'depth_nodes' as NnueBudgetMode,
  nnueDepth: 8,
  nnueBudget: 200000,
  /** NNUE 时间预算毫秒（time 模式生效） */
  nnueTimeMs: 5000,
  /** 搜索硬超时毫秒（全模式必选生效，默认 60s；仅 REST 后端可调） */
  searchTimeoutMs: 60000,
  /** 选中的 MCTS 模型（.pt / .onnx），随设置持久化 */
  ptModel: '',
  /** 选中的 NNUE 模型（.nnue），随设置持久化 */
  nnueModel: '',
};

const NNUE_BUDGET_MODES: NnueBudgetMode[] = ['nodes', 'depth_nodes', 'time'];

const NNUE_MODE_LABELS: Record<NnueBudgetMode, string> = {
  nodes: '纯节点预算',
  depth_nodes: '深度+节点预算',
  time: '用时',
};

const OPPONENT_VALUES: Opponent[] = [
  'PvP',
  'Random',
  'RevealFirst',
  'CaptureFirst',
  'MctsDL',
  'MctsOnnx',
  'Engine',
  'Nnue',
];

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asPosInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 读取并清洗持久化数据：类型不符 / 非法值回退默认（localStorage 内容不可信）。 */
function loadPersisted(): Partial<typeof DEFAULTS> {
  try {
    const raw: Record<string, unknown> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const opponent = asStr(raw.opponent);
    const nnueBudgetMode = asStr(raw.nnueBudgetMode);
    return {
      variant: asStr(raw.variant),
      opponent: opponent && OPPONENT_VALUES.includes(opponent as Opponent)
        ? (opponent as Opponent)
        : undefined,
      engineLevel: asPosInt(raw.engineLevel, DEFAULTS.engineLevel),
      mctsIters: asPosInt(raw.mctsIters, DEFAULTS.mctsIters),
      nnueBudgetMode: nnueBudgetMode && NNUE_BUDGET_MODES.includes(nnueBudgetMode as NnueBudgetMode)
        ? (nnueBudgetMode as NnueBudgetMode)
        : undefined,
      nnueDepth: asPosInt(raw.nnueDepth, DEFAULTS.nnueDepth),
      nnueBudget: asPosInt(raw.nnueBudget, DEFAULTS.nnueBudget),
      nnueTimeMs: asPosInt(raw.nnueTimeMs, DEFAULTS.nnueTimeMs),
      searchTimeoutMs: asPosInt(raw.searchTimeoutMs, DEFAULTS.searchTimeoutMs),
      ptModel: asStr(raw.ptModel),
      nnueModel: asStr(raw.nnueModel),
    };
  } catch {
    return {};
  }
}

const settings = reactive({ ...DEFAULTS, ...loadPersisted() });

watch(
  settings,
  (s) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // 隐私模式 / 配额不足时静默放弃持久化，功能不受影响
    }
  },
  { deep: true },
);

const capabilities = reactive<Capabilities>({ torch: false, onnx: false });
const ptModels = ref<ModelEntry[]>([]);
const nnueModels = ref<ModelEntry[]>([]);
const modelsLoading = ref(false);
/** 固定模型目录（~/banqi-models）的绝对路径，由后端在启动时确定 */
const modelsDir = ref('');

/** 读取后端编译期启用的推理后端（.pt 需 torch，.onnx 需 onnx，.nnue 无依赖）。 */
async function loadCapabilities() {
  try {
    Object.assign(capabilities, await api.getCapabilities());
  } catch (e) {
    console.error('get_capabilities failed:', e);
    toast.error('读取引擎能力失败: ' + e);
  }
}

function modelUsable(path: string): boolean {
  const p = path.toLowerCase();
  if (p.endsWith('.pt')) return capabilities.torch;
  if (p.endsWith('.onnx')) return capabilities.onnx;
  return true;
}

async function refreshModels() {
  modelsLoading.value = true;
  try {
    const { dir, models: all } = await api.listModels();
    modelsDir.value = dir;
    const models = all.filter((m) => modelUsable(m.path));
    ptModels.value = models.filter((m) => !m.path.toLowerCase().endsWith('.nnue'));
    nnueModels.value = models.filter((m) => m.path.toLowerCase().endsWith('.nnue'));
  } catch (e) {
    console.error('list_models failed:', e);
    toast.error('加载模型列表失败: ' + e);
  } finally {
    modelsLoading.value = false;
  }
}

/** 在系统文件管理器中打开固定模型目录（把模型复制进去后点「刷新列表」即可）。 */
async function openModelsDir() {
  try {
    await api.openModelsDir();
  } catch (e) {
    console.error('open_models_dir failed:', e);
    toast.error('打开模型目录失败: ' + e);
  }
}

async function applyEngineBudget(): Promise<boolean> {
  try {
    const result = await api.setEngineBudget(settings.engineLevel);
    appendLog(`强引擎节点预算已设置为 ${result}`);
    toast.success(`强引擎节点预算已设置为 ${result}`);
    return true;
  } catch (e) {
    toast.error('设置失败: ' + e);
    return false;
  }
}

async function applyMctsIters(): Promise<boolean> {
  try {
    const result = await api.setMctsIterations(settings.mctsIters);
    settings.mctsIters = result;
    appendLog(`MCTS 搜索次数已设置为 ${result}`);
    toast.success('MCTS 搜索次数已设置为 ' + result);
    return true;
  } catch (e) {
    toast.error('设置失败: ' + e);
    return false;
  }
}

async function applyNnue(): Promise<boolean> {
  try {
    const s = await api.setNnueSettings({
      mode: settings.nnueBudgetMode,
      depth: settings.nnueDepth,
      budget: settings.nnueBudget,
      timeMs: settings.nnueTimeMs,
      timeoutMs: settings.searchTimeoutMs,
    });
    // 回填服务器钳制后的生效值（REST 下发全量快照；Tauri 仅深度/节点预算）
    settings.nnueDepth = s.nnueDepth;
    settings.nnueBudget = s.nnueBudget;
    if (s.nnueBudgetMode) settings.nnueBudgetMode = s.nnueBudgetMode;
    if (typeof s.nnueTimeMs === 'number') settings.nnueTimeMs = s.nnueTimeMs;
    if (typeof s.searchTimeoutMs === 'number') settings.searchTimeoutMs = s.searchTimeoutMs;
    const modeLabel = NNUE_MODE_LABELS[settings.nnueBudgetMode];
    const detail =
      settings.nnueBudgetMode === 'time'
        ? `时限 ${settings.nnueTimeMs} ms`
        : `深度 ${settings.nnueDepth} / 节点预算 ${settings.nnueBudget}`;
    appendLog(
      `NNUE 设置已应用（${modeLabel}）：${detail}，硬超时 ${settings.searchTimeoutMs} ms`,
    );
    toast.success(`NNUE 设置已应用（${modeLabel}）：${detail}`);
    return true;
  } catch (e) {
    toast.error('设置失败: ' + e);
    return false;
  }
}

async function loadModel(path: string): Promise<boolean> {
  try {
    const result = await api.loadModel(path);
    appendLog(result);
    toast.success('模型加载成功：' + result);
    return true;
  } catch (e) {
    toast.error('模型加载失败：' + e, 5000);
    return false;
  }
}

export function useSettings() {
  return {
    settings,
    capabilities,
    loadCapabilities,
    ptModels,
    nnueModels,
    modelsLoading,
    modelsDir,
    refreshModels,
    openModelsDir,
    applyEngineBudget,
    applyMctsIters,
    applyNnue,
    loadModel,
  };
}
