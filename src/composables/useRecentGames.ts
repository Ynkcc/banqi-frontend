import { reactive } from 'vue';
import { api } from '../api/client';
import type { ArchivedGameDetail, ArchivedGameSummary, ReplayResp } from '../api/types';
import { appendLog } from './useLogs';
import { useToast } from './useToast';
import { useGame } from './useGame';

const toast = useToast();

interface RecentGamesStore {
  /** 最近对局归档列表（队首最新） */
  games: ArchivedGameSummary[];
  loading: boolean;
  error: string | null;
  /** 当前正在推演的归档局（null = 列表视图） */
  detail: ArchivedGameDetail | null;
  /** 当前推演的逐 ply 局面序列 */
  replay: ReplayResp | null;
  /** 当前查看的 ply 下标（0 = 初始局面） */
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

/** 打开某局的推演视图：并行拉取归档详情与逐 ply 重放，默认停在终局。 */
async function openGame(id: string) {
  if (store.busy) return;
  store.busy = true;
  try {
    const [detail, replay] = await Promise.all([api.getRecentGame(id), api.getReplay(id)]);
    store.detail = detail;
    store.replay = replay;
    store.plyIndex = replay.plies.length - 1;
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

/** 推演 ply 步进（正 = 前进，负 = 后退），带边界钳制。 */
function stepPly(delta: number) {
  const total = store.replay?.plies.length ?? 1;
  store.plyIndex = Math.min(total - 1, Math.max(0, store.plyIndex + delta));
}

/** 直接跳到某 ply。 */
function gotoPly(index: number) {
  const total = store.replay?.plies.length ?? 1;
  store.plyIndex = Math.min(total - 1, Math.max(0, index));
}

/**
 * 复演：从归档初始局面建一局新对局并切换为当前对局
 * （缺省双方 Human——可在主棋盘按原序列重走，也可改槽位换 AI 再战）。
 */
async function replayAsNew(id: string) {
  if (store.busy) return;
  store.busy = true;
  try {
    const state = await api.replayArchived(id);
    const { store: game } = useGame();
    game.state = state;
    game.lastResult = null;
    game.canUndo = !!state.can_undo;
    game.selectedSquare = null;
    game.moveHighlights = new Map();
    game.inspectPly = null;
    game.suggestion = null;
    appendLog(`复演归档对局 ${id.slice(0, 8)}…：已从初始局面建新局（双方默认本人操作）`);
    toast.success('复演对局已创建，可按原序列重走或修改角色');
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
