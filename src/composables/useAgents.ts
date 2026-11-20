// ============================================================================
// Agent（玩家实体）管理：创建 / 只读展示 / 搜索配置实时调整 / 建议与单步 / 托管
//
// Agent = 命名的策略配置（变体 + 类型 + 模型 + 可实时调整的搜索配置）。
// - 创建后只读，仅搜索配置可实时调整（对所有绑定它的对局立即生效）；
// - 每个 Agent 卡片提供「建议 / 单步」按钮：与托管阵营无关，
//   永远作用于当前行动方（服务端 dry-run / run 带 agentId 实现）；
// - 「建议」同样写入对局的建议高亮（复用 useGame 的 suggestion，version 对齐）；
// - 「托管红方 / 黑方」= 把该 Agent 绑定到对局对应槽位（PUT /slots，kind: "Agent"）。
// ============================================================================

import { reactive } from 'vue';
import { api } from '../api/client';
import type {
  AgentParamsCfg,
  AgentView,
  EngineBudgetMode,
  SlotKind,
  StrategyKind,
} from '../api/types';
import { normalizeBudgetMode } from '../api/types';
import { strategyNeedsModel } from '../api/types';
import { appendLog } from './useLogs';
import { useToast } from './useToast';
import { useGame } from './useGame';

const toast = useToast();

interface AgentCreateForm {
  variant: string;
  kind: SlotKind;
  modelFile: string;
  mctsSims: number;
  /** Expectimax（规则评估器）预算模式：depth | time */
  engineBudgetMode: EngineBudgetMode;
  /** 确定性搜索深度 */
  engineDeterministicDepth: number;
  /** chance 节点展开深度：0 = 直接以 Q(s,a) 评估该局面；>0 = 递归展开全部 outcome（按确定性深度续搜，子树内 chance 以 depth-1 递归），叶子静态评估 = max_a Q(s,a) */
  engineChanceOutcomeDepth: number;
  engineTimeMs: number;
  nnueBudgetMode: EngineBudgetMode;
  nnueDeterministicDepth: number;
  /** chance 节点展开深度（递归语义同 engineChanceOutcomeDepth） */
  nnueChanceOutcomeDepth: number;
  nnueTimeMs: number;
  searchTimeoutMs: number;
}

const AGENT_KINDS: { value: StrategyKind; label: string; feature?: 'torch' | 'onnx' }[] = [
  { value: 'Random', label: '随机' },
  { value: 'RevealFirst', label: '优先翻棋' },
  { value: 'CaptureFirst', label: '优先吃子' },
  { value: 'MctsDL', label: 'MCTS+DL', feature: 'torch' },
  { value: 'MctsOnnx', label: 'MCTS+ONNX', feature: 'onnx' },
  { value: 'MctsNnue', label: 'MCTS+NNUE' },
  { value: 'Expectimax', label: 'Expectimax' },
  { value: 'ExpectimaxNnue', label: 'Expectimax+NNUE' },
  { value: 'NnueGreedy', label: '纯网络贪心' },
];

interface AgentsStore {
  agents: AgentView[];
  loading: boolean;
  /** 建 Agent 表单 */
  form: AgentCreateForm;
  /** Agent 卡片内实时编辑的搜索配置（agentId → 部分 AgentParamsCfg） */
  drafts: Record<string, AgentParamsCfg>;
}

const store = reactive<AgentsStore>({
  agents: [],
  loading: false,
  form: {
    variant: '4x8',
    kind: 'ExpectimaxNnue',
    modelFile: '',
    mctsSims: 200,
    engineBudgetMode: 'depth',
    engineDeterministicDepth: 8,
    engineChanceOutcomeDepth: 1,
    engineTimeMs: 5000,
    nnueBudgetMode: 'depth',
    nnueDeterministicDepth: 8,
    nnueChanceOutcomeDepth: 1,
    nnueTimeMs: 5000,
    searchTimeoutMs: 60000,
  },
  drafts: {},
});

