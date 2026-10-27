// ============================================================================
// 统一后端 API 客户端（HTTP REST，banqi-server）
//
// 契约真源：`types.ts`（与 banqi-server DTO 逐字段对齐，snake_case 直传，
// 无适配层）。契约与路线图见 docs/backend-api.md。
//
// 选手槽位协议：红/黑各自独立配置为 Human 或任意策略（对局与玩家/策略解耦）；
// run 单步 / dry-run 建议 / auto 由前端循环调用 run 实现。
// ============================================================================

import type {
  AgentParamsCfg,
  AgentView,
  ArchivedGameDetail,
  ArchivedGameSummary,
  Capabilities,
  CreateAgentCfg,
  EngineSettings,
  ExEdge,
  ExNodeBoard,
  ExNodeSummary,
  ExRootInfo,
  GameState,
  MctsEdge,
  MctsNodeBoard,
  MctsNodeDetail,
  MctsRootInfo,
  ModelList,
  NnueBudgetMode,
  OpeningScenarioCfg,
  ReplayResp,
  ScenariosResp,
  SlotCfg,
  SlotsCfg,
  SlotsView,
  StepResult,
  Suggestion,
  Variant,
  VariantInfo,
  VariantScenarios,
} from './types';

/** NNUE 预算设置输入（setNnueSettings 统一入参；未给出的字段保持服务器当前值）。 */
export interface NnueSettingsInput {
  mode?: NnueBudgetMode;
  depth?: number;
  budget?: number;
  timeMs?: number;
  timeoutMs?: number;
}

/** GET /api/games/:id/move-action 响应。 */
interface MoveActionResp {
  action: number | null;
}

class RestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestError';
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const base = import.meta.env.VITE_API_BASE ?? '';
  const resp = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const body = await resp.json();
      // server 错误体: { error: { code, message } }
      detail = body?.error?.message ?? body?.error ?? detail;
    } catch {
      /* 非 JSON 错误体，保留状态行 */
    }
    throw new RestError(detail);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

/// 当前对局 ID（server 是多会话资源模型，前端单对局持有一个 ID）
let currentGameId: string | null = null;

function requireGameId(): string {
  if (!currentGameId) throw new RestError('尚未创建对局（先 resetGame）');
  return currentGameId;
}

/** 最近一次建局使用的槽位配置（loadFen 沿用当前槽位设置）。 */
let lastSlots: SlotsCfg = { red: { kind: 'Human' }, black: { kind: 'Human' } };

/** 由状态响应记录当前槽位配置（粘贴重建等场景沿用）。 */
function recordSlotsFromState(state: { slots?: SlotsView }): void {
  if (!state.slots) return;
  lastSlots = {
    red: { kind: state.slots.red.kind, model_file: state.slots.red.model_file },
    black: { kind: state.slots.black.kind, model_file: state.slots.black.model_file },
  };
}

/** 槽位配置 → 请求体片段（Human 只带 kind；模型类策略附模型文件；
 *  Agent 槽位附 agentId）。
 *  请求 DTO 为 camelCase（与 CreateGameReq 一致）；状态响应为 snake_case。 */
function slotBody(cfg: SlotCfg): Record<string, unknown> {
  const body: Record<string, unknown> = { kind: cfg.kind };
  if (cfg.agent_id) body.agentId = cfg.agent_id;
  if (cfg.model_file && cfg.kind !== 'Human' && cfg.kind !== 'Agent') {
    body.modelFile = cfg.model_file;
  }
  return body;
}

