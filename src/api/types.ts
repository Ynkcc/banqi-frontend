/** 后端 API 契约的单一真源（与 banqi-server DTO serde 序列化逐字段对应，snake_case 直传）。 */

export type Player = 'Red' | 'Black';
export type Slot = 'Empty' | 'Hidden' | string; // 明子格式: "R_Sol" / "B_Gen" ...

export interface GameState {
  board: Slot[];
  current_player: Player;
  move_counter: number;
  total_step_counter: number;
  dead_red: string[];
  dead_black: string[];
  hidden_red: string[];
  hidden_black: string[];
  action_masks: number[];
  reveal_probabilities: number[];
  bitboards: Record<string, boolean[]>;
  hp_red: number;
  hp_black: number;
  variant: string; // 稳定标识，与 banqi-core Variant::as_str() 一致
  /**
   * 当前局面 BFEN 文本（两后端均下发）：复制 / 粘贴重建 / issue 复现用。
   * 不编码 last_action 与 true_board（见 banqi-core fen.rs）。
   */
  fen?: string;
  /**
   * 是否可悔棋（两后端均下发）：悔棋仅在当前行棋方尚未行动时可用，
   * 每次回到自己上次行动前，可连续触发以反悔所有自己的行动。
   */
  can_undo?: boolean;
  /**
   * 决策历史（棋谱，两后端均下发）：每手棋的实际执行结果。
   * 翻棋 / 吃暗子（含炮打暗子）附实际翻出的棋子；悔棋后由后端同步截断。
   */
  history?: HistoryMove[];
  /** server 扩展：红/黑双方选手槽位（Human 或策略托管配置）。 */
  slots?: SlotsView;
  /** server 扩展：当前行棋方是否为策略（true 时可 run 单步 / auto 循环）。 */
  can_run?: boolean;
  /** server 扩展：单调递增版本号（dry-run 建议等基于版本对齐，防过期） */
  version?: number;
  /** server 扩展：对局是否结束（终局或步数截断；自动对弈循环的停止条件） */
  over?: boolean;
}

// ============================================================================
// 选手槽位（对局与玩家/策略解耦的契约核心）
// ============================================================================

/** 策略种类（与 banqi-server `StrategyKind::as_str` 一致；Human 槽位为 "Human"）。 */
export type StrategyKind =
  | 'Random'
  | 'RevealFirst'
  | 'CaptureFirst'
  | 'Expectimax'
  | 'ExpectimaxNnue'
  | 'MctsOnnx'
  | 'MctsDL';

/** 槽位种类："Human"（用户本人操作）、任意策略，或绑定 Agent 实体。 */
export type SlotKind = 'Human' | 'Agent' | StrategyKind;

/** 需要绑定模型的策略（模型类策略）。 */
export function strategyNeedsModel(kind: StrategyKind): boolean {
  return kind === 'ExpectimaxNnue' || kind === 'MctsOnnx' || kind === 'MctsDL';
}

/** 单个选手槽位视图（对齐 banqi-server `SlotView`）。 */
export interface SlotView {
  kind: SlotKind;
  /** Agent 槽位绑定的 Agent ID（其余为 undefined；实际策略由 Agent 实时持有） */
  agent_id?: string;
  /** 模型类策略绑定的模型文件 */
  model_file?: string;
  mcts_sims?: number;
  engine_budget?: number;
  budget_mode?: string;
  nnue_depth?: number;
  nnue_budget?: number;
  nnue_time_ms?: number;
  search_timeout_ms?: number;
}

/** 红/黑双方槽位视图（对齐 banqi-server `SlotsView`）。 */
export interface SlotsView {
  red: SlotView;
  black: SlotView;
}

/** 槽位配置请求（建局 / 对局中 PUT /slots 共用）。 */
export interface SlotCfg {
  kind: SlotKind;
  /** 模型类策略绑定的模型文件（缺省按变体自动匹配） */
  model_file?: string;
  /** kind = 'Agent' 时必填：绑定 Agent 实体（其策略/搜索配置实时生效） */
  agent_id?: string;
}

