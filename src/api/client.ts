// ============================================================================
// 统一后端 API 适配层（双传输）
//
// - Tauri 桌面版：走 Tauri command invoke（banqi-gui/src/*.rs）
// - 浏览器 / banqi-server：走 HTTP REST（banqi-server/src/api）
//
// 两个后端共享同一份契约：`types.ts` 中的类型即契约的单一真源，
// 字段命名 / 语义差异都在本文件的 REST 适配器内消化，组件层零感知。
// 契约与路线图见 docs/backend-api.md。
// ============================================================================
import type {
  Capabilities,
  EngineSettings,
  GameState,
  HistoryMove,
  MctsEdge,
  MctsNodeBoard,
  MctsNodeDetail,
  MctsRootInfo,
  ModelList,
  Opponent,
  StepResult,
  Variant,
  VariantInfo,
} from './types';

/**
 * 合法棋子类型全名（与 domain/pieces.ts 的 PIECE_TYPE_ORDER 保持一致）。
 * 注意：此处不能直接 import domain/pieces——它会经 variants.ts 循环依赖回
 * api/client.ts，导致打包产物运行期 TDZ 报错，故以本名单消除环。
 */
const VALID_TYPE_NAMES = new Set([
  'General',
  'Advisor',
  'Elephant',
  'Chariot',
  'Horse',
  'Cannon',
  'Soldier',
]);

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

// ============================================================================
// HTTP 传输（banqi-server）
// ============================================================================

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

/// HTTP 模式下当前对局 ID（server 是多会话资源模型，前端单对局持有一个 ID）
let currentGameId: string | null = null;
/// 最近一次快照（getMoveAction 在 HTTP 模式下由本地 legalActions 映射）
let lastSnapshot: { board: GameState; legal: { action: number; from: number; to: number }[] } | null =
  null;
/// 最近一次状态中的对手种类（由 server 状态响应 `ai.kind` 下发；
/// loadFen 沿用当前对手设置与 Tauri 语义一致）
let lastOpponentKind: Opponent | null = null;

/** server CellView → 前端 Slot 字符串（"R_Sol" / "B_Gen" / "Hidden" / "Empty"）。 */
function cellToSlot(cell: {
  state: string;
  piece?: { type: string; side: string } | null;
}): string {
  if (cell.state === 'revealed' && cell.piece) {
    const side = cell.piece.side === 'red' ? 'R' : 'B';
    const type = cell.piece.type.charAt(0).toUpperCase() + cell.piece.type.slice(1);
    return `${side}_${type.slice(0, 3)}`;
  }
  return cell.state === 'hidden' ? 'Hidden' : 'Empty';
}

/** server 棋子类型小写名（"soldier"）→ 前端全名（"Soldier"），供 PieceTray/countByType 使用。 */
function toTypeNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.charAt(0).toUpperCase() + name.slice(1))
    .filter((name) => VALID_TYPE_NAMES.has(name));
}

/** server PieceView → 前端棋子短码（"R_Sol" / "B_Gen" …，与棋盘 Slot 同格式）。 */
function pieceViewToSlot(piece: { type?: string; side?: string } | null | undefined): string | undefined {
  if (!piece?.type || !piece.side) return undefined;
  const side = piece.side === 'red' ? 'R' : 'B';
  const type = piece.type.charAt(0).toUpperCase() + piece.type.slice(1);
  return `${side}_${type.slice(0, 3)}`;
}