/** 统一 API（HTTP REST）。 */
export const api = {
  async resetGame(
    slots: SlotsCfg,
    variant: Variant,
    fen?: string,
    scenario?: OpeningScenarioCfg,
  ): Promise<GameState> {
    const created = await http<{ game_id: string; state: GameState }>('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        // 变体缺省（BFEN 重建时以 BFEN 自带标识为准）
        ...(variant ? { variant } : {}),
        // 红/黑槽位独立配置：双方 Human 即原本地双人；模型类策略绑定的模型
        // 随槽位下发（缺省时服务端按变体 ID 自动匹配唯一候选）
        slots: {
          red: slotBody(slots.red),
          black: slotBody(slots.black),
        },
        // BFEN 与开局场景互斥（BFEN 已携带完整局面）
        ...(fen ? { fen } : scenario ? { scenario } : {}),
      }),
    });
    currentGameId = created.game_id;
    lastSlots = slots;
    recordSlotsFromState(created.state);
    return created.state;
  },
  async loadFen(fen: string): Promise<GameState> {
    // 由 BFEN 局面串重建对局：变体以 BFEN 自带标识为准；走子历史从空开始。
    // 槽位配置沿用当前设置（模型类策略沿用绑定模型，缺省时服务端自动匹配）。
    return api.resetGame(lastSlots, '', fen);
  },
  async stepGame(action: number): Promise<StepResult> {
    const id = requireGameId();
    const resp = await http<StepResult>(`/api/games/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    recordSlotsFromState(resp.state);
    return resp;
  },
  /**
   * 单步推进：当前行棋方按其槽位策略执行一步（Human 方返回 409 HUMAN_TURN）。
   * `agentId` 指定 Agent 时以其当前配置为当前行棋方执行一步——
   * 单步永远作用于当前行动方，与该 Agent 托管哪方无关。
   */
  async runStep(agentId?: string): Promise<StepResult> {
    const id = requireGameId();
    const resp = await http<StepResult>(`/api/games/${id}/run`, {
      method: 'POST',
      body: JSON.stringify(agentId ? { agentId } : {}),
    });
    recordSlotsFromState(resp.state);
    return resp;
  },
  /**
   * dry-run：当前行棋方策略建议走法（不落子）。
   * `agentId` 指定 Agent 时以其当前配置为当前行棋方计算建议——
   * 建议永远作用于当前行动方，与该 Agent 托管哪方无关。
   * 未指定且当前方为 Human 时可用 kind/modelFile 指定提示策略。
   */
  async dryRun(kind?: string, modelFile?: string, agentId?: string): Promise<Suggestion> {
    const id = requireGameId();
    return http<Suggestion>(`/api/games/${id}/dry-run`, {
      method: 'POST',
      body: JSON.stringify({
        ...(kind ? { kind } : {}),
        ...(modelFile ? { modelFile } : {}),
        ...(agentId ? { agentId } : {}),
      }),
    });
  },
  /** 对局中切换任一方槽位（只更新给出的方；模型类策略一并指定模型）。 */
  async setSlots(partial: { red?: SlotCfg; black?: SlotCfg }): Promise<GameState> {
    const id = requireGameId();
    const body: Record<string, unknown> = {};
    if (partial.red) body.red = slotBody(partial.red);
    if (partial.black) body.black = slotBody(partial.black);
    const state = await http<GameState>(`/api/games/${id}/slots`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    recordSlotsFromState(state);
    return state;
  },
  async undoGame(): Promise<StepResult> {
    // server 缺省语义即「回退到当前行棋方上次行动前」（策略托管回合自动一并回退）
    const id = requireGameId();
    const resp = await http<StepResult>(`/api/games/${id}/undo`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    recordSlotsFromState(resp.state);
    return resp;
  },
  async getGameState(): Promise<GameState> {
    const id = requireGameId();
    const state = await http<GameState>(`/api/games/${id}`);
    recordSlotsFromState(state);
    return state;
  },
  async listVariants(): Promise<VariantInfo[]> {
    const resp = await http<{ variants: VariantInfo[] }>('/api/variants');
    return resp.variants;
  },
  /** GET /api/scenarios：变体 → 支持的开局场景矩阵（建局面板渲染选择项）。 */
  async listScenarios(): Promise<VariantScenarios[]> {
    const resp = await http<ScenariosResp>('/api/scenarios');
    return resp.variants;
  },
  async getMoveAction(fromSq: number, toSq: number): Promise<number | null> {
    if (!currentGameId) return null;
    const resp = await http<MoveActionResp>(
      `/api/games/${currentGameId}/move-action?from=${fromSq}&to=${toSq}`,
    );
    return resp.action;
  },
  async listModels(): Promise<ModelList> {
    return http<ModelList>('/api/models');
  },
  async getCapabilities(): Promise<Capabilities> {
    return http<Capabilities>('/api/capabilities');
  },
  async setMctsIterations(iters: number): Promise<number> {
    const resp = await http<EngineSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ mctsSims: iters }),
    });
    return resp.mctsSims;
  },
  async setEngineBudget(budget: number): Promise<number> {
    // PUT /api/settings 部分更新：仅调整 Expectimax 强引擎默认节点预算
    const resp = await http<EngineSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ engineBudget: budget }),
    });
    return resp.engineBudget;
  },
  async setNnueSettings(p: NnueSettingsInput): Promise<EngineSettings> {
    // PUT /api/settings 部分更新：Expectimax 预算模式 / 深度 / 节点预算 /
    // 时间预算 / 搜索硬超时（未给出的字段保持服务器当前值），返回钳制后的全量生效快照
    return http<EngineSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        ...(p.mode ? { nnueBudgetMode: p.mode } : {}),
        ...(p.depth !== undefined ? { nnueDepth: p.depth } : {}),
        ...(p.budget !== undefined ? { nnueBudget: p.budget } : {}),
        ...(p.timeMs !== undefined ? { nnueTimeMs: p.timeMs } : {}),
        ...(p.timeoutMs !== undefined ? { searchTimeoutMs: p.timeoutMs } : {}),
      }),
    });
  },
  async mctsGetRoot(): Promise<MctsRootInfo> {
    return http<MctsRootInfo>(`/api/games/${requireGameId()}/mcts/root`);
  },
  async mctsGetChildren(nodeId: number): Promise<MctsEdge[]> {
    return http<MctsEdge[]>(`/api/games/${requireGameId()}/mcts/node/${nodeId}/children`);
  },
  async mctsGetNodeDetail(nodeId: number): Promise<MctsNodeDetail> {
    return http<MctsNodeDetail>(`/api/games/${requireGameId()}/mcts/node/${nodeId}`);
  },
  async mctsGetNodeBoard(nodeId: number): Promise<MctsNodeBoard> {
    return http<MctsNodeBoard>(`/api/games/${requireGameId()}/mcts/node/${nodeId}/board`);
  },
  async mctsSearch(): Promise<MctsRootInfo> {
    return http<MctsRootInfo>(`/api/games/${requireGameId()}/mcts/search`, { method: 'POST' });
  },
  async nnueGetRoot(): Promise<ExRootInfo> {
    return http<ExRootInfo>(`/api/games/${requireGameId()}/nnue/root`);
  },
  async nnueGetChildren(nodeId: number): Promise<ExEdge[]> {
    return http<ExEdge[]>(`/api/games/${requireGameId()}/nnue/node/${nodeId}/children`);
  },
  async nnueGetNodeDetail(nodeId: number): Promise<ExNodeSummary> {
    return http<ExNodeSummary>(`/api/games/${requireGameId()}/nnue/node/${nodeId}`);
  },
  async nnueGetNodeBoard(nodeId: number): Promise<ExNodeBoard> {
    return http<ExNodeBoard>(`/api/games/${requireGameId()}/nnue/node/${nodeId}/board`);
  },
  async nnueSearch(): Promise<ExRootInfo> {
    return http<ExRootInfo>(`/api/games/${requireGameId()}/nnue/search`, { method: 'POST' });
  },

  // ==========================================================================
  // 最近对局归档与重新推演
  // ==========================================================================

  /** GET /api/games/recent?limit=n：最近 n 局终局归档（含行棋方角色与胜者）。 */
  async listRecentGames(limit?: number): Promise<ArchivedGameSummary[]> {
    const query = limit ? `?limit=${limit}` : '';
    const resp = await http<{ games: ArchivedGameSummary[] }>(`/api/games/recent${query}`);
    return resp.games;
  },
  /** GET /api/games/recent/:id：单局归档详情（初始/终局 BFEN、动作序列、逐子记录）。 */
  async getRecentGame(id: string): Promise<ArchivedGameDetail> {
    return http<ArchivedGameDetail>(`/api/games/recent/${id}`);
  },
  /** GET /api/games/recent/:id/replay：按初始局面 + 动作序列逐 ply 忠实重放。 */
  async getReplay(id: string): Promise<ReplayResp> {
    return http<ReplayResp>(`/api/games/recent/${id}/replay`);
  },
  /**
   * POST /api/games/recent/:id/replay：复演——从归档初始局面建一局新对局
   * （缺省双方 Human，可在主棋盘重走或再改槽位），并切换当前对局到新局。
   */
  async replayArchived(id: string): Promise<GameState> {
    const created = await http<{ game_id: string; state: GameState }>(
      `/api/games/recent/${id}/replay`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    currentGameId = created.game_id;
    recordSlotsFromState(created.state);
    return created.state;
  },

  // ==========================================================================
  // Agent（玩家实体）：创建后只读，仅搜索参数可实时调整
  // ==========================================================================

  async createAgent(cfg: CreateAgentCfg): Promise<AgentView> {
    return http<AgentView>('/api/agents', {
      method: 'POST',
      body: JSON.stringify({
        variant: cfg.variant,
        kind: cfg.kind,
        ...(cfg.model_file ? { modelFile: cfg.model_file } : {}),
        ...(cfg.params ? { params: paramsBody(cfg.params) } : {}),
      }),
    });
  },
  async listAgents(): Promise<AgentView[]> {
    const resp = await http<{ agents: AgentView[] }>('/api/agents');
    return resp.agents;
  },
  async deleteAgent(id: string): Promise<void> {
    await http<void>(`/api/agents/${id}`, { method: 'DELETE' });
  },
  /** 实时调整 Agent 搜索参数（部分更新，对所有绑定它的对局立即生效）。 */
  async updateAgentSettings(id: string, params: AgentParamsCfg): Promise<AgentView> {
    return http<AgentView>(`/api/agents/${id}/settings`, {
      method: 'PUT',
      body: JSON.stringify(paramsBody(params)),
    });
  },
};

/** 搜索参数 → 请求体（camelCase；仅附带显式给出的字段）。 */
function paramsBody(p: AgentParamsCfg): Record<string, unknown> {
  return {
    ...(p.mcts_sims !== undefined ? { mctsSims: p.mcts_sims } : {}),
    ...(p.engine_budget !== undefined ? { engineBudget: p.engine_budget } : {}),
    ...(p.engine_budget_mode ? { engineBudgetMode: p.engine_budget_mode } : {}),
    ...(p.engine_depth !== undefined ? { engineDepth: p.engine_depth } : {}),
    ...(p.engine_time_ms !== undefined ? { engineTimeMs: p.engine_time_ms } : {}),
    ...(p.nnue_budget_mode ? { nnueBudgetMode: p.nnue_budget_mode } : {}),
    ...(p.nnue_depth !== undefined ? { nnueDepth: p.nnue_depth } : {}),
    ...(p.nnue_budget !== undefined ? { nnueBudget: p.nnue_budget } : {}),
    ...(p.nnue_time_ms !== undefined ? { nnueTimeMs: p.nnue_time_ms } : {}),
    ...(p.search_timeout_ms !== undefined ? { searchTimeoutMs: p.search_timeout_ms } : {}),
  };
}
