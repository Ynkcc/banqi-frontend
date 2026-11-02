import { Alert, Button, Card, Input, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { fmtTime, kindTagColor, shortSha, winnerText } from '../format'
import type { Episode, EpisodeGame, GameLookupItem } from '../types'
import { usePoll } from '../usePoll'

const limit = 100

/** 换手标识：玩家 A（产数据方）是否执红。对内两局应互补。 */
function aIsRedTag(aIsRed: boolean) {
  return aIsRed ? <Tag color="red">A执红</Tag> : <Tag color="black">A执黑</Tag>
}

/** 种子刷新标记：对内第二局是否使用派生新种子（false = 同种子仅换手） */
function refreshTag(refreshed: boolean) {
  return refreshed ? <Tag color="orange">刷新</Tag> : <Tag color="green">同种子</Tag>
}

const gameColumns: TableProps<EpisodeGame>['columns'] = [
  { title: '局号', dataIndex: 'gameIndex', width: 70 },
  {
    title: '对',
    width: 90,
    render: (_, g) => (
      <Typography.Text type="secondary">
        #{g.pairIndex}-{g.pairPosition === 0 ? '一' : '二'}
      </Typography.Text>
    ),
  },
  { title: '换手', width: 90, render: (_, g) => aIsRedTag(g.aIsRed) },
  {
    title: '种子',
    ellipsis: true,
    render: (_, g) => (
      <Space size={4}>
        {g.gameSeed != null ? (
          <Typography.Text code style={{ fontSize: 12 }}>
            {g.gameSeed}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        )}
        {refreshTag(g.seedRefreshed)}
      </Space>
    ),
  },
  {
    title: '结果',
    width: 90,
    render: (_, g) => (g.winner != null ? winnerText(g.winner) : '-'),
  },
  { title: '步数', dataIndex: 'steps', width: 80 },
]

const columns: TableProps<Episode>['columns'] = [
  { title: 'ID', dataIndex: 'id', width: 90 },
  { title: 'Worker', dataIndex: 'workerId' },
  {
    title: '对阵',
    ellipsis: true,
    render: (_, record) => {
      const a = <Typography.Text code>{shortSha(record.networkSha)}</Typography.Text>
      const b = record.opponentSpec ? (
        <Tag color="volcano">{record.opponentSpec}</Tag>
      ) : record.opponentSha ? (
        <Typography.Text code>{shortSha(record.opponentSha)}</Typography.Text>
      ) : (
        <Typography.Text type="secondary">镜像对手</Typography.Text>
      )
      return (
        <Space size={4}>
          {a}
          <Typography.Text type="secondary">vs</Typography.Text>
          {b}
        </Space>
      )
    },
  },
  {
    title: '类别',
    dataIndex: 'dataKind',
    width: 90,
    render: (v: string) => <Tag color={kindTagColor(v)}>{v}</Tag>,
  },
  { title: '局数', dataIndex: 'gameCount', width: 90 },
  { title: '步数', dataIndex: 'totalSteps', width: 120 },
  {
    title: '种子',
    width: 200,
    ellipsis: true,
    render: (_, record) => {
      if (record.seedBase == null) {
        return <Typography.Text type="secondary">-</Typography.Text>
      }
      return (
        <Space size={4}>
          <Typography.Text code style={{ fontSize: 12 }}>
            {record.seedBase}
          </Typography.Text>
          {record.pairSeedRefresh != null &&
            (record.pairSeedRefresh ? (
              <Tag color="orange">对内刷新</Tag>
            ) : (
              <Tag color="green">同种子换手</Tag>
            ))}
        </Space>
      )
    },
  },
  {
    title: '结果',
    width: 210,
    render: (_, record) => {
      const hasDetail = record.redWins + record.blackWins + record.drawNoCapture + record.drawTruncation > 0
      return (
        <Space size={4} wrap>
          <Tag color={record.winner > 0 ? 'red' : record.winner < 0 ? 'black' : 'default'}>
            {winnerText(record.winner)}
          </Tag>
          {hasDetail && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              红{record.redWins} 黑{record.blackWins} 未吃子和{record.drawNoCapture} 截断{record.drawTruncation}
            </Typography.Text>
          )}
        </Space>
      )
    },
  },
  { title: '登记时间', dataIndex: 'createdAt', render: (v: number) => fmtTime(v) },
  {
    title: 'Match',
    width: 70,
    render: (_, record) =>
      record.matchId > 0 ? <Link to="/matches">#{record.matchId}</Link> : <Typography.Text type="secondary">-</Typography.Text>,
  },
  {
    title: 'R2 对象键',
    dataIndex: 'objectKey',
    ellipsis: true,
    render: (v: string) => <Typography.Text type="secondary">{v}</Typography.Text>,
  },
  {
    title: '操作',
    width: 80,
    render: (_, record) => <Link to={`/replay?episode=${record.id}`}>回放</Link>,
  },
]