/** Agent（玩家实体）视图：创建后只读，仅搜索参数可实时调整。 */
export interface AgentView {
  id: string;
  /** 适用的棋盘变体 ID（参与对局时须一致） */
  variant: string;
  kind: SlotKind;
  model_file?: string;
  mcts_sims?: number;
  engine_budget?: number;
  budget_mode?: string;
  nnue_depth?: number;
  nnue_budget?: number;
  nnue_time_ms?: number;
  search_timeout_ms?: number;
}

/** 创建 Agent 请求。 */
export interface CreateAgentCfg {
  variant: string;
  kind: SlotKind;
  model_file?: string;
  params?: AgentParamsCfg;
}

/** Agent 搜索参数（全字段可选，缺省取服务器当前默认值；实时调整用同一形状）。 */
export interface AgentParamsCfg {
  mcts_sims?: number;
  engine_budget?: number;
  nnue_budget_mode?: NnueBudgetMode;
  nnue_depth?: number;
  nnue_budget?: number;
  nnue_time_ms?: number;
  search_timeout_ms?: number;
}

/** 双方槽位配置（red / black 均必填，Human 用 { kind: 'Human' }）。 */
export interface SlotsCfg {
  red: SlotCfg;
  black: SlotCfg;
}

/** POST /games/:id/dry-run 响应：当前行棋方策略的建议走法（不落子）。 */
export interface Suggestion {
  /** 建议产生时的对局版本号（前端据此丢弃过期建议） */
  version: number;
  player: string;
  action: number;
  /** 源格（翻棋时 == to） */
  from: number;
  to: number;
  is_chance: boolean;
  is_flip: boolean;
  is_capture: boolean;
  /** 根评估值（行棋方视角；不可用时缺省） */
  score?: number;
  mcts_stats?: MctsSearchStats;
  nnue_stats?: NnueSearchStats;
}

/** 一手棋的决策记录（棋谱项）。棋子字段为前端短码格式（"R_Sol" / "B_Gen" …）。 */
export interface HistoryMove {
  /** 手数（1 起，对局内单调递增） */
  ply: number;
  player: Player;
  action: number;
  /** 源格（翻棋时 == to） */
  from: number;
  to: number;
  is_flip: boolean;
  /** 机会动作（翻棋 / 吃暗子，结果有随机性） */
  is_chance: boolean;
  /** 吃明子（目标是对方已翻开的明子） */
  is_capture: boolean;
  /** 机会动作实际翻出的棋子（翻棋 = 翻出的子；吃暗子含炮打暗子 = 打出的子） */
  revealed?: string;
  /** 被消灭的棋子（吃明子的被吃子；吃暗子时 == revealed） */
  captured?: string;
}

export interface StepResult {
  state: GameState;
  terminated: boolean;
  truncated: boolean;
  winner: number;
  /** MCTS 类策略携带本次搜索统计 */
  mcts_stats?: MctsSearchStats;
  /** ExpectimaxNnue 策略携带本次搜索统计 */
  nnue_stats?: NnueSearchStats;
}

/** 一次 Gumbel MCTS 搜索的统计摘要（日志栏展示用）。 */
export interface MctsSearchStats {
  reused: boolean;
  budget: number;
  actual_sims: number;
  max_depth: number;
  nodes: number;
  /** 搜索本体（mcts.run()）耗时（毫秒，两后端均下发） */
  elapsed_ms: number;
}

/** 一次 Expectimax 搜索的统计摘要（日志栏展示用，REST 后端 Nnue 对手下发）。 */
export interface NnueSearchStats {
  /** 推理后端标识（恒为 "nnue"） */
  engine: string;
  /** 生效的预算模式："nodes" / "depth_nodes" / "time"（旧后端可能不下发） */
  mode?: string;
  /** 请求的迭代加深深度上限（0 = 不限，由预算/超时控制） */
  depth: number;
  /** 请求的节点预算（0 = 不限） */
  budget: number;
  /** 生效的时间上限毫秒（模式时间与硬超时的较小者；旧后端可能不下发） */
  time_limit_ms?: number;
  /** 实际消耗的节点数 */
  nodes: number;
  /** 完成的最深迭代层数 */
  reached_depth: number;
  /** 搜索本体耗时（毫秒） */
  elapsed_ms: number;
}

/** Expectimax 搜索预算模式（与 banqi-app BudgetMode 契约一致）。 */
export type NnueBudgetMode = 'nodes' | 'depth_nodes' | 'time';

