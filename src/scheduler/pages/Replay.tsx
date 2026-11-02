import { Alert, Button, Card, Progress, Segmented, Select, Slider, Space, Statistic, Tag, Typography } from 'antd'
import {
  CaretRightOutlined,
  LeftOutlined,
  PauseOutlined,
  RightOutlined,
  StepBackwardFilled,
  StepForwardFilled,
} from '@ant-design/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import './Replay.css'
import BoardGrid from '../components/BoardGrid'
import { actionToCoords, Sparkline } from '../domain/actions'
import { PIECE_META } from '../domain/pieces'
import { api } from '../api'
import type { HiddenBag, ReplayGame, ReplayList, ReplayStep } from '../types'

const WINNER_LABEL: Record<string, string> = {
  decisive: '分胜负',
  quiet_draw: '未吃子和（DD）',
  max_steps: '步数截断',
  aborted: '作废',
  unspecified: '未标注',
}

const KIND_LABEL: Record<string, string> = {
  flip: '翻棋',
  move: '移动',
  capture: '吃子',
  'reveal-attack': '吃暗子',
}

const BAG_TYPES = ['Soldier', 'Cannon', 'Horse', 'Chariot', 'Elephant', 'Advisor', 'General'] as const

function BagRow({ counts, side }: { counts: number[]; side: 'red' | 'black' }) {
  return (
    <div className="replay-bag-row">
      <Tag color={side === 'red' ? 'red' : 'black'} style={{ marginRight: 8 }}>
        {side === 'red' ? '红' : '黑'}
      </Tag>
      {BAG_TYPES.map((t, i) => (
        <span key={t} className={`replay-bag-item${counts[i] === 0 ? ' zero' : ''}`}>
          {PIECE_META[t][side]}
          <em>×{counts[i]}</em>
        </span>
      ))}
    </div>
  )
}

function variantDims(variant: string): { rows: number; cols: number } {
  const m = /^(\d+)x(\d+)/.exec(variant ?? '')
  if (m) return { rows: Number(m[1]), cols: Number(m[2]) }
  return { rows: 4, cols: 8 }
}

function winnerTag(w: number | null | undefined) {
  if (w === null || w === undefined) return <Tag>作废</Tag>
  if (w > 0) return <Tag color="red">红胜</Tag>
  if (w < 0) return <Tag color="black">黑胜</Tag>
  return <Tag color="default">和棋</Tag>
}

