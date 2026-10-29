import { reactive, ref, watch } from 'vue';
import { api } from '../api/client';
import type { Capabilities, ModelEntry, Variant } from '../api/types';
import { useToast } from './useToast';

const toast = useToast();

// ============================================================================
// 设置持久化（localStorage）：变体随页面刷新保留。
// ============================================================================

const STORAGE_KEY = 'banqi:settings:v3';

const DEFAULTS = {
  variant: '4x8' as Variant,
};

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** 读取并清洗持久化数据：类型不符 / 非法值回退默认（localStorage 内容不可信）。 */
function loadPersisted(): Partial<typeof DEFAULTS> {
  try {
    const raw: Record<string, unknown> = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      variant: asStr(raw.variant),
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

const capabilities = reactive<Capabilities>({ torch: false, onnx: false, nnue: false });
const ptModels = ref<ModelEntry[]>([]);
const nnueModels = ref<ModelEntry[]>([]);
const modelsLoading = ref(false);
/** 服务器模型目录的绝对路径（--models 参数），由后端下发 */
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
  };
}