/** PUT /api/settings 返回：引擎搜索参数生效快照（camelCase）。 */
export interface EngineSettings {
  mctsSims: number;
  engineBudget: number;
  /** NNUE 预算模式 */
  nnueBudgetMode?: NnueBudgetMode;
  nnueDepth: number;
  nnueBudget: number;
  /** NNUE 时间预算毫秒（time 模式生效） */
  nnueTimeMs?: number;
  /** 搜索硬超时毫秒（全模式必选生效） */
  searchTimeoutMs?: number;
}

export type Variant = string; // 后端 list_variants 下发，不再前端枚举

/** list_variants 返回：由 banqi-core 单一真源给出的变体元信息。 */
export interface VariantInfo {
  id: string;
  label: string;
  rows: number;
  cols: number;
  initial_health: number;
  max_consecutive_moves_for_draw: number;
}

export interface ModelEntry {
  name: string;
  path: string;
}

/** GET /api/models 返回：服务器模型目录及其中的模型文件。 */
export interface ModelList {
  dir: string;
  models: ModelEntry[];
}

/** 后端编译期启用的推理后端（torch = TorchScript/MctsDL，onnx = MctsOnnx；nnue 恒可用）。 */
export interface Capabilities {
  torch: boolean;
  onnx: boolean;
  /** NNUE 推理（无外部依赖） */
  nnue?: boolean;
}

export interface MctsEdge {
  child_id: number;
  action: number;
  prior: number;
  logit: number;
  n: number;
  q: number;
  health_q: number;
  is_chance: boolean;
  chance_prob: number;
}

export interface MctsNodeSummary {
  id: number;
  n: number;
  q: number;
  health_q: number;
  player: Player;
  is_chance: boolean;
  is_terminal: boolean;
  is_expanded: boolean;
  edge_count: number;
}

export interface MctsRootInfo {
  root: MctsNodeSummary;
  chosen_action: number;
  stats: MctsSearchStats;
}

/** GET /api/games/:id/mcts/node/:node/board 返回：某节点保存的完整局面（信息状态视角）+ 到达该节点的着法所在格。 */
export interface MctsNodeBoard {
  state: GameState;
  move_coords: number[];
}

export interface MctsNodeDetail {
  id: number;
  prior: number;
  logit: number;
  n: number;
  q: number;
  health_q: number;
  initial_value: number;
  player: Player;
  is_chance: boolean;
  is_terminal: boolean;
  is_expanded: boolean;
  child_count: number;
  outcome_count: number;
}

// ============================================================================
// Expectimax 搜索轨迹树（Alpha-Beta 搜索轨迹，非完整博弈树）
// ============================================================================

/** 值界类型：exact = 精确值，lower/upper = fail-high/low 界，unknown = 未完成节点。 */
export type ExFlag = 'exact' | 'lower' | 'upper' | 'unknown';

/** 截断 / 剪枝标记：tt = TT 命中截断（子树未展开），razor = razoring，nmp = null-move。 */
export type ExMark = 'tt' | 'razor' | 'nmp';

/** 父节点到子节点的搜索轨迹边。`value` 已换算到父节点视角（= -child.value）。 */
export interface ExEdge {
  child_id: number;
  action: number;
  value: number;
  is_chance: boolean;
  chance_prob: number;
  is_outcome: boolean;
  depth: number;
  flag: ExFlag;
  mark: ExMark | null;
  child_count: number;
}

export interface ExNodeSummary {
  id: number;
  action: number;
  /** 自身走子方视角值（[-1,1]） */
  value: number;
  alpha: number;
  beta: number;
  depth: number;
  flag: ExFlag;
  mark: ExMark | null;
  is_chance: boolean;
  is_outcome: boolean;
  chance_prob: number;
  is_root: boolean;
  is_null_probe: boolean;
  player: string;
  child_count: number;
}

export interface ExSearchStats {
  mode: string;
  depth: number;
  budget: number;
  time_limit_ms: number;
  nodes: number;
  reached_depth: number;
  elapsed_ms: number;
}

export interface ExRootInfo {
  root: ExNodeSummary;
  chosen_action: number;
  stats: ExSearchStats;
}

/** GET /api/games/:id/nnue/node/:node/board 返回：节点局面 + 到达着法所在格。 */
export interface ExNodeBoard {
  state: GameState;
  move_coords: number[];
}
