/** 后端 Tauri command 返回的数据结构（与 src-tauri/src/main.rs 中 serde 序列化一一对应）。 */

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
  /** server 契约字段（camelCase→snake_case 适配）：是否轮到 AI 行动。Tauri 后端为 undefined。 */
  ai_to_move?: boolean;
  /**
   * 是否可悔棋（两后端均下发）：悔棋仅在当前行棋方尚未行动时可用，
   * 每次回到自己上次行动前，可连续触发以反悔所有自己的行动（PvP 同语义）。
   */
  can_undo?: boolean;
  /**
   * 决策历史（棋谱，两后端均下发）：每手棋的实际执行结果。
   * 翻棋 / 吃暗子（含炮打暗子）附实际翻出的棋子；悔棋后由后端同步截断。
   */
  history?: HistoryMove[];
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
  /** MCTS 对手时携带本次搜索统计，其他对手为 undefined */
  mcts_stats?: MctsSearchStats;
  /** NNUE 对手（REST 后端）时携带本次搜索统计，其他对手为 undefined */
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

/** 一次 NNUE Expectimax 搜索的统计摘要（日志栏展示用，REST 后端 Nnue 对手下发）。 */
export interface NnueSearchStats {
  /** 推理后端标识（恒为 "nnue"） */
  engine: string;
  /** 请求的迭代加深深度上限 */
  depth: number;
  /** 请求的节点预算 */
  budget: number;
  /** 实际消耗的节点数 */
  nodes: number;
  /** 完成的最深迭代层数 */
  reached_depth: number;
  /** 搜索本体耗时（毫秒） */
  elapsed_ms: number;
}

/** set_engine_settings 返回：引擎搜索参数生效快照（Tauri 后端，camelCase）。 */
export interface EngineSettings {
  mctsSims: number;
  engineBudget: number;
  nnueDepth: number;
  nnueBudget: number;
}

export type Opponent =
  | 'PvP'
  | 'Random'
  | 'RevealFirst'
  | 'CaptureFirst'
  | 'Engine'
  | 'MctsDL'
  | 'MctsOnnx'
  | 'Nnue';

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

/** list_models 返回：固定模型目录（~/banqi-models）及其中的模型文件。 */
export interface ModelList {
  dir: string;
  models: ModelEntry[];
}

/** 后端编译期启用的推理后端（torch = TorchScript/MctsDL，onnx = MctsOnnx；nnue 恒可用）。 */
export interface Capabilities {
  torch: boolean;
  onnx: boolean;
  /** NNUE 推理（无外部依赖）；Tauri 旧版后端可能不下发该字段 */
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

/** mcts_get_node_board 返回：某节点保存的完整局面（信息状态视角）+ 到达该节点的着法所在格。 */
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