export default function Replay() {
  const [params] = useSearchParams()
  const episodeId = params.get('episode')
  const [list, setList] = useState<ReplayList | null>(null)
  const [listError, setListError] = useState<string>()
  const [gameIndex, setGameIndex] = useState(0)
  const [game, setGame] = useState<ReplayGame | null>(null)
  const [gameError, setGameError] = useState<string>()
  const [cursor, setCursor] = useState(0) // 0 = 初始局面；i = 第 i 手后的局面
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal')
  const [showPolicy, setShowPolicy] = useState(true)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!episodeId) return
    setList(null)
    setGame(null)
    setListError(undefined)
    api
      .replayGames(episodeId)
      .then((d) => {
        setList(d)
        setGameIndex(0)
      })
      .catch((e) => setListError(String(e.message ?? e)))
  }, [episodeId])

  useEffect(() => {
    if (!episodeId || !list) return
    setGame(null)
    setGameError(undefined)
    setCursor(0)
    setPlaying(false)
    api
      .replayGame(episodeId, gameIndex)
      .then(setGame)
      .catch((e) => setGameError(String(e.message ?? e)))
  }, [episodeId, list, gameIndex])

  const total = game?.moves.length ?? 0
  const speedMs = speed === 'slow' ? 1200 : speed === 'fast' ? 250 : 600

  useEffect(() => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    if (!playing || total === 0) return
    timerRef.current = window.setInterval(() => {
      setCursor((c) => {
        if (c >= total) {
          setPlaying(false)
          return c
        }
        return c + 1
      })
    }, speedMs)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [playing, total, speedMs])

  const dims = useMemo(() => variantDims(list?.variant ?? '4x8'), [list?.variant])
  const step: ReplayStep | null = cursor > 0 && game ? game.moves[cursor - 1] : null
  // cursor == total（末手行动后）显示终局盘面；其余显示该手行动前局面。
  const atEnd = cursor >= total && !!game?.finalBoard
  const board = atEnd ? game!.finalBoard : step ? step.board : (game?.initialBoard ?? [])
  const shown = atEnd ? game!.finalShown : step ? step.revealedAt : (game?.initialShown ?? [])
  const bag: HiddenBag | null = atEnd
    ? (game?.finalBag ?? null)
    : step
      ? step.hiddenBag
      : (game?.initialBag ?? null)
  const moveCounter = step ? step.moveCounter : 0
  const maxDraw = dims.rows === 4 && dims.cols === 8 ? 24 : 16
  const drawRatio = Math.min(100, Math.round((moveCounter / maxDraw) * 100))

  // 教师根策略热力（当前手）：action → 目标格，值归一化到当步 max。
  const policyHot = useMemo(() => {
    const m = new Map<number, number>()
    if (!step?.policyActions || !step.policyValues) return m
    const table = actionToCoords(dims.rows, dims.cols)
    const maxV = Math.max(...step.policyValues, 0)
    if (maxV <= 0) return m
    step.policyActions.forEach((a, k) => {
      if (k >= step.policyValues!.length) return
      const v = step.policyValues![k] / maxV
      const to = a < table.length ? table[a][1] : -1
      if (to < 0) return
      m.set(to, Math.max(m.get(to) ?? 0, v))
    })
    return m
  }, [step, dims])

  // 走势序列：红方视角搜索值 + 暗子数（截至当前 cursor）。
  const valueSeries = useMemo(() => {
    if (!game) return []
    return game.moves.slice(0, cursor).map((m) => m.searchValue * (m.player === 'Red' ? 1 : -1))
  }, [game, cursor])
  const hiddenSeries = useMemo(() => {
    if (!game) return []
    return game.moves.slice(0, cursor).map((m) => m.hiddenCount)
  }, [game, cursor])

  if (!episodeId) {
    return <Alert type="info" showIcon message="缺少 episode 参数" description="从对局记录列表页的「回放」入口进入。" />
  }
  if (listError) {
    return <Alert type="error" showIcon message="加载回放索引失败" description={listError} />
  }

  const options = (list?.games ?? []).map((g) => ({
    value: g.index,
    label: `第 ${g.index + 1} 局 · 对#${g.pairIndex}-${g.pairPosition === 0 ? '一' : '二'} · ${
      g.redIsA ? 'A执红' : 'A执黑'
    } · ${g.steps} 手 · ${
      g.winner === null || g.winner === undefined ? '作废' : g.winner > 0 ? '红胜' : g.winner < 0 ? '黑胜' : '和棋'
    } · ${WINNER_LABEL[g.termination] ?? g.termination}${g.hasSeed ? (g.seedRefreshed ? ' · 刷新种子' : '') : ' · 无种子'}`,
  }))

  return (
    <Card
      size="small"
      title={`对局回放 · 对局记录 #${episodeId}${list ? `（${list.variant}，共 ${list.games.length} 局）` : ''}`}
      extra={
        <Space>
          <Select
            style={{ width: 380 }}
            loading={!list}
            value={gameIndex}
            onChange={setGameIndex}
            options={options}
          />
        </Space>
      }
    >
      {list && list.kind === 'resnet' && (
        <Alert type="warning" showIcon message="该对象为 ResNet/MCTS 记录，NNUE 专属诊断（教师标注等）不可用" style={{ marginBottom: 12 }} />
      )}
      {gameError && <Alert type="error" showIcon message="重建对局失败" description={gameError} />}
      <div className="replay-layout">
        <div className="replay-board-panel">
          <BoardGrid
            board={board}
            shown={shown}
            cols={dims.cols}
            lastFrom={step?.from}
            lastTo={step?.to}
            policyHot={showPolicy ? policyHot : undefined}
          />
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Slider min={0} max={total} value={cursor} onChange={(v) => setCursor(v)} />
            <Space wrap>
              <Button icon={<StepBackwardFilled />} disabled={cursor === 0} onClick={() => setCursor(0)} />
              <Button icon={<LeftOutlined />} disabled={cursor === 0} onClick={() => setCursor(cursor - 1)} />
              <Button
                type="primary"
                icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
                disabled={total === 0}
                onClick={() => {
                  if (!playing && cursor >= total) setCursor(0)
                  setPlaying(!playing)
                }}
              />
              <Button
                icon={<RightOutlined />}
                disabled={cursor >= total}
                onClick={() => setCursor(cursor + 1)}
              />
              <Button
                icon={<StepForwardFilled />}
                disabled={cursor >= total}
                onClick={() => setCursor(total)}
              />
              <Segmented
                size="small"
                value={speed}
                onChange={(v) => setSpeed(v as typeof speed)}
                options={[
                  { label: '慢', value: 'slow' },
                  { label: '中', value: 'normal' },
                  { label: '快', value: 'fast' },
                ]}
              />
              <Segmented
                size="small"
                value={showPolicy ? 'on' : 'off'}
                onChange={(v) => setShowPolicy(v === 'on')}
                options={[
                  { label: '策略热力 开', value: 'on' },
                  { label: '关', value: 'off' },
                ]}
              />
              <Typography.Text type="secondary">
                第 {cursor}/{total} 手
              </Typography.Text>
            </Space>
          </div>
        </div>

        <div className="replay-side">
          {game && (
            <>
              <Space wrap size={4}>
                {winnerTag(game.winner)}
                <Tag color={game.termination === 'quiet_draw' ? 'orange' : 'default'}>
                  {WINNER_LABEL[game.termination] ?? game.termination}
                </Tag>
                <Tag>记录步数 {game.gameLength}</Tag>
                <Tag color={game.redIsA ? 'red' : 'black'}>
                  换手：A{game.redIsA ? '执红' : '执黑'}
                </Tag>
                {list && (
                  <Tag>
                    对 #{list.games[game.index]?.pairIndex ?? '-'}-
                    {list.games[game.index]?.pairPosition === 0 ? '一' : '二'}
                  </Tag>
                )}
                {game.hasSeed ? (
                  <Space size={2} wrap>
                    <Tag color="purple">seed {game.seed}</Tag>
                    {list?.games[game.index]?.seedRefreshed && <Tag color="orange">对内刷新</Tag>}
                  </Space>
                ) : (
                  <Tag color="red">无种子</Tag>
                )}
              </Space>
              {game.aSideOnly && (
                <Alert
                  type="info"
                  showIcon
                  message="单方面视角录制"
                  description="本 episode 仅记录产数据方的行动步，对手的行动未记录——「红方/黑方」指产数据方执子色彩，步与步之间隔着对手的未记录行动。棋盘/分数以特征编码的精确局面为准。"
                />
              )}
              <Card size="small" title="对局双方（暗棋红先，红方 = 第 0 步行棋方）">
                <div className="replay-score-row">
                  <Tag color="red">红方</Tag>
                  <Typography.Text>{game.redIsA ? game.sideA : game.sideB}</Typography.Text>
                </div>
                <div className="replay-score-row">
                  <Tag>黑方</Tag>
                  <Typography.Text>{game.redIsA ? game.sideB : game.sideA}</Typography.Text>
                </div>
              </Card>
              <Card size="small" title="连续无吃子（未吃子判和阈值）">
                <Progress
                  percent={drawRatio}
                  status={moveCounter >= maxDraw ? 'exception' : drawRatio > 66 ? 'active' : 'normal'}
                  format={() => `${moveCounter}/${maxDraw}`}
                />
                <Typography.Text type="secondary">
                  观察 DD：双方连续 {maxDraw} 步无吃子即判和。回放中留意连续「移动」段。
                </Typography.Text>
              </Card>
              <Card size="small" title="子力分（随吃子扣减）">
                <div className="replay-score-row">
                  <Tag color="red">红</Tag>
                  <Statistic value={step ? step.scores[0] : 0} valueStyle={{ fontSize: 20 }} />
                  <span style={{ opacity: 0.4 }}>vs</span>
                  <Statistic value={step ? step.scores[1] : 0} valueStyle={{ fontSize: 20 }} />
                  <Tag>黑</Tag>
                </div>
              </Card>
              {bag && (
                <Card size="small" title="暗子袋（未翻开，按类型）">
                  <BagRow counts={bag.red} side="red" />
                  <BagRow counts={bag.black} side="black" />
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    暗子身份来自底牌布局（上帝视角）；对局者视角仅知袋内计数分布。
                  </Typography.Text>
                </Card>
              )}
              <Card size="small" title="搜索值走势（红方视角，教师根值）">
                <Sparkline values={valueSeries} color="#1677ff" zeroLine />
                <div className="replay-chart-label">
                  暗子数走势（步前，记录值 {step ? step.hiddenCount : '—'}）
                </div>
                <Sparkline values={hiddenSeries} color="#8b5cf6" />
              </Card>
              {step && (
                <Card size="small" title="当前手">
                  <Space wrap size={4}>
                    <Tag color={step.player === 'Red' ? 'red' : 'black'}>{step.player === 'Red' ? '红方' : '黑方'}</Tag>
                    <Tag color={step.kind === 'flip' ? 'geekblue' : step.kind === 'move' ? 'default' : 'volcano'}>
                      {KIND_LABEL[step.kind] ?? step.kind}
                    </Tag>
                    {step.revealed && <Tag color="purple">翻出 {step.revealed}</Tag>}
                    {step.captured && <Tag color="volcano">吃掉 {step.captured}</Tag>}
                    <Typography.Text type="secondary">action={step.action}</Typography.Text>
                  </Space>
                  <div className="replay-diag-grid" style={{ marginTop: 8 }}>
                    <span className="k">搜索根值</span>
                    <span className="v">{step.searchValue.toFixed(4)}</span>
                    <span className="k">行棋方值</span>
                    <span className="v">{step.playerValue.toFixed(4)}</span>
                    <span className="k">搜索深度</span>
                    <span className="v">{step.searchDepth || '—'}</span>
                    <span className="k">节点数</span>
                    <span className="v">{step.searchNodes ? step.searchNodes.toLocaleString() : '—'}</span>
                    <span className="k">暗子数</span>
                    <span className="v">{step.hiddenCount || '—'}</span>
                    <span className="k">探索损失</span>
                    <span className={'v' + (step.chosenValueGap > 0 ? ' replay-diag-warn' : '')}>
                      {step.chosenValueGap ? step.chosenValueGap.toFixed(4) : '—'}
                    </span>
                    <span className="k">探索采样</span>
                    <span className={'v' + (step.explRandom ? ' replay-diag-warn' : '')}>
                      {step.explRandom ? '是（偏离 argmax）' : '否'}
                    </span>
                    <span className="k">教师 argmax</span>
                    <span
                      className={'v' + (step.labelerAction !== null && step.labelerAction !== step.action ? ' replay-diag-warn' : '')}
                    >
                      {step.labelerAction === null ? '—' : `${step.labelerAction}${step.labelerAction !== step.action ? ' ≠ 实际' : ' = 实际'}`}
                    </span>
                    <span className="k">教师回退</span>
                    <span className={'v' + (step.labelerFallback ? ' replay-diag-warn' : '')}>
                      {step.labelerFallback ? '是（标签回退）' : '否'}
                    </span>
                    <span className="k">策略动作数</span>
                    <span className="v">{step.policyActions?.length ?? '—'}</span>
                  </div>
                  {step.policyValues && step.policyValues.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        教师根策略 Top-5（值，行棋方视角；棋盘绿框 = 热力）
                      </Typography.Text>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {step.policyValues
                          .map((v, k) => ({ v, a: step.policyActions![k] }))
                          .sort((x, y) => y.v - x.v)
                          .slice(0, 5)
                          .map(({ v, a }) => (
                            <Tag key={a} color={a === step.action ? 'green' : 'default'}>
                              {a}: {v.toFixed(3)}
                            </Tag>
                          ))}
                      </div>
                    </div>
                  )}
                </Card>
              )}
              {game && game.labelerTotal > 0 && (
                <Card size="small" title="决策一致性（全局）">
                  <Progress
                    percent={Math.round(game.labelerAgree * 100)}
                    format={() => `${Math.round(game.labelerAgree * 100)}%`}
                    status={game.labelerAgree < 0.8 ? 'exception' : 'normal'}
                  />
                  <Typography.Text type="secondary">
                    教师 argmax 与实际落子同意率（{game.labelerTotal} 个有效步）；低一致率 + 高探索损失 = 采样噪声大。
                  </Typography.Text>
                </Card>
              )}
              {game && game.explCount > 0 && (
                <Card size="small" title="探索采样（全局）">
                  <Statistic value={game.explCount} suffix={`/ ${game.steps} 步`} valueStyle={{ fontSize: 20 }} />
                  <Typography.Text type="secondary">
                    因探索采样（温度 softmax）偏离搜索 argmax 的步数；这类步的价值/策略标签噪声更大，训练侧可据此降权或过滤。
                  </Typography.Text>
                </Card>
              )}
              <Card size="small" title="棋谱" styles={{ body: { padding: 0 } }}>
                <div className="replay-move-list">
                  {game.moves.map((m) => (
                    <div
                      key={m.ply}
                      className={`replay-move-item${cursor - 1 === m.ply ? ' active' : ''}`}
                      onClick={() => setCursor(m.ply + 1)}
                    >
                      {m.ply + 1}. {m.player === 'Red' ? '红' : '黑'} {KIND_LABEL[m.kind] ?? m.kind}
                      {m.revealed ? `（${m.revealed}）` : ''}
                      {m.explRandom && <Tag className="replay-expl-tag">探索</Tag>}
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
