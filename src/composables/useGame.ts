import { computed, reactive } from 'vue';
import { api } from '../api/client';
import type { GameState, HistoryMove, Opponent, Slot, Variant } from '../api/types';
import { variantMaxConsecutive } from '../domain/variants';
import { appendLog } from './useLogs';
import { useToast } from './useToast';
import { isRevealed, pieceText, slotPlayer } from '../domain/pieces';

const toast = useToast();

interface MoveHighlight {
  idx: number;
  type: 'move' | 'capture';
}

interface GameStore {
  state: GameState | null;
  busy: boolean;
  selectedSquare: number | null;
  moveHighlights: Map<number, MoveHighlight>;
  lastResult: { terminated: boolean; truncated: boolean; winner: number } | null;
  /** 是否可悔棋（由后端 can_undo 契约显式维护，随每次状态同步更新） */
  canUndo: boolean;
  /** 决策历史面板当前选中查看的手数（null = 未选中；选中时棋盘高亮 from/to） */
  inspectPly: number | null;
}

const store = reactive<GameStore>({
  state: null,
  busy: false,
  selectedSquare: null,
  moveHighlights: new Map(),
  lastResult: null,
  canUndo: false,
  inspectPly: null,
});

/**
 * 「变体 + 坐标 → 动作索引」缓存。
 *
 * from/to 到动作索引的映射只取决于变体的几何结构（行列数），与具体局面无关，
 * 因此键带上 variant 后条目永远有效，无需在对局重置 / 悔棋 / 落子时失效。
 *
 * 注意：null（坐标对不构成任何动作）不可缓存——REST 模式下 getMoveAction
 * 依赖 lastSnapshot，页面刚加载 / 后端尚未就绪时的 null 是暂态，
 * 缓存它会导致后续同坐标的合法动作被误判为「该棋子无法移动到此处」。
 */
const actionIndexCache = new Map<string, number>();

const statusText = computed(() => {
  const s = store.state;
  if (!s) return '—';
  if (store.lastResult?.terminated || store.lastResult?.truncated) {
    const w = store.lastResult.winner;
    return w === 1 ? '红方获胜' : w === -1 ? '黑方获胜' : '和棋';
  }
  return '进行中';
});

function playerName(p: string): string {
  return p === 'Red' ? '红方' : '黑方';
}

/** 一手棋的可读描述（基于后端决策历史，机会动作附实际翻出的棋子）。 */
function moveText(m: HistoryMove, board: Slot[]): string {
  const actor = playerName(m.player);
  if (m.is_flip) {
    return `[${actor}] 翻开 位置${m.to} → ${pieceText(m.revealed ?? '') || '?'}`;
  }
  const attacker = pieceText(board[m.from] ?? '') || '棋子';
  if (m.is_capture && m.is_chance) {
    // 吃暗子（含炮打暗子）：打出的暗子随即被消灭
    return `[${actor}] ${attacker}(位置${m.from}) 打暗子 位置${m.to}，` +
      `翻出 ${pieceText(m.revealed ?? '') || '?'}（被消灭）`;
  }
  if (m.is_capture) {
    return `[${actor}] ${attacker}(位置${m.from}) 吃掉 位置${m.to} 的 ${pieceText(m.captured ?? '')}`;
  }
  return `[${actor}] ${attacker}(位置${m.from}) → 位置${m.to}`;
}

/**
 * 把本次请求新执行的走子写入日志（取自后端决策历史，而非前端棋盘差分）。
 *
 * 棋盘差分无法区分「翻棋」与「吃暗子后攻击方落到目标格」，且打出的暗子
 * 真实身份只存在于后端历史记录中——统一以后端 history 为单一真源。
 */
function logNewMoves(prev: GameState, next: GameState) {
  const prevLen = prev.history?.length ?? 0;
  const moves = next.history ?? [];
  for (let i = prevLen; i < moves.length; i++) {
    const m = moves[i];
    appendLog(
      `第${m.ply}步 ${moveText(m, prev.board)}` +
        `（无吃子 ${next.move_counter}/${variantMaxConsecutive(next.variant)}）`,
    );
  }
}