/** server HistoryMoveView → 前端 HistoryMove（camelCase→snake_case + 棋子短码）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptHistoryMove(m: any): HistoryMove {
  return {
    ply: m.ply,
    player: m.player === 'red' ? 'Red' : 'Black',
    action: m.action,
    from: m.from,
    to: m.to,
    is_flip: !!m.isFlip,
    is_chance: !!m.isChance,
    is_capture: !!m.isCapture,
    revealed: pieceViewToSlot(m.revealed),
    captured: pieceViewToSlot(m.captured),
  };
}

/** server GameStateResp → 前端 GameState（契约适配，字段映射见 docs/backend-api.md）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptServerState(s: any): { state: GameState; terminated: boolean; truncated: boolean; winner: number } {
  const board: string[] = [];
  const legal: { action: number; from: number; to: number }[] = [];
  for (const cell of s.board) board.push(cellToSlot(cell));
  for (const a of s.legalActions ?? []) legal.push(a);
  const actionMasks = new Array(s.board ? 352 : 0).fill(0);
  for (const a of legal) actionMasks[a.action] = 1;
  const state: GameState = {
    board,
    current_player: s.currentPlayer === 'red' ? 'Red' : 'Black',
    move_counter: s.moveCount,
    total_step_counter: s.totalSteps,
    dead_red: toTypeNames(s.deadRed),
    dead_black: toTypeNames(s.deadBlack),
    hidden_red: toTypeNames(s.hiddenRed),
    hidden_black: toTypeNames(s.hiddenBlack),
    action_masks: actionMasks,
    reveal_probabilities: [],
    bitboards: {},
    hp_red: s.redHp,
    hp_black: s.blackHp,
    variant: s.variant,
    fen: typeof s.fen === 'string' ? s.fen : undefined,
    ai_to_move: !!s.aiToMove,
    can_undo: !!s.undoable,
    history: Array.isArray(s.history) ? s.history.map(adaptHistoryMove) : [],
  };
  lastSnapshot = { board: state, legal };
  // 记录对手种类（server GameStateResp.ai.kind："PvP" / "Random" / … 与前端枚举一致）
  const kind = s.ai?.kind;
  if (typeof kind === 'string' && kind.length > 0) lastOpponentKind = kind as Opponent;
  const winner = s.winner === 'red' ? 1 : s.winner === 'black' ? -1 : s.winner === 'draw' ? 0 : 0;
  return { state, terminated: !!s.terminated, truncated: !!s.truncated, winner };
}

/** MoveResp → StepResult：附带 AI 回合的搜索统计（MCTS / NNUE 二选一，日志栏展示用）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptMoveResp(resp: any): StepResult {
  const base = adaptServerState(resp.state);
  const mcts = resp.mctsStats;
  const nnue = resp.nnueStats;
  const result: StepResult = { ...base };
  if (mcts) {
    result.mcts_stats = {
      reused: !!mcts.reused,
      budget: mcts.budget,
      actual_sims: mcts.actualSims,
      max_depth: mcts.maxDepth,
      nodes: mcts.nodes,
      elapsed_ms: mcts.elapsedMs ?? 0,
    };
  }
  if (nnue) {
    result.nnue_stats = {
      engine: nnue.engine ?? 'nnue',
      mode: nnue.mode,
      depth: nnue.depth,
      budget: nnue.budget,
      time_limit_ms: nnue.timeLimitMs,
      nodes: nnue.nodes,
      reached_depth: nnue.reachedDepth,
      elapsed_ms: nnue.elapsedMs ?? 0,
    };
  }
  return result;
}

function requireGameId(): string {
  if (!currentGameId) throw new RestError('尚未创建对局（先 resetGame）');
  return currentGameId;
}

/** 统一 API：两个后端的同名方法语义一致。 */
const tauriApi = {
  resetGame(opponent: Opponent, variant: Variant, _modelFile?: string) {
    // Tauri 后端：模型经「加载模型」按钮绑定到对局，创建参数无需 modelFile
    return invoke<GameState>('reset_game', { opponent, variant });
  },
  loadFen(fen: string) {
    // 由 BFEN 局面串重建对局（走子历史清空；对手类型沿用当前设置）
    return invoke<GameState>('load_fen', { fen });
  },
  stepGame(action: number) {
    return invoke<StepResult>('step_game', { action });
  },
  botMove() {
    return invoke<StepResult>('bot_move');
  },
  undoGame() {
    return invoke<StepResult>('undo_game');
  },
  getGameState() {
    return invoke<GameState>('get_game_state');
  },
  listVariants() {
    return invoke<VariantInfo[]>('list_variants');
  },
  getOpponentType() {
    return invoke<Opponent>('get_opponent_type');
  },
  getMoveAction(fromSq: number, toSq: number) {
    return invoke<number | null>('get_move_action', { fromSq, toSq });
  },
  listModels() {
    return invoke<ModelList>('list_models');
  },
  openModelsDir() {
    return invoke<void>('open_models_dir');
  },
  getCapabilities() {
    return invoke<Capabilities>('get_capabilities');
  },
  loadModel(path: string) {
    return invoke<string>('load_model', { path });
  },
  setMctsIterations(iters: number) {
    return invoke<EngineSettings>('set_engine_settings', { mctsSims: iters }).then((s) => s.mctsSims);
  },
  setEngineBudget(budget: number) {
    return invoke<EngineSettings>('set_engine_settings', { engineBudget: budget }).then((s) => s.engineBudget);
  },
  setNnueDepth(depth: number) {
    return invoke<EngineSettings>('set_engine_settings', { nnueDepth: depth }).then((s) => s.nnueDepth);
  },
  setNnueBudget(budget: number) {
    return invoke<EngineSettings>('set_engine_settings', { nnueBudget: budget }).then((s) => s.nnueBudget);
  },
  mctsGetRoot() {
    return invoke<MctsRootInfo>('mcts_get_root');
  },
  mctsGetChildren(nodeId: number) {
    return invoke<MctsEdge[]>('mcts_get_children', { nodeId });
  },
  mctsGetNodeDetail(nodeId: number) {
    return invoke<MctsNodeDetail>('mcts_get_node_detail', { nodeId });
  },
  mctsGetNodeBoard(nodeId: number) {
    return invoke<MctsNodeBoard>('mcts_get_node_board', { nodeId });
  },
  mctsSearch() {
    return invoke<MctsRootInfo>('mcts_search');
  },
};