/** 逐局展开：换手 / 种子一致与刷新 / 配对关联 */
function ExpandedGames({ episode }: { episode: Episode }) {
  const [games, setGames] = useState<EpisodeGame[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api
      .episodeGames(episode.id)
      .then((rows) => {
        if (!cancelled) setGames(rows)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [episode.id])
  if (error) return <Typography.Text type="danger">逐局加载失败: {error}</Typography.Text>
  return (
    <Table<EpisodeGame>
      rowKey="gameIndex"
      size="small"
      columns={gameColumns}
      dataSource={games ?? []}
      loading={games == null}
      pagination={false}
    />
  )
}

export default function Episodes() {
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<number[]>([0])
  const before = cursors[page - 1] ?? 0
  const { data, error } = usePoll(() => api.episodes(before, limit), 10000)

  const [seedInput, setSeedInput] = useState('')
  const [lookup, setLookup] = useState<GameLookupItem[] | null>(null)
  const [lookupErr, setLookupErr] = useState<string | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)

  const goNext = () => {
    const last = data?.items[data.items.length - 1]
    if (!last || !data?.hasMore) return
    setCursors([...cursors, last.id])
    setPage(page + 1)
  }

  const doLookup = (value: string) => {
    const seed = value.trim()
    if (!seed) return
    setLookupLoading(true)
    setLookupErr(null)
    api
      .lookupGame(seed)
      .then((r) => setLookup(r.items))
      .catch((e) => {
        setLookupErr(String(e))
        setLookup(null)
      })
      .finally(() => setLookupLoading(false))
  }

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/episodes 失败" description={error} />
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <Card size="small" title="对局种子反查">
        <Space size={8} wrap>
          <Input.Search
            style={{ width: 420 }}
            placeholder="输入对局种子（game seed），反查所在 episode"
            enterButton="反查"
            allowClear
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            onSearch={doLookup}
            loading={lookupLoading}
          />
          {lookup && (
            <Typography.Text type="secondary">
              命中 {lookup.length} 条
            </Typography.Text>
          )}
        </Space>
        {lookupErr && <Alert type="error" showIcon message="反查失败" description={lookupErr} style={{ marginTop: 8 }} />}
        {lookup != null && (
          <Table<GameLookupItem>
            style={{ marginTop: 8 }}
            rowKey={(it) => `${it.episode.id}-${it.game.gameIndex}`}
            size="small"
            pagination={false}
            dataSource={lookup}
            columns={[
              {
                title: 'Episode',
                width: 100,
                render: (_, it) => <Link to={`/replay?episode=${it.episode.id}`}>#{it.episode.id}</Link>,
              },
              { title: '局号', width: 70, render: (_, it) => it.game.gameIndex },
              {
                title: '对',
                width: 90,
                render: (_, it) => (
                  <Typography.Text type="secondary">
                    #{it.game.pairIndex}-{it.game.pairPosition === 0 ? '一' : '二'}
                  </Typography.Text>
                ),
              },
              { title: '换手', width: 90, render: (_, it) => aIsRedTag(it.game.aIsRed) },
              { title: '种子刷新', width: 100, render: (_, it) => refreshTag(it.game.seedRefreshed) },
              {
                title: '登记时间',
                render: (_, it) => fmtTime(it.episode.createdAt),
              },
              {
                title: 'Worker',
                dataIndex: ['episode', 'workerId'],
                width: 140,
              },
            ]}
          />
        )}
      </Card>
      <Card
        size="small"
        title={`对局记录（按 ID 倒序，第 ${page} 页，本页 ${data?.items.length ?? 0} 条；展开行可核对逐局换手与种子）`}
        extra={
          <Space>
            <Button size="small" disabled={page === 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <Button size="small" disabled={!data?.hasMore} onClick={goNext}>
              下一页
            </Button>
          </Space>
        }
      >
        <Table<Episode>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={data?.items ?? []}
          pagination={false}
          expandable={{
            expandedRowRender: (record) => <ExpandedGames episode={record} />,
            rowExpandable: () => true,
          }}
        />
      </Card>
    </Space>
  )
}