async function cachedMoveAction(fromSq: number, toSq: number): Promise<number | null> {
  const variant = store.state?.variant;
  if (!variant) return null;
  const key = `${variant}:${fromSq}-${toSq}`;
  const hit = actionIndexCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const action = await api.getMoveAction(fromSq, toSq);
    // 仅缓存非 null 结果（坐标→动作映射恒定）；null 可能为暂态，留待下次查询
    if (action !== null) actionIndexCache.set(key, action);
    return action;
  } catch (err) {
    console.error('get_move_action failed', err);
    return null;
  }
}

function legalReveal(idx: number): boolean {
  return store.state?.action_masks[idx] === 1;
}

function isSelectable(idx: number | null): boolean {
  const s = store.state;
  if (!s || idx == null) return false;
  const slot = s.board[idx];
  return isRevealed(slot) && slotPlayer(slot) === s.current_player;
}

async function computeMoveHighlights(from: number): Promise<Map<number, MoveHighlight>> {
  const s = store.state;
  const result = new Map<number, MoveHighlight>();
  if (!s || from == null) return result;
  const tasks = s.board.map(async (target, idx) => {
    if (idx === from) return null;
    const action = await cachedMoveAction(from, idx);
    if (action == null || s.action_masks[action] !== 1) return null;
    if (target === 'Empty') return { idx, type: 'move' as const };
    if (target === 'Hidden') return null;
    if (slotPlayer(target) !== s.current_player) return { idx, type: 'capture' as const };
    return null;
  });
  for (const entry of await Promise.all(tasks)) {
    if (entry) result.set(entry.idx, entry);
  }
  return result;
}

async function refreshHighlights() {
  store.moveHighlights =
    store.selectedSquare !== null
      ? await computeMoveHighlights(store.selectedSquare)
      : new Map();
}

function checkGameOver(result: { terminated: boolean; truncated: boolean; winner: number }) {
  if (!result.terminated && !result.truncated) return;
  const outcome =
    result.winner === 1 ? '红方获胜！' : result.winner === -1 ? '黑方获胜！' : '平局！';
  const reason = result.truncated ? '（步数用尽）' : '';
  const msg = `游戏结束！${reason} ${outcome}`;
  appendLog(msg);
  toast.success(msg, 5000);
}

async function applyStep(prev: GameState, result: { state: GameState } & { terminated: boolean; truncated: boolean; winner: number }) {
  store.lastResult = result;
  logNewMoves(prev, result.state);
  store.state = result.state;
  store.selectedSquare = null;
  store.moveHighlights = new Map();
  store.canUndo = !!result.state.can_undo;
  store.inspectPly = null;
  checkGameOver(result);
}

/** MCTS 搜索统计写日志栏（仅 MctsDL / MctsOnnx 对手携带）。 */
function logMctsStats(stats: NonNullable<import('../api/types').StepResult['mcts_stats']>) {
  appendLog(
    `MCTS 搜索: ${stats.reused ? '复用搜索树' : '全新建树'}，` +
      `实际模拟 ${stats.actual_sims}/${stats.budget} 次，` +
      `树深度 ${stats.max_depth}，节点 ${stats.nodes}，` +
      `耗时 ${stats.elapsed_ms} ms`,
  );
}

/** NNUE Expectimax 搜索统计写日志栏（仅 Nnue 对手携带）。 */
function logNnueStats(stats: NonNullable<import('../api/types').StepResult['nnue_stats']>) {
  appendLog(
    `NNUE 搜索: 深度上限 ${stats.depth}（完成 ${stats.reached_depth} 层），` +
      `节点 ${stats.nodes}/${stats.budget}，` +
      `耗时 ${stats.elapsed_ms} ms`,
  );
}