const restApi = {
  async resetGame(opponent: Opponent, variant: Variant, modelFile?: string) {
    // torch 推理（MctsDL）为 Tauri 专属；其余对手 server 全量支持
    // （PvP / Random / RevealFirst / CaptureFirst / Engine / MctsOnnx / Nnue）
    if (opponent === 'MctsDL') {
      throw new RestError(`HTTP 后端不支持对手 ${opponent}（torch 推理为 Tauri 专属）`);
    }
    const isModelKind = opponent === 'MctsOnnx' || opponent === 'Nnue';
    const created = await http<{ gameId: string; state: unknown }>('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        variant,
        opponent,
        // 模型类对手：用户选择的模型与对局绑定（.onnx → MCTS+ONNX，.nnue → Expectimax+NNUE）；
        // 缺省时服务端按变体 ID 自动匹配唯一候选（多候选时报歧义错误，要求显式选择）。
        // 规则 / Engine 对手无模型，忽略 modelFile。
        ...(isModelKind && modelFile ? { modelFile } : {}),
      }),
    });
    currentGameId = created.gameId;
    return adaptServerState(created.state).state;
  },
  async loadFen(fen: string, modelFile?: string) {
    // 由 BFEN 局面串重建对局：变体以 BFEN 自带标识为准；走子历史从空开始。
    // 对手类型沿用当前设置（与 Tauri 语义一致）；模型类对手沿用绑定模型
    // （缺省时服务端按变体 ID 自动匹配）。
    const opponent =
      lastOpponentKind && lastOpponentKind !== 'PvP' && lastOpponentKind !== 'MctsDL'
        ? lastOpponentKind
        : undefined;
    const isModelKind = opponent === 'MctsOnnx' || opponent === 'Nnue';
    const created = await http<{ gameId: string; state: unknown }>('/api/games', {
      method: 'POST',
      body: JSON.stringify({
        fen,
        ...(opponent ? { opponent } : { aiEnabled: true }),
        ...(modelFile && (isModelKind || !opponent) ? { modelFile } : {}),
      }),
    });
    currentGameId = created.gameId;
    return adaptServerState(created.state).state;
  },
  async stepGame(action: number) {
    const id = requireGameId();
    const resp = await http<Record<string, unknown>>(`/api/games/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    return adaptMoveResp(resp);
  },
  async botMove() {
    const id = requireGameId();
    const resp = await http<Record<string, unknown>>(`/api/games/${id}/ai-move`, { method: 'POST' });
    return adaptMoveResp(resp);
  },
  async undoGame() {
    // server 缺省语义即「回退到当前行棋方上次行动前」（AI 对局中自动含 AI 回合）
    const id = requireGameId();
    const resp = await http<Record<string, unknown>>(`/api/games/${id}/undo`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    // /undo 返回 GameStateResp（顶层即状态字段，非 MoveResp 包裹结构）
    const base = adaptServerState(resp);
    return { ...base } as StepResult;
  },
  async getGameState() {
    if (!currentGameId) throw new RestError('尚未创建对局');
    const state = await http<unknown>(`/api/games/${currentGameId}`);
    return adaptServerState(state).state;
  },
  async listVariants() {
    const resp = await http<{ variants: VariantInfo[] }>('/api/variants');
    return resp.variants;
  },
  async getOpponentType(): Promise<Opponent> {
    // 对手种类由状态响应 ai.kind 下发（创建/走子/查询后均有最新值）；
    // 尚未收到任何状态时按「无需客户端补走」语义返回 PvP
    return lastOpponentKind ?? 'PvP';
  },
  async getMoveAction(fromSq: number, toSq: number) {
    if (!lastSnapshot) return null;
    const hit = lastSnapshot.legal.find((a) => a.from === fromSq && a.to === toSq);
    return hit ? hit.action : null;
  },
  async listModels(): Promise<ModelList> {
    const health = await http<{ models: { file: string }[] }>('/api/health');
    return { dir: '(server models/)', models: health.models.map((m) => ({ name: m.file, path: m.file })) };
  },
  async openModelsDir() {
    throw new RestError('HTTP 后端不支持打开本地目录');
  },
  async getCapabilities(): Promise<Capabilities> {
    const health = await http<{ device: string }>('/api/health');
    return { torch: false, onnx: health.device !== 'unknown', nnue: true };
  },
  async loadModel(path: string) {
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
  async setMctsIterations(iters: number) {
    const resp = await http<{ mctsSims: number }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ mctsSims: iters }),
    });
    return resp.mctsSims;
  },
  async setEngineBudget(budget: number) {
    // PUT /api/settings 部分更新：仅调整 Expectimax 强引擎默认节点预算
    const resp = await http<{ engineBudget: number }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ engineBudget: budget }),
    });
    return resp.engineBudget;
  },
  async setNnueDepth(depth: number) {
    // PUT /api/settings 部分更新：仅调整 NNUE 默认搜索深度（返回钳制后的生效值）
    const resp = await http<{ nnueDepth: number }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ nnueDepth: depth }),
    });
    return resp.nnueDepth;
  },
  async setNnueBudget(budget: number) {
    // PUT /api/settings 部分更新：仅调整 NNUE 默认节点预算（返回钳制后的生效值）
    const resp = await http<{ nnueBudget: number }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ nnueBudget: budget }),
    });
    return resp.nnueBudget;
  },
  async mctsGetRoot() {
    return http<MctsRootInfo>(`/api/games/${requireGameId()}/mcts/root`);
  },
  async mctsGetChildren(nodeId: number) {
    return http<MctsEdge[]>(`/api/games/${requireGameId()}/mcts/node/${nodeId}/children`);
  },
  async mctsGetNodeDetail(nodeId: number) {
    return http<MctsNodeDetail>(`/api/games/${requireGameId()}/mcts/node/${nodeId}`);
  },
  async mctsGetNodeBoard(nodeId: number) {
    // server 返回 snake_case 信息子集，与 types.ts MctsNodeBoard 契约直传
    return http<MctsNodeBoard>(`/api/games/${requireGameId()}/mcts/node/${nodeId}/board`);
  },
  async mctsSearch() {
    return http<MctsRootInfo>(`/api/games/${requireGameId()}/mcts/search`, { method: 'POST' });
  },
};

export const api = isTauri() ? tauriApi : restApi;