/** 该策略种类的可选模型清单（由 useSettings 提供模型目录扫描结果）。 */
function modelsFor(kind: SlotKind, ptModels: { path: string }[], nnueModels: { path: string }[]) {
  if (kind === 'ExpectimaxNnue' || kind === 'NnueGreedy' || kind === 'MctsNnue') return nnueModels;
  if (kind === 'MctsOnnx' || kind === 'MctsDL') return ptModels;
  return [];
}

/** 由表单组装搜索参数（按策略种类裁剪，未用字段不下发）。 */
function formParams(form: AgentCreateForm): AgentParamsCfg {
  if (form.kind === 'MctsOnnx' || form.kind === 'MctsDL' || form.kind === 'MctsNnue') {
    return { mcts_sims: form.mctsSims };
  }
  if (form.kind === 'Expectimax') {
    return {
      engine_budget_mode: form.engineBudgetMode,
      engine_deterministic_depth: form.engineDeterministicDepth,
      engine_chance_outcome_depth: form.engineChanceOutcomeDepth,
      engine_time_ms: form.engineTimeMs,
      search_timeout_ms: form.searchTimeoutMs,
    };
  }
  if (form.kind === 'ExpectimaxNnue') {
    return {
      nnue_budget_mode: form.nnueBudgetMode,
      nnue_deterministic_depth: form.nnueDeterministicDepth,
      nnue_chance_outcome_depth: form.nnueChanceOutcomeDepth,
      nnue_time_ms: form.nnueTimeMs,
      search_timeout_ms: form.searchTimeoutMs,
    };
  }
  return {};
}

async function refresh() {
  store.loading = true;
  try {
    store.agents = await api.listAgents();
  } catch (e) {
    toast.error('获取 Agent 列表失败: ' + e);
  } finally {
    store.loading = false;
  }
}

async function create() {
  const form = store.form;
  try {
    const agent = await api.createAgent({
      variant: form.variant,
      kind: form.kind,
      ...(strategyNeedsModel(form.kind as StrategyKind) && form.modelFile
        ? { model_file: form.modelFile }
        : {}),
      params: formParams(form),
    });
    appendLog(`创建 Agent: ${agent.kind}（${agent.variant}${agent.model_file ? `，${agent.model_file}` : ''}）`);
    toast.success('Agent 已创建', 2000);
    await refresh();
    return agent;
  } catch (e) {
    toast.error('创建 Agent 失败: ' + e, 5000);
  }
}

async function remove(agent: AgentView) {
  try {
    await api.deleteAgent(agent.id);
    appendLog(`删除 Agent: ${agent.kind}（${agent.id.slice(0, 8)}…）`);
    await refresh();
  } catch (e) {
    toast.error('删除 Agent 失败: ' + e);
  }
}

/** Agent 卡片内的搜索配置草稿（首次编辑时初始化为当前生效值）。 */
function draftOf(agent: AgentView): AgentParamsCfg {
  if (!store.drafts[agent.id]) {
    if (agent.kind === 'Expectimax') {
      // Expectimax（规则评估器）：编辑 engine_* 预算族
      // （budget_mode 兼容读取旧值 "depth_nodes"/"nodes"，统一按 "depth" 处理）
      store.drafts[agent.id] = {
        ...(agent.budget_mode
          ? { engine_budget_mode: normalizeBudgetMode(agent.budget_mode) }
          : {}),
        ...(agent.deterministic_depth !== undefined
          ? { engine_deterministic_depth: agent.deterministic_depth }
          : {}),
        ...(agent.chance_outcome_depth !== undefined
          ? { engine_chance_outcome_depth: agent.chance_outcome_depth }
          : {}),
        ...(agent.budget_time_ms !== undefined
          ? { engine_time_ms: agent.budget_time_ms }
          : {}),
        ...(agent.search_timeout_ms !== undefined
          ? { search_timeout_ms: agent.search_timeout_ms }
          : {}),
      };
    } else {
      store.drafts[agent.id] = {
        ...(agent.mcts_sims !== undefined ? { mcts_sims: agent.mcts_sims } : {}),
        ...(agent.budget_mode
          ? { nnue_budget_mode: normalizeBudgetMode(agent.budget_mode) }
          : {}),
        ...(agent.deterministic_depth !== undefined
          ? { nnue_deterministic_depth: agent.deterministic_depth }
          : {}),
        ...(agent.chance_outcome_depth !== undefined
          ? { nnue_chance_outcome_depth: agent.chance_outcome_depth }
          : {}),
        ...(agent.budget_time_ms !== undefined ? { nnue_time_ms: agent.budget_time_ms } : {}),
        ...(agent.search_timeout_ms !== undefined
          ? { search_timeout_ms: agent.search_timeout_ms }
          : {}),
      };
    }
  }
  return store.drafts[agent.id];
}

