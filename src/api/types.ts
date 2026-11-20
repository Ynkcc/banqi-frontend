// ============================================================================
// 后端 API 契约（单一真源：banqi-server 的 ts-rs 生成物）
//
// 契约类型全部来自 `./generated/`（由 Rust DTO 派生，逐字段对应 serde 序列化）：
//   cd banqi-server && cargo test -p bqsrv-dto -p bqsrv-app export_bindings
// 生成物勿手改；本文件仅做三件事：
//   ① re-export 生成类型（前后端命名的别名映射）；
//   ② 保留纯前端领域类型（Player / Slot / 策略枚举等，后端以 String 下发）；
//   ③ 保留请求构建辅助类型（SlotCfg 等，client.ts 组装 camelCase 请求体用）。
// ============================================================================

// ----------------------------------------------------------------------------
// 生成物 re-export（括号内为 Rust DTO 名）
// ----------------------------------------------------------------------------

/** 机器可读错误码（error.code 字段，catch 分支处理用）。 */
export type { ApiErrorCode } from './generated/ApiErrorCode';

export type { ActionView } from './generated/ActionView';
export type { AgentResp as AgentView } from './generated/AgentResp';
export type { AgentsListResp } from './generated/AgentsListResp';
export type { AppliedAction } from './generated/AppliedAction';
export type { ArchivedGameSummary } from './generated/ArchivedGameSummary';
export type { ArchivedGameDetail } from './generated/ArchivedGameDetail';
export type { CapabilitiesResp as Capabilities } from './generated/CapabilitiesResp';
export type { EngineMoveResp } from './generated/EngineMoveResp';
export type { ExEdge } from './generated/ExEdge';
export type { ExNodeBoard } from './generated/ExNodeBoard';
export type { ExNodeSummary } from './generated/ExNodeSummary';
export type { ExRootInfo } from './generated/ExRootInfo';
export type { ExSearchStats } from './generated/ExSearchStats';
export type { GameCreatedResp } from './generated/GameCreatedResp';
export type { GameListResp } from './generated/GameListResp';
export type { GameSummary } from './generated/GameSummary';
/** 完整对局状态响应（GameStateResp，含 GameStateView flatten 内联字段）。 */
export type { GameStateResp as GameState } from './generated/GameStateResp';
export type { GameStateView } from './generated/GameStateView';
export type { HealthResp } from './generated/HealthResp';
/** 双方剩余暗子按类型计数（定长 7 元组：兵0 炮1 马2 车3 象4 将6）。 */
export type { HiddenBagDto as HiddenBag } from './generated/HiddenBagDto';
export type { HistoryMoveView as HistoryMove } from './generated/HistoryMoveView';
export type { ModelEntryDto as ModelEntry } from './generated/ModelEntryDto';
export type { ModelInfo } from './generated/ModelInfo';
export type { ModelListResp as ModelList } from './generated/ModelListResp';
export type { MoveActionResp } from './generated/MoveActionResp';
/** 一手棋落子结果（MoveResp；winner: number | null）。 */
export type { MoveResp as StepResult } from './generated/MoveResp';
export type { MctsEdge } from './generated/MctsEdge';
export type { MctsNodeBoard } from './generated/MctsNodeBoard';
export type { MctsNodeDetail } from './generated/MctsNodeDetail';
export type { MctsNodeSummary } from './generated/MctsNodeSummary';
export type { MctsRootInfo } from './generated/MctsRootInfo';
export type { MctsStatsDto as MctsSearchStats } from './generated/MctsStatsDto';
export type { MctsStatsDto as MctsStats } from './generated/MctsStatsDto';
export type { NnueStatsDto as NnueSearchStats } from './generated/NnueStatsDto';
export type { NnueStatsDto as NnueStats } from './generated/NnueStatsDto';
export type { NnueBranchDto as NnueBranch } from './generated/NnueBranchDto';
export type { NnueGreedyActionDto as NnueGreedyAction } from './generated/NnueGreedyActionDto';
export type { NnueGreedyDto as NnueGreedy } from './generated/NnueGreedyDto';
/** 开局场景请求体（tag = "kind" 内部标签联合）。 */
export type { OpeningScenario } from './generated/OpeningScenario';
export type { RecentGamesResp } from './generated/RecentGamesResp';
export type { ReplayActionDto as ReplayAction } from './generated/ReplayActionDto';
export type { ReplayResp } from './generated/ReplayResp';
export type { ReplayStepDto as ReplayStep } from './generated/ReplayStepDto';
export type { ScenarioInfo } from './generated/ScenarioInfo';
export type { ScenarioParamInfo } from './generated/ScenarioParamInfo';
export type { ScenariosResp } from './generated/ScenariosResp';
/** PUT /api/settings 返回的引擎参数生效快照（camelCase）。 */
export type { SettingsResp as EngineSettings } from './generated/SettingsResp';
export type { SlotView } from './generated/SlotView';
export type { SlotsView } from './generated/SlotsView';
export type { StepStatsDto as StepStats } from './generated/StepStatsDto';
/** dry-run 建议走法（SuggestionResp）。 */
export type { SuggestionResp as Suggestion } from './generated/SuggestionResp';
export type { VariantInfo } from './generated/VariantInfo';
export type { VariantScenarios } from './generated/VariantScenarios';

