import Alert from 'antd/es/alert'
import Card from 'antd/es/card'
import { Col, Row } from 'antd/es/grid'
import Descriptions from 'antd/es/descriptions'
import Space from 'antd/es/space'
import Statistic from 'antd/es/statistic'
import Tag from 'antd/es/tag'
import Typography from 'antd/es/typography'
import { api } from '../api'
import { fmtAgo } from '../format'
import { usePoll } from '../usePoll'

export default function Generation() {
  const { data, error } = usePoll(api.dataStats, 3000)

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/data-stats 失败" description={error} />
  }

  const g = data?.generation
  // 本代已持续时长（秒）→ 实时产数据速率（步/分钟）
  const elapsedMin = g && g.since > 0 ? Math.max(0.1, (Date.now() / 1000 - g.since) / 60) : 0
  const stepsPerMin = g && g.since > 0 ? g.steps / elapsedMin : 0

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card size="small" title="本代数据（最近边界网络之后新增）" extra={<Tag color="processing">3s 刷新</Tag>}>
        <Row gutter={16}>
          <Col span={6}>
            <Card size="small">
              <Statistic title="本代步数" value={g?.steps ?? 0} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="本代局数" value={g?.games ?? 0} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="本代对局记录" value={g?.episodes ?? 0} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="实时速率"
                value={stepsPerMin > 0 ? Math.round(stepsPerMin) : 0}
                suffix="步/分钟"
              />
            </Card>
          </Col>
        </Row>
        <Typography.Text type="secondary">
          统计自最近一次网络导出（边界）以来的新增数据。编排重构期间该口径沿用，重排后可按需调整。
        </Typography.Text>
      </Card>

      <Card size="small" title="代际信息">
        <Descriptions column={2} size="small">
          <Descriptions.Item label="本代起点">
            {g && g.since > 0 ? fmtAgo(g.since) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="边界网络（最近导出的候选）">
            <Typography.Text code>{g?.candidate ? g.candidate.slice(0, 16) : '-'}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  )
}
