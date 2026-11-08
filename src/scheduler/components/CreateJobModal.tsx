import App from 'antd/es/app'
import { Col, Row } from 'antd/es/grid'
import Form from 'antd/es/form'
import Input from 'antd/es/input'
import InputNumber from 'antd/es/input-number'
import Modal from 'antd/es/modal'
import Segmented from 'antd/es/segmented'
import Select from 'antd/es/select'
import Switch from 'antd/es/switch'
import Typography from 'antd/es/typography'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { shortSha } from '../format'
import type { CollectSpecBody, Network, PlayerSpec, RatingSpecBody } from '../types'

/** 与调度器 bq_env Variant 词表一致 */
const VARIANT_OPTIONS = [
  { value: '4x8', label: '暗棋 (4x8)' },
  { value: '4x4', label: '暗棋 (4x4)' },
  { value: '4x2', label: '迷你暗棋 (4x2)' },
  { value: '4x8-fast', label: '快速验证 (4x8-fast)' },
  { value: '4x8-rook-fast', label: '车炮快验 (4x8-rook-fast)' },
]

const SCENARIO_OPTIONS = [
  { value: 'standard', label: '标准（standard）' },
  { value: 'all_revealed', label: '全明子（all_revealed）' },
]

const DATA_KIND_OPTIONS = [
  { value: 'nnue', label: 'nnue' },
  { value: 'resnet', label: 'resnet' },
]

/** 与调度器 bq_policy player_kind 词表一致；模型类必须携带已登记 networkSha */
const MODEL_PLAYER_KINDS = ['expectimax_nnue', 'mcts_resnet', 'policy_resnet']
const PLAYER_KIND_OPTIONS = [
  { value: 'random', label: 'random（随机）' },
  { value: 'rule:capture_first', label: 'rule:capture_first（吃子优先）' },
  { value: 'rule:reveal_first', label: 'rule:reveal_first（翻子优先）' },
  { value: 'expectimax_rule', label: 'expectimax_rule（规则期望搜索）' },
  { value: 'expectimax_nnue', label: 'expectimax_nnue（NNUE 搜索）' },
  { value: 'mcts_resnet', label: 'mcts_resnet（ResNet MCTS）' },
  { value: 'policy_resnet', label: 'policy_resnet（ResNet 策略）' },
]

const SEED_KIND_OPTIONS = [
  { value: 'random', label: 'random（随机）' },
  { value: 'fixed', label: 'fixed（固定）' },
  { value: 'incremental', label: 'incremental（递增）' },
  { value: 'range', label: 'range（区间）' },
]

type JobKind = 'collect' | 'rating'

const COLLECT_FIELDS = [
  'variant',
  'scenario',
  'dataKind',
  'totalGames',
  'seedKind',
  'playerA',
  'playerB',
] as const
const RATING_FIELDS = [
  'candidateSha',
  'opponentSha',
  'sprtElo0',
  'sprtElo1',
  'sprtAlpha',
  'sprtBeta',
  'ratingScenario',
  'ratingTotalGames',
] as const
const COMMON_FIELDS = ['requester', 'priority'] as const

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