/**
 * 触发 AI 行动（仅当确实轮到 AI 时）。
 *
 * 轮次判定：
 * - REST（banqi-server）：以契约字段 `ai_to_move` 为准。注意 server 的 /move
 *   在人类走子后已自动完成 AI 回合并一并返回，此时 ai_to_move 为 false，
 *   不会再调用 /ai-move（否则 409 NOT_AI_TURN）。
 * - Tauri：ai_to_move 为 undefined，退化为「走子后行棋方是否切换」判断
 *   （同一玩家连走时不轮到 AI）。
 */
async function maybeBotTurn() {
  const s = store.state;
  if (!s || store.busy) return;
  if (s.ai_to_move === false) return;
  try {
    const opp = await api.getOpponentType();
    if (opp === 'PvP') return;
    store.busy = true;
    const prev = store.state;
    if (!prev) return;
    const result = await api.botMove();
    await applyStep(prev, result);
    if (result.mcts_stats) logMctsStats(result.mcts_stats);
    if (result.nnue_stats) logNnueStats(result.nnue_stats);
  } catch (e) {
    console.error('bot_move skipped or failed:', e);
    toast.error('电脑行动失败: ' + e);
  } finally {
    store.busy = false;
  }
}

async function doMove(action: number) {
  if (!store.state || store.busy) return;
  const prev = store.state;
  const mover = prev.current_player;
  store.busy = true;
  try {
    const result = await api.stepGame(action);
    await applyStep(prev, result);
    // REST 模式：server 在 /move 内已代跑 AI 回合，此处附带其搜索统计
    if (result.mcts_stats) logMctsStats(result.mcts_stats);
    if (result.nnue_stats) logNnueStats(result.nnue_stats);
    const next = result.state;
    if (
      !(result.terminated || result.truncated) &&
      // REST: server 已代跑 AI 回合，ai_to_move 为 false 时直接跳过；
      // Tauri: 未提供该字段（undefined）时用行棋方是否切换兜底。
      (next.ai_to_move === true || (next.ai_to_move === undefined && next.current_player !== mover))
    ) {
      await maybeBotTurn();
    }
  } catch (e) {
    toast.error('操作失败: ' + e);
  } finally {
    store.busy = false;
  }
}

/** 悔棋：回退到当前行棋方上次行动前（AI 对局中自动一并回退 AI 回合）。 */
async function undoMove() {
  if (!store.state || store.busy) return;
  store.busy = true;
  try {
    // 悔棋前先记下旧历史与旧棋盘：后端截断后即可对照出被撤销的手
    const prevHistory = store.state.history ?? [];
    const prevBoard = store.state.board;
    const result = await api.undoGame();
    const kept = result.state.history?.length ?? 0;
    for (const m of prevHistory.slice(kept).reverse()) {
      appendLog(`[悔棋] 撤销 第${m.ply}步 ${moveText(m, prevBoard)}`);
    }
    appendLog(`回退到${playerName(result.state.current_player)}上次行动前`);
    store.lastResult = result;
    store.state = result.state;
    store.selectedSquare = null;
    store.moveHighlights = new Map();
    store.canUndo = !!result.state.can_undo;
    store.inspectPly = null;
  } catch (e) {
    console.error('Undo failed:', e);
    toast.error('悔棋失败: ' + e);
  } finally {
    store.busy = false;
  }
}

async function onSquareClick(idx: number) {
  const s = store.state;
  if (!s || store.busy) return;
  const slot = s.board[idx];

  if (store.selectedSquare === null) {
    if (slot === 'Hidden') {
      if (legalReveal(idx)) {
        await doMove(idx);
      } else {
        toast.info('该棋子当前不能翻开', 1500);
      }
    } else if (isRevealed(slot) && slotPlayer(slot) === s.current_player) {
      store.selectedSquare = idx;
      await refreshHighlights();
    }
    return;
  }

  if (idx === store.selectedSquare) {
    store.selectedSquare = null;
    store.moveHighlights = new Map();
  } else if (isRevealed(slot) && slotPlayer(slot) === s.current_player) {
    store.selectedSquare = idx;
    await refreshHighlights();
  } else {
    const action = await cachedMoveAction(store.selectedSquare, idx);
    if (action !== null && s.action_masks[action] === 1) {
      await doMove(action);
    } else {
      toast.info('该棋子无法移动到此处', 1500);
    }
  }
}

