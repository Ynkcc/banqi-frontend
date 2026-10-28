import { reactive } from 'vue';
import { api } from '../api/client';
import type { ArchivedGameDetail, ArchivedGameSummary, ReplayResp } from '../api/types';
import { appendLog } from './useLogs';
import { useToast } from './useToast';
import { useGame } from './useGame';

const toast = useToast();

/** sessionStorage 键：某局推演的临时步数记忆。 */
const plyKey = (id: string) => `ttxq:replay-ply:${id}`;

interface RecentGamesStore {
  /** 最近对局归档列表（队首最新） */
  games: ArchivedGameSummary[];
  loading: boolean;
  error: string | null;
  /** 当前正在推演的归档局（null = 列表视图） */
  detail: ArchivedGameDetail | null;
  /** 当前推演的上帝视角回放 */
  replay: ReplayResp | null;
  /** 当前查看的局面态下标（0 = 初始局面，moves.length = 终局） */
  plyIndex: number;
  busy: boolean;
}

const store = reactive<RecentGamesStore>({
  games: [],
  loading: false,
  error: null,
  detail: null,
  replay: null,
  plyIndex: 0,
  busy: false,
});

/** 拉取最近对局列表（打开抽屉 / 手动刷新时调用）。 */
async function refresh() {
  if (store.loading) return;
  store.loading = true;
  store.error = null;
  try {
    store.games = await api.listRecentGames();
  } catch (e) {
    console.error('List recent games failed:', e);
    store.error = String(e);
  } finally {
    store.loading = false;
  }
}

/** 读取某局推演步数的临时记忆（sessionStorage，页面刷新即清空）。 */
function loadRememberedPly(id: string, maxIndex: number): number | null {
  try {
    const raw = sessionStorage.getItem(plyKey(id));
    if (raw === null) return null;
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 0 || v > maxIndex) return null;
    return v;
  } catch {
    return null;
  }
}

/** 记住某局当前推演步数（仅当正处于推演视图时）。 */
function rememberPly() {
  if (!store.detail || !store.replay) return;
  try {
    sessionStorage.setItem(plyKey(store.detail.game_id), String(store.plyIndex));
  } catch {
    /* 忽略存储异常 */
  }
}

/** 打开某局的推演视图：并行拉取归档详情与上帝视角回放，
 *  优先展示初始局面；若本次会话内此前浏览过该局，则恢复到上次所在步数。 */
async function openGame(id: string) {
  if (store.busy) return;
  store.busy = true;
  try {
    const [detail, replay] = await Promise.all([api.getRecentGame(id), api.getReplay(id)]);
    store.detail = detail;
    store.replay = replay;
    const remembered = loadRememberedPly(id, replay.moves.length);
    store.plyIndex = remembered ?? 0;
  } catch (e) {
    console.error('Open recent game failed:', e);
    toast.error('加载归档对局失败: ' + e);
  } finally {
    store.busy = false;
  }
}

/** 关闭推演视图，回到列表。 */
function closeGame() {
  store.detail = null;
  store.replay = null;
  store.plyIndex = 0;
}

/** 推演局面态步进（正 = 前进，负 = 后退），带边界钳制。 */
function stepPly(delta: number) {
  const total = (store.replay?.moves.length ?? 0) + 1;
  store.plyIndex = Math.min(total - 1, Math.max(0, store.plyIndex + delta));
  rememberPly();
}

/** 直接跳到某局面态。 */
function gotoPly(index: number) {
  const total = (store.replay?.moves.length ?? 0) + 1;
  store.plyIndex = Math.min(total - 1, Math.max(0, index));
  rememberPly();
}

/**
 * 复演：从归档的指定步数局面建一局新对局并切换为当前对局
 * （缺省双方 Human，fromPly = 0 表示从初始局面重走）。
 */
async function replayAsNew(id: string, fromPly = 0) {
  if (store.busy) return;
  store.busy = true;
  try {
    const state = await api.replayArchived(id, fromPly);
    const { store: game } = useGame();
    game.state = state;
    game.lastResult = null;
    game.canUndo = !!state.can_undo;
    game.selectedSquare = null;
    game.moveHighlights = new Map();
    game.inspectPly = null;
    game.suggestion = null;
    appendLog(
      `复演归档对局 ${id.slice(0, 8)}…：已从第 ${fromPly} 步局面建新局（双方默认本人操作）`,
    );
    toast.success(
      fromPly > 0 ? `复演对局已创建（从第 ${fromPly} 步重走）` : '复演对局已创建，可按原序列重走或修改角色',
    );
  } catch (e) {
    console.error('Replay archived game failed:', e);
    toast.error('复演失败: ' + e);
  } finally {
    store.busy = false;
  }
}

export function useRecentGames() {
  return { store, refresh, openGame, closeGame, stepPly, gotoPly, replayAsNew };
}
