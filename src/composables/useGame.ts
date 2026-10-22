import { computed, reactive, watch } from 'vue';
import { api } from '../api/client';
import type { GameState, HistoryMove, OpeningScenarioCfg, Slot, SlotCfg, SlotsCfg, SlotKind, Suggestion, Variant } from '../api/types';
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
  /** dry-run 建议走法（null = 无；仅当 version 与当前状态一致时展示高亮） */
  suggestion: Suggestion | null;
  /** auto 自动对弈开关（前端循环调 run；切槽位到 Human / 终局 / 手动暂停即停） */
  autoEnabled: boolean;
}

const store = reactive<GameStore>({
  state: null,
  busy: false,
  selectedSquare: null,
  moveHighlights: new Map(),
  lastResult: null,
  canUndo: false,
  inspectPly: null,
  suggestion: null,
  autoEnabled: false,
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
  store.suggestion = null;
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
  // 预算口径按模式下发（0 = 不限；time_limit_ms 为新后端附带的时间上限）
  const modeLabel =
    stats.mode === 'nodes'
      ? '节点预算'
      : stats.mode === 'time'
        ? '时间预算'
        : '深度+节点';
  const budgetPart =
    stats.mode === 'time'
      ? `时限 ${stats.time_limit_ms ?? '?'} ms`
      : `深度上限 ${stats.depth || '∞'}（完成 ${stats.reached_depth} 层），节点 ${stats.nodes}/${stats.budget || '∞'}`;
  appendLog(
    `NNUE 搜索 [${modeLabel}]: ${budgetPart}，耗时 ${stats.elapsed_ms} ms`,
  );
}

/**
 * 单步推进：当前行棋方按其槽位策略执行一步（run）。
 * 仅当当前方为策略（can_run）时可用；Human 方调用会得到 409 HUMAN_TURN。
 */
async function runStep() {
  const s = store.state;
  if (!s || store.busy || !s.can_run) return;
  store.busy = true;
  try {
    const prev = store.state;
    if (!prev) return;
    const result = await api.runStep();
    await applyStep(prev, result);
    if (result.mcts_stats) logMctsStats(result.mcts_stats);
    if (result.nnue_stats) logNnueStats(result.nnue_stats);
  } catch (e) {
    console.error('run_step failed:', e);
    toast.error('策略走子失败: ' + e);
  } finally {
    store.busy = false;
  }
}

/**
 * auto 自动对弈：循环调 run 直到终局 / 当前方变为 Human / 建议变更打断。
 * 每步后重新检查状态（终局、can_run、autoEnabled），人类可随时接管
 * （把当前方槽位切回 Human 即自然停止）。
 */
async function autoLoop() {
  while (store.autoEnabled && store.state && store.state.can_run && !store.busy) {
    const over = store.lastResult?.terminated || store.lastResult?.truncated;
    if (over) break;
    await runStep();
    // runStep 失败时 toast 已提示；停止循环避免刷屏
    if (store.state && store.lastResult) {
      const r = store.lastResult;
      if (r.terminated || r.truncated) break;
    } else {
      break;
    }
  }
  store.autoEnabled = false;
}

/** 双方槽位是否均已托管（策略 / Agent）——托管完成后自动对弈的自然入口。 */
function bothSidesAutomated(): boolean {
  const s = store.state;
  return !!s?.slots && s.slots.red.kind !== 'Human' && s.slots.black.kind !== 'Human';
}

/**
 * dry-run：为当前行棋方请求其策略的建议走法并高亮（不落子）。
 * 托管方预览 AI 将走的棋；Human 方作为提示（服务端缺省用 Expectimax）。
 * 建议仅在版本号一致时展示，任何状态变更（走子/悔棋/策略回合）即失效。
 */
async function requestDryRun() {
  const s = store.state;
  if (!s || store.busy) return;
  store.busy = true;
  try {
    store.suggestion = null;
    const suggestion = await api.dryRun();
    // 版本号校验：请求期间状态变化则丢弃（防过期高亮）
    if (store.state && suggestion.version === store.state.version) {
      store.suggestion = suggestion;
      const desc = suggestion.is_flip
        ? `翻棋 位置${suggestion.to}`
        : `位置${suggestion.from} → 位置${suggestion.to}`;
      const scoreText = suggestion.score !== undefined ? `（评分 ${suggestion.score.toFixed(3)}）` : '';
      appendLog(`[dry-run] ${suggestion.player === 'Red' ? '红方' : '黑方'} 建议走法: ${desc}${scoreText}`);
    }
  } catch (e) {
    console.error('dry_run failed:', e);
    toast.error('获取建议走法失败: ' + e);
  } finally {
    store.busy = false;
  }
}

/** 清除 dry-run 建议（状态变化 / 用户点击时）。 */
function clearSuggestion() {
  store.suggestion = null;
}

async function doMove(action: number) {
  if (!store.state || store.busy) return;
  const prev = store.state;
  store.busy = true;
  try {
    const result = await api.stepGame(action);
    await applyStep(prev, result);
    // server 在 /move 内已代跑对方策略回合，此处附带其搜索统计
    if (result.mcts_stats) logMctsStats(result.mcts_stats);
    if (result.nnue_stats) logNnueStats(result.nnue_stats);
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
    store.suggestion = null;
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
  // 当前方为策略托管：不接受手动走子（接管请先将该方槽位切回 Human）
  if (s.can_run) {
    toast.info('当前行棋方由策略托管（接管请先将该方槽位切回本人操作）', 2500);
    return;
  }
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

/** 槽位种类的可读标签。 */
function slotKindLabel(kind: SlotKind): string {
  const labels: Record<SlotKind, string> = {
    Human: '本人操作',
    Agent: 'Agent',
    Random: '随机',
    RevealFirst: '优先翻棋',
    CaptureFirst: '优先吃子',
    Expectimax: 'Expectimax',
    ExpectimaxNnue: 'Expectimax+NNUE',
    MctsOnnx: 'MCTS+ONNX',
    MctsDL: 'MCTS+DL',
  };
  return labels[kind] ?? kind;
}

/** 对局中切换任一方槽位（PUT /slots；后续触发由状态侦听器统一反应）。 */
async function applySlots(partial: { red?: SlotCfg; black?: SlotCfg }) {
  if (store.busy || !store.state) return;
  try {
    const sideLabel = (s: 'red' | 'black') =>
      partial[s] ? `${s === 'red' ? '红方' : '黑方'}→${slotKindLabel(partial[s]!.kind)}` : '';
    appendLog(`切换槽位: ${[sideLabel('red'), sideLabel('black')].filter(Boolean).join('，')}`);
    store.state = await api.setSlots(partial);
    store.canUndo = !!store.state.can_undo;
    store.suggestion = null;
  } catch (e) {
    console.error('Set slots failed:', e);
    toast.error('切换槽位失败: ' + e);
  }
}

async function resetGame(slots: SlotsCfg, variant: Variant, scenario?: OpeningScenarioCfg) {
  if (store.busy) return;
  store.selectedSquare = null;
  store.moveHighlights = new Map();
  store.inspectPly = null;
  store.suggestion = null;
  try {
    appendLog(
      `开始新游戏（变体 ${variant}，红方 ${slotKindLabel(slots.red.kind)}` +
        `，黑方 ${slotKindLabel(slots.black.kind)}` +
        `${slots.red.model_file ? `，红方模型 ${slots.red.model_file}` : ''}` +
        `${slots.black.model_file ? `，黑方模型 ${slots.black.model_file}` : ''}` +
        `${scenario ? `，开局场景 ${scenario.kind}` : ''}）`,
    );
    store.state = await api.resetGame(slots, variant, undefined, scenario);
    store.lastResult = null;
    store.canUndo = !!store.state.can_undo;
    // 策略回合 / 自动对弈由状态侦听器统一反应（见下方 watch）
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
 *  槽位配置沿用当前设置（模型类策略沿用绑定模型）。 */
async function loadFen(fenInput: string) {
  const fen = fenInput.trim();
  if (!fen || store.busy) return;
  store.selectedSquare = null;
  store.moveHighlights = new Map();
  store.inspectPly = null;
  store.suggestion = null;
  try {
    store.state = await api.loadFen(fen);
    store.lastResult = null;
    store.canUndo = !!store.state.can_undo;
    appendLog(`由 FEN 重建对局（变体 ${store.state.variant}）: ${fen}`);
    // 重建后轮到策略方时（can_run 契约），由状态侦听器统一反应
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

/**
 * dry-run 建议走法的 from/to（供 BoardView 传给 BoardGrid suggest 高亮）。
 * 仅当建议版本号与当前状态版本号一致时有效（防过期高亮）。
 */
const suggestionSquares = computed<{ from: number; to: number } | null>(() => {
  const sug = store.suggestion;
  if (!sug || !store.state || sug.version !== store.state.version) return null;
  return { from: sug.from, to: sug.to };
});

// ============================================================================
// 事件响应式调度（单一调度点）
//
// 状态（store.state）是唯一事实源：任何来源的变更——人类走子 / run 单步 /
// 换槽位 / FEN 重建 / 页面加载恢复——都经此侦听器统一反应，取代散落在
// 各 handler 里的手动触发。规则：
//
// - 无对局 / 终局 → 停止自动对弈；
// - 双方均已托管（策略 / Agent）且轮到策略方 → 启动自动对弈循环
//   （幂等：已在跑则不重复启动；循环每步产出的新状态再次进入本侦听器）；
// - 任一方为 Human → 停止循环（解除任一方托管即人类接管 / 暂停）；
// - 单方托管且轮到该方（刚换槽位 / 恢复进行中的对局）→ 该方走一步。
// ============================================================================

watch(
  () => store.state,
  (s) => {
    if (!s) {
      store.autoEnabled = false;
      return;
    }
    if (s.over) {
      if (store.autoEnabled) {
        store.autoEnabled = false;
        appendLog('对局结束，自动对弈停止');
      }
      return;
    }
    if (bothSidesAutomated()) {
      if (s.can_run && !store.autoEnabled) {
        store.autoEnabled = true;
        appendLog('双方均已托管，自动对弈开始（解除任一方托管即暂停）');
        void autoLoop();
      }
      return;
    }
    // 存在 Human 方：不开循环；但单方托管且正轮到该方时走一步
    // （换槽位 / 页面恢复后当前方恰为策略方的场景；busy 时跳过——
    // 在途操作完成后会带来新状态，再次进入本侦听器）
    if (store.autoEnabled) {
      store.autoEnabled = false;
      appendLog('自动对弈已暂停（人类接管）');
    }
    if (s.can_run && !store.busy) {
      void runStep();
    }
  },
);

export function useGame() {
  return {
    store,
    statusText,
    inspectMarkers,
    inspectMove,
    suggestionSquares,
    loadInitialState,
    resetGame,
    copyFen,
    loadFen,
    undoMove,
    onSquareClick,
    deselect,
    isSelectable,
    runStep,
    requestDryRun,
    clearSuggestion,
    applySlots,
    slotKindLabel,
  };
}