function deselect() {
  if (store.selectedSquare !== null) {
    store.selectedSquare = null;
    store.moveHighlights = new Map();
  }
}

async function resetGame(opponent: Opponent, variant: Variant, modelFile?: string) {
  if (store.busy) return;
  store.selectedSquare = null;
  store.moveHighlights = new Map();
  store.inspectPly = null;
  try {
    appendLog(
      `开始新游戏（变体 ${variant}，对手 ${opponent}` +
        `${modelFile ? `，模型 ${modelFile}` : ''}）`,
    );
    store.state = await api.resetGame(opponent, variant, modelFile);
    store.lastResult = null;
    store.canUndo = !!store.state.can_undo;
    // AI 执先手时（REST 契约 ai_to_move），开局即触发 AI 行动
    if (store.state.ai_to_move === true) {
      await maybeBotTurn();
    }
  } catch (e) {
    console.error('Reset game failed:', e);
    toast.error('重置游戏失败: ' + e);
  }
}

/** 把文本写入剪贴板（优先 Clipboard API，不可用时退化为临时 textarea + execCommand）。 */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand('copy')) throw new Error('execCommand(copy) 返回 false');
  } finally {
    document.body.removeChild(ta);
  }
}

/** 复制当前局面 BFEN 串（含变体 / 盘面 / 行棋方 / 血量 / 暗子袋）。 */
async function copyFen() {
  const fen = store.state?.fen;
  if (!fen) {
    toast.error('当前局面无 FEN 数据');
    return;
  }
  try {
    await copyToClipboard(fen);
    appendLog(`复制局面 FEN: ${fen}`);
    toast.success('局面 FEN 已复制到剪贴板', 2000);
  } catch (e) {
    console.error('Copy FEN failed:', e);
    toast.error('复制失败: ' + e);
  }
}

/** 由 BFEN 局面串重建对局（变体以 BFEN 为准；走子历史清空，不可悔棋）。
 *  modelFile：AI 对局绑定的模型（.onnx → MCTS+ONNX，.nnue → Expectimax+NNUE）。 */
async function loadFen(fenInput: string, modelFile?: string) {
  const fen = fenInput.trim();
  if (!fen || store.busy) return;
  store.selectedSquare = null;
  store.moveHighlights = new Map();
  store.inspectPly = null;
  try {
    store.state = await api.loadFen(fen, modelFile);
    store.lastResult = null;
    store.canUndo = !!store.state.can_undo;
    appendLog(`由 FEN 重建对局（变体 ${store.state.variant}）: ${fen}`);
    // 重建后轮到 AI 时（REST 契约 ai_to_move），立即触发 AI 行动
    if (store.state.ai_to_move === true) {
      await maybeBotTurn();
    }
  } catch (e) {
    console.error('Load FEN failed:', e);
    toast.error('重建对局失败: ' + e);
  }
}

async function loadInitialState() {
  try {
    store.state = await api.getGameState();
    store.canUndo = !!store.state.can_undo;
    store.inspectPly = null;
  } catch (e) {
    console.error('Failed to load initial state:', e);
    toast.error('加载初始状态失败: ' + e, 5000);
  }
}

/** 决策历史查看：点选某手后棋盘高亮 from/to，再次点选取消。 */
function inspectMove(ply: number | null) {
  store.inspectPly = store.inspectPly === ply ? null : ply;
}

/** 当前查看手的 from/to 高亮标记（供 BoardView 传给 BoardGrid markers）。 */
const inspectMarkers = computed<number[]>(() => {
  if (store.inspectPly == null) return [];
  const m = store.state?.history?.find((h) => h.ply === store.inspectPly);
  return m ? (m.from === m.to ? [m.to] : [m.from, m.to]) : [];
});

export function useGame() {
  return {
    store,
    statusText,
    inspectMarkers,
    inspectMove,
    loadInitialState,
    resetGame,
    copyFen,
    loadFen,
    undoMove,
    onSquareClick,
    deselect,
    isSelectable,
  };
}
