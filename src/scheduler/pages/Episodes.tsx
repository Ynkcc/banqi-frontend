import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { fmtTime, kindTagColor, shortSha, winnerText } from '../format'
import type { Episode } from '../types'
import { usePoll } from '../usePoll'

const limit = 100

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
    title: '对手',
    width: 150,
    ellipsis: true,
    render: (_, record) =>
      record.opponentSpec ? (
        <Tag color="volcano">{record.opponentSpec}</Tag>
      ) : record.opponentSha ? (
        <Typography.Text code>{shortSha(record.opponentSha)}</Typography.Text>
      ) : (
        <Typography.Text type="secondary">-</Typography.Text>
      ),
  },
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

export default function Episodes() {
  const [page, setPage] = useState(1)
  const [cursors, setCursors] = useState<number[]>([0])
  const before = cursors[page - 1] ?? 0
  const { data, error } = usePoll(() => api.episodes(before, limit), 10000)

  const goNext = () => {
    const last = data?.items[data.items.length - 1]
    if (!last || !data?.hasMore) return
    setCursors([...cursors, last.id])
    setPage(page + 1)
  }

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/episodes 失败" description={error} />
  }

  return (
    <Card
      size="small"
      title={`对局记录（按 ID 倒序，第 ${page} 页，本页 ${data?.items.length ?? 0} 条）`}
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
      />
    </Card>
  )
}
