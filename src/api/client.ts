// ============================================================================
// 统一后端 API 客户端（HTTP REST，banqi-server）
//
// 契约真源：`types.ts`（与 banqi-server DTO 逐字段对齐，snake_case 直传，
// 无适配层）。契约与路线图见 docs/backend-api.md。
// ============================================================================

import type {
  Capabilities,
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
  Opponent,
  StepResult,
  Variant,
  VariantInfo,
} from './types';

/** NNUE 预算设置输入（setNnueSettings 统一入参；未给出的字段保持服务器当前值）。 */
export interface NnueSettingsInput {
  mode?: NnueBudgetMode;
  depth?: number;
  budget?: number;
  timeMs?: number;
  timeoutMs?: number;
}

/** GET /api/games/:id/opponent 响应。 */
interface OpponentResp {
  opponent: string;
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

/** 最近一次状态中的对手种类（loadFen 沿用当前对手设置）。 */
let lastOpponentKind: Opponent | null = null;

function recordOpponentFromState(state: { ai?: { kind?: string } }): void {
  const kind = state.ai?.kind;
  if (typeof kind === 'string' && kind.length > 0) lastOpponentKind = kind as Opponent;
}

/** 统一 API（HTTP REST）。 */
export const api = {
  async resetGame(opponent: Opponent, variant: Variant, modelFile?: string): Promise<GameState> {
    const isModelKind = opponent === 'MctsOnnx' || opponent === 'Nnue' || opponent === 'MctsDL';
    const created = await http<{ game_id: string; state: GameState }>('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        variant,
        opponent,
        // 模型类对手：用户选择的模型与对局绑定（.onnx → MCTS+ONNX，.nnue →
        // Expectimax+NNUE，.pt → MCTS+TorchScript）；缺省时服务端按变体 ID
        // 自动匹配唯一候选（多候选时报歧义错误，要求显式选择）。
        // 规则 / Engine 对手无模型，忽略 modelFile。
        ...(isModelKind && modelFile ? { modelFile } : {}),
      }),
    });
    currentGameId = created.game_id;
    recordOpponentFromState(created.state);
    return created.state;
  },
  async loadFen(fen: string, modelFile?: string): Promise<GameState> {
    // 由 BFEN 局面串重建对局：变体以 BFEN 自带标识为准；走子历史从空开始。
    // 对手类型沿用当前设置；模型类对手沿用绑定模型（缺省时服务端按变体 ID 自动匹配）。
    const opponent =
      lastOpponentKind && lastOpponentKind !== 'PvP' ? lastOpponentKind : undefined;
    const isModelKind = opponent === 'MctsOnnx' || opponent === 'Nnue' || opponent === 'MctsDL';
    const created = await http<{ game_id: string; state: GameState }>('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        fen,
        ...(opponent ? { opponent } : { aiEnabled: true }),
        ...(modelFile && (isModelKind || !opponent) ? { modelFile } : {}),
      }),
    });
    currentGameId = created.game_id;
    recordOpponentFromState(created.state);
    return created.state;
  },
  async stepGame(action: number): Promise<StepResult> {
    const id = requireGameId();
    const resp = await http<StepResult>(`/api/games/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    recordOpponentFromState(resp.state);
    return resp;
  },
  async botMove(): Promise<StepResult> {
    const id = requireGameId();
    const resp = await http<StepResult>(`/api/games/${id}/ai-move`, { method: 'POST' });
    recordOpponentFromState(resp.state);
    return resp;
  },
  async undoGame(): Promise<StepResult> {
    // server 缺省语义即「回退到当前行棋方上次行动前」（AI 对局中自动含 AI 回合）
    const id = requireGameId();
    const resp = await http<StepResult>(`/api/games/${id}/undo`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    recordOpponentFromState(resp.state);
    return resp;
  },
  async getGameState(): Promise<GameState> {
    const id = requireGameId();
    const state = await http<GameState>(`/api/games/${id}`);
    recordOpponentFromState(state);
    return state;
  },
  async listVariants(): Promise<VariantInfo[]> {
    const resp = await http<{ variants: VariantInfo[] }>('/api/variants');
    return resp.variants;
  },
  async getOpponentType(): Promise<Opponent> {
    if (!currentGameId) return 'PvP';
    const resp = await http<OpponentResp>(`/api/games/${currentGameId}/opponent`);
    return resp.opponent as Opponent;
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
  async openModelsDir(): Promise<void> {
    // HTTP 后端运行在服务器上，无法打开浏览器侧本地目录（UI 据此隐藏入口）
    throw new RestError('HTTP 后端不支持打开本地目录');
  },
  async getCapabilities(): Promise<Capabilities> {
    return http<Capabilities>('/api/capabilities');
  },
  async loadModel(path: string): Promise<string> {
    // 模型加载与对局绑定：绑定到当前对局（服务端随用随加载并常驻缓存）
    if (!currentGameId) {
      return `已选择模型 ${path}（开始新对局时自动绑定）`;
    }
    await http(`/api/games/${currentGameId}/model`, {
      method: 'PUT',
      body: JSON.stringify({ modelFile: path }),
    });
    return `模型已绑定到当前对局: ${path}`;
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
    // PUT /api/settings 部分更新：NNUE 预算模式 / 深度 / 节点预算 / 时间预算 /
    // 搜索硬超时（未给出的字段保持服务器当前值），返回钳制后的全量生效快照
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
};