export default function CreateJobModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [tab, setTab] = useState<JobKind>('collect')
  const [submitting, setSubmitting] = useState(false)
  const [networks, setNetworks] = useState<Network[]>([])

  // 弹窗打开时拉取已登记网络（模型类棋手选择用），并重置为默认值
  useEffect(() => {
    if (!open) return
    form.resetFields()
    setTab('collect')
    api
      .networks()
      .then(setNetworks)
      .catch(() => setNetworks([]))
  }, [open, form])

  const seedKind = Form.useWatch('seedKind', form)
  const playerA = Form.useWatch('playerA', form)
  const playerB = Form.useWatch('playerB', form)

  const networkOptions = networks.map((n) => ({
    value: n.sha,
    label: `${shortSha(n.sha, 10)}${n.notes ? ` · ${n.notes}` : ''}`,
  }))

  const playerCard = (
    side: 'playerA' | 'playerB',
    label: string,
    kindValue?: string,
  ) => (
    <Col span={12}>
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: '8px 12px 0' }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {label}
        </Typography.Text>
        <Form.Item
          name={[side, 'kind']}
          label="棋手"
          style={{ marginBottom: 8 }}
          rules={[{ required: true, message: '选择棋手类型' }]}
        >
          <Select options={PLAYER_KIND_OPTIONS} showSearch optionFilterProp="label" />
        </Form.Item>
        {MODEL_PLAYER_KINDS.includes(kindValue ?? '') && (
          <Form.Item
            name={[side, 'networkSha']}
            label="网络"
            style={{ marginBottom: 12 }}
            rules={[{ required: true, message: '模型类棋手必须选择已登记网络' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={networkOptions}
              placeholder="选择已登记网络"
              notFoundContent="无已登记网络"
            />
          </Form.Item>
        )}
      </div>
    </Col>
  )

  const submit = async () => {
    try {
      const common = await form.validateFields([...COMMON_FIELDS])
      let body: Parameters<typeof api.submitJob>[0]
      if (tab === 'collect') {
        const v = await form.validateFields([...COLLECT_FIELDS])
        if (v.totalGames < 2 || v.totalGames % 2 !== 0) {
          message.error('collect 目标局数必须 ≥2 且为偶数')
          return
        }
        const sides: Record<string, PlayerSpec> = {}
        for (const side of ['playerA', 'playerB'] as const) {
          const p = v[side] as PlayerSpec
          if (MODEL_PLAYER_KINDS.includes(p.kind) && !p.networkSha) {
            message.error(`${side === 'playerA' ? '选手 A' : '选手 B'} 为模型类棋手，必须选择已登记网络`)
            return
          }
          sides[side] = { kind: p.kind, networkSha: p.networkSha ?? '' }
        }
        const collect: CollectSpecBody = {
          variant: v.variant,
          scenario: v.scenario,
          seedStrategy: {
            kind: v.seedKind,
            fixedSeed: num((v as Record<string, unknown>).fixedSeed),
            baseSeed: num((v as Record<string, unknown>).baseSeed),
            minSeed: num((v as Record<string, unknown>).minSeed),
            maxSeed: num((v as Record<string, unknown>).maxSeed),
          },
          playerA: sides.playerA,
          playerB: sides.playerB,
          dataKind: v.dataKind,
          totalGames: v.totalGames,
          pairsParallel: !!form.getFieldValue('pairsParallel'),
          pairSeedRefresh: !!form.getFieldValue('pairSeedRefresh'),
        }
        body = { kind: 'collect', collect }
      } else {
        const v = await form.validateFields([...RATING_FIELDS])
        if (v.sprtAlpha !== 0 && !(0 < v.sprtAlpha && v.sprtAlpha < 1)) {
          message.error('SPRT alpha 必须在 (0,1)')
          return
        }
        if (v.sprtBeta !== 0 && !(0 < v.sprtBeta && v.sprtBeta < 1)) {
          message.error('SPRT beta 必须在 (0,1)')
          return
        }
        if (v.sprtElo0 !== 0 && v.sprtElo1 !== 0 && v.sprtElo1 <= v.sprtElo0) {
          message.error('SPRT elo1 必须大于 elo0')
          return
        }
        const rating: RatingSpecBody = {
          variant: '',
          candidateSha: v.candidateSha,
          opponentSha: v.opponentSha,
          totalGames: v.ratingTotalGames ?? 0,
          sprtElo0: v.sprtElo0 ?? 0,
          sprtElo1: v.sprtElo1 ?? 0,
          sprtAlpha: v.sprtAlpha ?? 0,
          sprtBeta: v.sprtBeta ?? 0,
          scenario: v.ratingScenario,
        }
        body = { kind: 'rating', rating }
      }
      body.priority = num(common.priority, 50)
      body.requester = common.requester || 'webui'

      setSubmitting(true)
      const res = await api.submitJob(body)
      message.success(res.message || `任务已提交：${res.jobId.slice(0, 12)}`)
      onCreated()
      onClose()
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return // 表单校验错误
      message.error(`提交失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="新建任务"
      open={open}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={submitting}
      okText="提交"
      cancelText="取消"
      width={720}
      destroyOnHidden
    >
      <Segmented
        value={tab}
        onChange={(v) => setTab(v as JobKind)}
        options={[
          { value: 'collect', label: '采集任务（collect）' },
          { value: 'rating', label: '评级对战（rating）' },
        ]}
        style={{ marginBottom: 16 }}
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          requester: 'webui',
          priority: 50,
          variant: '4x8',
          scenario: 'standard',
          dataKind: 'nnue',
          totalGames: 1000,
          seedKind: 'random',
          playerA: { kind: 'expectimax_nnue' },
          playerB: { kind: 'rule:capture_first' },
          ratingScenario: 'standard',
          ratingTotalGames: 0,
          sprtElo0: 0,
          sprtElo1: 40,
          sprtAlpha: 0.05,
          sprtBeta: 0.05,
        }}
      >
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="requester" label="提交人">
              <Input placeholder="webui" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="priority" label="优先级（大者优先派发）">
              <InputNumber min={0} max={10000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        {tab === 'collect' ? (
          <>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="variant" label="变体" rules={[{ required: true }]}>
                  <Select options={VARIANT_OPTIONS} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="scenario" label="开局场景" rules={[{ required: true }]}>
                  <Select options={SCENARIO_OPTIONS} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="dataKind" label="数据类别" rules={[{ required: true }]}>
                  <Select options={DATA_KIND_OPTIONS} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="totalGames"
              label="目标局数（≥2 且为偶数）"
              rules={[{ required: true, message: '填写目标局数' }]}
            >
              <InputNumber min={2} step={2} style={{ width: '100%' }} />
            </Form.Item>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="pairsParallel" label="成对并行派发" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="pairSeedRefresh" label="成对种子刷新" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="seedKind" label="种子策略" rules={[{ required: true }]}>
              <Select options={SEED_KIND_OPTIONS} />
            </Form.Item>
            {seedKind === 'fixed' && (
              <Form.Item name="fixedSeed" label="固定种子（fixedSeed）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            )}
            {(seedKind === 'random' || seedKind === 'incremental') && (
              <Form.Item name="baseSeed" label={seedKind === 'random' ? '混淆种子（baseSeed）' : '起始种子（baseSeed）'}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            )}
            {seedKind === 'range' && (
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="minSeed" label="最小种子">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="maxSeed" label="最大种子">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            )}
            <Row gutter={12}>
              {playerCard('playerA', '选手 A（红先占位随机）', playerA?.kind)}
              {playerCard('playerB', '选手 B', playerB?.kind)}
            </Row>
          </>
        ) : (
          <>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="candidateSha"
                  label="候选网络（被测）"
                  rules={[{ required: true, message: '选择候选网络' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={networkOptions}
                    placeholder="选择已登记网络"
                    notFoundContent="无已登记网络"
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="opponentSha"
                  label="对手网络"
                  rules={[{ required: true, message: '选择对手网络' }]}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    options={networkOptions}
                    placeholder="选择已登记网络"
                    notFoundContent="无已登记网络"
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="ratingTotalGames" label="目标局数（0 = 仅 SPRT 判停）">
                  <InputNumber min={0} step={2} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="sprtElo0" label="SPRT elo0">
                  <InputNumber step={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="sprtElo1" label="SPRT elo1">
                  <InputNumber step={1} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="sprtAlpha" label="SPRT α">
                  <InputNumber step={0.01} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="sprtBeta" label="SPRT β">
                  <InputNumber step={0.01} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="ratingScenario" label="开局场景">
                  <Select options={SCENARIO_OPTIONS} />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}
      </Form>
    </Modal>
  )
}
