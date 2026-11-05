import Alert from 'antd/es/alert'
import Card from 'antd/es/card'
import Drawer from 'antd/es/drawer'
import Progress from 'antd/es/progress'
import Space from 'antd/es/space'
import Table from 'antd/es/table'
import Tag from 'antd/es/tag'
import Tooltip from 'antd/es/tooltip'
import Typography from 'antd/es/typography'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { fmtNum, shortSha } from '../format'
import type { Match, MatchPairItem, MatchPairsPage } from '../types'
import { usePoll } from '../usePoll'

const verdictColor: Record<string, string> = {
  accept: 'green',
  reject: 'red',
  continue: 'blue',
}

/** 六类"对"结果桶（候选视角），顺序与列展示一致；W=候选胜 / L=负 / D=和 */
const PAIR_META = [
  { key: 'LL', label: '候选两局皆负' },
  { key: 'LD', label: '一负一和' },
  { key: 'DD', label: '两局皆和' },
  { key: 'WL', label: '一胜一负' },
  { key: 'DW', label: '一胜一和' },
  { key: 'WW', label: '候选两局皆胜' },
] as const

function PairResultTags({ results }: { results: string }) {
  return (
    <Space size={4}>
      {results.split('').map((ch, i) => (
        <Tag key={i} color={ch === 'W' ? 'green' : ch === 'L' ? 'red' : 'default'}>
          {ch === 'W' ? '胜' : ch === 'L' ? '负' : '和'}
        </Tag>
      ))}
    </Space>
  )
}

const itemColumns: TableProps<MatchPairItem>['columns'] = [
  {
    title: 'Episode',
    dataIndex: 'episodeId',
    width: 100,
    render: (v: number) => <Link to={`/replay?episode=${v}`}>#{v}</Link>,
  },
  { title: '对', dataIndex: 'pairIndex', width: 70 },
  {
    title: '局号',
    dataIndex: 'gameIndexes',
    render: (v: number[]) => v.map((x) => `#${x}`).join(' + '),
  },
  {
    title: '候选视角结果',
    dataIndex: 'results',
    render: (v: string) => <PairResultTags results={v} />,
  },
]

/** 点击 LL/LD/DD/WL/DW/WW 数字后的明细抽屉 */
function MatchPairsDrawer({
  match,
  catIndex,
  onClose,
}: {
  match: Match
  catIndex: number
  onClose: () => void
}) {
  const [data, setData] = useState<MatchPairsPage | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setData(null)
    setErr(null)
    api
      .matchPairs(match.id)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [match.id])

  const meta = PAIR_META[catIndex]
  const cat = data?.pairs.find((p) => p.category === meta.key)
  return (
    <Drawer
      title={`Match #${match.id} · ${meta.key}（${meta.label}）· ${match.pairs[catIndex]} 对`}
      width={560}
      open
      onClose={onClose}
      extra={
        <Link to={`/episodes?match=${match.id}`} onClick={onClose}>
          在对局记录中查看全部
        </Link>
      }
    >
      {err && <Alert type="error" showIcon message="加载分类明细失败" description={err} />}
      <Table<MatchPairItem>
        rowKey={(it) => `${it.episodeId}-${it.pairIndex}`}
        size="small"
        columns={itemColumns}
        dataSource={cat?.items ?? []}
        loading={data == null && !err}
        pagination={false}
        locale={{ emptyText: '该类别暂无明细（可能为旧数据缺局号/换手信息）' }}
      />
    </Drawer>
  )
}

export default function Matches() {
  const { data, error } = usePoll(api.matches, 5000)
  const [pairView, setPairView] = useState<{ match: Match; catIndex: number } | null>(null)

  const columns: TableProps<Match>['columns'] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: '候选',
      dataIndex: 'candidate',
      render: (v: string) => <Typography.Text code>{shortSha(v)}</Typography.Text>,
    },
    {
      title: '对手 best',
      dataIndex: 'opponent',
      render: (v: string) => <Typography.Text code>{shortSha(v)}</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (v: string) => <Tag color={v === 'running' ? 'processing' : 'default'}>{v}</Tag>,
    },
    {
      title: '进度（局）',
      width: 180,
      render: (_, m) => (
        <Progress
          percent={m.targetGames > 0 ? Math.min(100, Math.round((m.numGames / (m.targetGames * 2)) * 100)) : 0}
          size="small"
          format={() => `${m.numGames}/${m.targetGames * 2}`}
        />
      ),
    },
    {
      title: 'LL / LD / DD / WL / DW / WW（对）',
      render: (_, m) => (
        <Space size={6} wrap>
          {PAIR_META.map((p, i) => (
            <Tooltip key={p.key} title={`${p.key}（${p.label}）：${m.pairs[i]} 对${m.pairs[i] > 0 ? '，点击查看明细' : ''}`}>
              {m.pairs[i] > 0 ? (
                <Typography.Link onClick={() => setPairView({ match: m, catIndex: i })}>
                  {m.pairs[i]}
                </Typography.Link>
              ) : (
                <Typography.Text type="secondary">{m.pairs[i]}</Typography.Text>
              )}
            </Tooltip>
          ))}
        </Space>
      ),
    },
    {
      title: '得分率',
      render: (_, m) => (m.score === null ? '-' : `${(m.score * 100).toFixed(1)}%`),
    },
    {
      title: 'LLR',
      width: 220,
      render: (_, m) =>
        m.conclusion ? (
          <Tooltip
            title={`判停时持久化：LLR=${fmtNum(m.conclusion.llr, 3)} · elo0=${m.conclusion.sprtElo0} · elo1=${m.conclusion.sprtElo1} · α=${m.conclusion.sprtAlpha} · β=${m.conclusion.sprtBeta}`}
          >
            <Typography.Text>
              {fmtNum(m.conclusion.llr, 3)}{' '}
              <Typography.Text type="secondary">(elo0={m.conclusion.sprtElo0} · elo1={m.conclusion.sprtElo1})</Typography.Text>
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text>
            {fmtNum(m.llr, 3)} <Typography.Text type="secondary">({fmtNum(m.lower, 2)} ~ {fmtNum(m.upper, 2)})</Typography.Text>
          </Typography.Text>
        ),
    },
    {
      title: 'SPRT 判定',
      dataIndex: 'verdict',
      render: (_, m) => {
        const v = m.conclusion?.verdict ?? m.verdict
        const tip = m.conclusion
          ? `判停时刻持久化的结论（基于该任务自带的 SPRT 参数：elo0=${m.conclusion.sprtElo0} · elo1=${m.conclusion.sprtElo1} · α=${m.conclusion.sprtAlpha} · β=${m.conclusion.sprtBeta}）；上方 LLR 为实时用全局配置重算的预览值`
          : undefined
        return (
          <Tooltip title={tip}>
            <Tag color={verdictColor[v] ?? 'default'}>{v}</Tag>
          </Tooltip>
        )
      },
    },
  ]

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/matches 失败" description={error} />
  }

  return (
    <Card size="small" title={`Gatekeeper 对战（${data?.length ?? 0}）`}>
      <Table<Match> rowKey="id" size="small" columns={columns} dataSource={data ?? []} pagination={false} />
      {pairView && (
        <MatchPairsDrawer
          match={pairView.match}
          catIndex={pairView.catIndex}
          onClose={() => setPairView(null)}
        />
      )}
    </Card>
  )
}