/** 实时应用搜索配置（唯一可变字段；对所有绑定该 Agent 的对局立即生效）。 */
async function applySettings(agent: AgentView) {
  try {
    const updated = await api.updateAgentSettings(agent.id, draftOf(agent));
    appendLog(
      `Agent 搜索配置已更新: ${agent.kind}（${JSON.stringify(draftOf(agent))}），对绑定对局实时生效`,
    );
    toast.success('搜索配置已生效', 2000);
    const i = store.agents.findIndex((a) => a.id === agent.id);
    if (i >= 0) store.agents[i] = updated;
  } catch (e) {
    toast.error('更新搜索配置失败: ' + e);
  }
}

/** 建议：以该 Agent 配置为当前行动方请求建议走法并高亮（不落子，不依赖托管阵营）。 */
async function suggest(agent: AgentView) {
  const { store: game } = useGame();
  if (!game.state) {
    toast.info('尚未创建对局', 1500);
    return;
  }
  try {
    game.suggestion = null;
    const suggestion = await api.dryRun(undefined, undefined, agent.id);
    if (game.state && suggestion.version === game.state.version) {
      game.suggestion = suggestion;
      const desc = suggestion.is_flip
        ? `翻棋 位置${suggestion.to}`
        : `位置${suggestion.from} → 位置${suggestion.to}`;
      const scoreText = suggestion.score !== undefined ? `（评分 ${suggestion.score.toFixed(3)}）` : '';
      appendLog(`[Agent] ${agent.kind} 为${suggestion.player === 'Red' ? '红方' : '黑方'}建议: ${desc}${scoreText}`);
    }
  } catch (e) {
    toast.error('Agent 建议失败: ' + e);
  }
}

/** 单步：以该 Agent 配置为当前行动方执行一步（不依赖托管阵营，Human 方亦可）。 */
async function step(agent: AgentView) {
  try {
    await runStepWith(agent.id);
  } catch (e) {
    toast.error('Agent 单步失败: ' + e);
  }
}

/** 内部：按 agentId 单步（与 useGame.applyStep 同步同一最小状态集，附带搜索统计日志）。 */
async function runStepWith(agentId: string) {
  const { store: game } = useGame();
  if (!game.state || game.busy) return;
  game.busy = true;
  try {
    const result = await api.runStep(agentId);
    game.lastResult = result;
    game.state = result.state;
    game.selectedSquare = null;
    game.moveHighlights = new Map();
    game.canUndo = !!result.state.can_undo;
    game.inspectPly = null;
    game.suggestion = null;
    if (result.mcts_stats)
      appendLog(`[MCTS] ${result.mcts_stats.reused ? '复用' : '全新'} ${result.mcts_stats.actual_sims} 次模拟，${result.mcts_stats.elapsed_ms}ms`);
    if (result.nnue_stats)
      appendLog(`[Expectimax] 深度 ${result.nnue_stats.reached_depth}，${result.nnue_stats.nodes} 节点，${result.nnue_stats.elapsed_ms}ms`);
  } finally {
    game.busy = false;
  }
}

/** 托管：把该 Agent 绑定到对局的指定阵营槽位。 */
async function bind(agent: AgentView, side: 'red' | 'black') {
  const { applySlots } = useGame();
  await applySlots({ [side]: { kind: 'Agent', agent_id: agent.id } });
}

/** 解除托管：把指定阵营槽位切回本人操作。 */
async function unbind(side: 'red' | 'black') {
  const { applySlots } = useGame();
  await applySlots({ [side]: { kind: 'Human' } });
}

export function useAgents() {
  return {
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
  };
}
