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
  GameState,
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
    dead_red: [],
    dead_black: [],
    hidden_red: [],
    hidden_black: [],
    action_masks: actionMasks,
    reveal_probabilities: [],
    bitboards: {},
    hp_red: s.redHp,
    hp_black: s.blackHp,
    variant: s.variant,
    ai_to_move: !!s.aiToMove,
    can_undo: !!s.undoable,
  };
  lastSnapshot = { board: state, legal };
  const winner = s.winner === 'red' ? 1 : s.winner === 'black' ? -1 : s.winner === 'draw' ? 0 : 0;
  return { state, terminated: !!s.terminated, truncated: !!s.truncated, winner };
}

/** MoveResp → StepResult：附带 AI 回合的 MCTS 搜索统计（日志栏展示用）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adaptMoveResp(resp: any): StepResult {
  const base = adaptServerState(resp.state);
  const s = resp.mctsStats;
  const result: StepResult = { ...base };
  if (s) {
    result.mcts_stats = {
      reused: !!s.reused,
      budget: s.budget,
      actual_sims: s.actualSims,
      max_depth: s.maxDepth,
      nodes: s.nodes,
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
  resetGame(opponent: Opponent, variant: Variant) {
    return invoke<GameState>('reset_game', { opponent, variant });
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
    return invoke<number>('set_mcts_iterations', { iters });
  },
  setEngineBudget(budget: number) {
    return invoke<number>('set_engine_budget', { budget });
  },
  setNnueDepth(depth: number) {
    return invoke<number>('set_nnue_depth', { depth });
  },
  setNnueBudget(budget: number) {
    return invoke<number>('set_nnue_budget', { budget });
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
  async resetGame(opponent: Opponent, variant: Variant) {
    // server 仅支持 AI 对手（MctsOnnx 语义）；规则对手 / PvP 为 Tauri 专属
    if (opponent !== 'MctsOnnx') {
      throw new RestError(`HTTP 后端暂不支持对手 ${opponent}（仅 MctsOnnx）`);
    }
    const created = await http<{ gameId: string; state: unknown }>('/api/games', {
      method: 'POST',
      body: JSON.stringify({ variant, aiEnabled: true }),
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
    // server 在 /move 内已自动执行 AI 回合（含 mcts_stats），
    // 前端无需再触发 botMove，故按“无需客户端补走”的语义返回 PvP
    return 'PvP';
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
    return { torch: false, onnx: health.device !== 'unknown' };
  },
  async loadModel() {
    throw new RestError('HTTP 后端暂不支持运行期加载模型（重启 server 指定 models/）');
  },
  async setMctsIterations(iters: number) {
    // 契约预留：POST /api/settings（未实现）
    throw new RestError(`HTTP 后端暂不支持运行期设置（iters=${iters}，见 docs/backend-api.md）`);
  },
  setEngineBudget() {
    return Promise.reject(new RestError('HTTP 后端暂不支持（见 docs/backend-api.md）'));
  },
  setNnueDepth() {
    return Promise.reject(new RestError('Nnue 对手为 Tauri 专属'));
  },
  setNnueBudget() {
    return Promise.reject(new RestError('Nnue 对手为 Tauri 专属'));
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