// ----------------------------------------------------------------------------
// 纯前端领域类型（后端以 String / number 下发，此处做语义收窄；不参与 JSON 契约）
// ----------------------------------------------------------------------------

export type Player = 'Red' | 'Black';
export type Slot = 'Empty' | 'Hidden' | string; // 明子格式: "R_Sol" / "B_Gen" ...

/** 策略种类（与 banqi-server `StrategyKind::as_str` 一致；Human 槽位为 "Human"）。 */
export type StrategyKind =
  | 'Random'
  | 'RevealFirst'
  | 'CaptureFirst'
  | 'Expectimax'
  | 'ExpectimaxNnue'
  | 'NnueGreedy'
  | 'MctsOnnx'
  | 'MctsDL'
  | 'MctsNnue';

/** 槽位种类："Human"（用户本人操作）、任意策略，或绑定 Agent 实体。 */
export type SlotKind = 'Human' | 'Agent' | StrategyKind;

/** 需要绑定模型的策略（模型类策略）。 */
export function strategyNeedsModel(kind: StrategyKind): boolean {
  return (
    kind === 'ExpectimaxNnue' ||
    kind === 'NnueGreedy' ||
    kind === 'MctsOnnx' ||
    kind === 'MctsDL' ||
    kind === 'MctsNnue'
  );
}

/** Expectimax 搜索预算模式（与 banqi-app BudgetMode 契约一致）。 */
export type EngineBudgetMode = 'depth' | 'time';

/**
 * 兼容读取：旧合同 budget_mode 的 "depth_nodes"（深度+节点预算）与 "nodes"
 * （纯节点预算）在新口径下统一按 "depth" 处理（节点预算已移除）。
 */
export function normalizeBudgetMode(v: string | undefined | null): EngineBudgetMode {
  return v === 'time' ? 'time' : 'depth';
}

/** 值界类型：exact = 精确值，lower/upper = fail-high/low 界，unknown = 未完成节点。 */
export type ExFlag = 'exact' | 'lower' | 'upper' | 'unknown';

/** 截断 / 剪枝标记：tt = TT 命中截断（子树未展开），razor = razoring，nmp = null-move。 */
export type ExMark = 'tt' | 'razor' | 'nmp';

export type Variant = string; // 后端 list_variants 下发，不再前端枚举

// ----------------------------------------------------------------------------
// 请求构建辅助类型（client.ts 组装 camelCase 请求体用；服务器侧对应
// SlotReq / CreateAgentReq / SlotParamsReq 等，均由生成物覆盖）
// ----------------------------------------------------------------------------

/** 槽位配置请求（建局 / 对局中 PUT /slots 共用）。 */
export interface SlotCfg {
  kind: SlotKind;
  /** 模型类策略绑定的模型文件（缺省按变体自动匹配） */
  model_file?: string;
  /** kind = 'Agent' 时必填：绑定 Agent 实体（其策略/搜索配置实时生效） */
  agent_id?: string;
}

/** 双方槽位配置（red / black 均必填，Human 用 { kind: 'Human' }）。 */
export interface SlotsCfg {
  red: SlotCfg;
  black: SlotCfg;
}

/** 创建 Agent 请求。 */
export interface CreateAgentCfg {
  variant: string;
  kind: SlotKind;
  model_file?: string;
  params?: AgentParamsCfg;
}

/** Agent 搜索参数（全字段可选，缺省取服务器当前默认值；实时调整用同一形状）。
 *  预算口径：budget_mode = "depth" | "time"；depth 模式用确定性深度 +
 *  chance outcome 展开深度两个参数，节点数输入已移除。 */
export interface AgentParamsCfg {
  mcts_sims?: number;
  engine_budget_mode?: EngineBudgetMode;
  engine_deterministic_depth?: number;
  engine_chance_outcome_depth?: number;
  engine_time_ms?: number;
  nnue_budget_mode?: EngineBudgetMode;
  nnue_deterministic_depth?: number;
  nnue_chance_outcome_depth?: number;
  nnue_time_ms?: number;
  search_timeout_ms?: number;
}

/**
 * 开局场景请求体（POST /api/games 的 `scenario` 字段）。
 *
 * 形态：`{ kind: <场景标识>, <参数名>: <格位/数量>, ... }`，键集合由所选
 * 场景的 params schema 决定（必填项必须给出；可选项留空即省略）。
 * 严格契约见生成类型 `OpeningScenario`；本类型供面板动态组装时透传。
 */
export interface OpeningScenarioCfg {
  kind: string;
  [param: string]: number | string | undefined;
}
