import { useState } from 'react'
import Alert from 'antd/es/alert'
import App from 'antd/es/app'
import Button from 'antd/es/button'
import Card from 'antd/es/card'
import Descriptions from 'antd/es/descriptions'
import Form from 'antd/es/form'
import Input from 'antd/es/input'
import Modal from 'antd/es/modal'
import Space from 'antd/es/space'
import Switch from 'antd/es/switch'
import Tag from 'antd/es/tag'
import Typography from 'antd/es/typography'
import { api } from '../api'
import type { StorageProfile } from '../types'
import { usePoll } from '../usePoll'

/** 编辑表单状态（secret 留空 = 保持原值，服务端掩码语义）；name 仅新建时使用 */
interface ProfileForm {
  name?: string
  endpoint: string
  region: string
  accessKey: string
  secretKey?: string
  bucket: string
  pathStyle: boolean
}

export default function Storage() {
  const { message, modal } = App.useApp()
  const { data, error, reload } = usePoll(api.storage, 10000)
  const [editing, setEditing] = useState<StorageProfile | null>(null)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm<ProfileForm>()
  const [saving, setSaving] = useState(false)

  const openCreate = () => {
    setEditing(null)
    setCreating(true)
    form.setFieldsValue({ endpoint: '', region: 'auto', accessKey: '', secretKey: '', bucket: '', pathStyle: false })
  }

  const openEdit = (p: StorageProfile) => {
    setEditing(p)
    setCreating(false)
    form.setFieldsValue({
      endpoint: p.endpoint,
      region: p.region,
      accessKey: p.accessKey,
      secretKey: '',
      bucket: p.bucket,
      pathStyle: p.pathStyle,
    })
  }

  const close = () => {
    setEditing(null)
    setCreating(false)
  }

  const save = async () => {
    const name = editing?.name ?? form.getFieldValue('name')
    try {
      const v = await form.validateFields()
      setSaving(true)
      // 编辑时 accessKey 字段展示的是掩码：未改动则不回传（服务端「非空即更新」
      // 会把掩码字符串当成新凭据），仅当用户输入了新值才提交。
      const accessKeyChanged = !editing || v.accessKey !== editing.accessKey
      await api.saveStorageProfile(name, {
        endpoint: v.endpoint,
        region: v.region,
        accessKey: accessKeyChanged ? v.accessKey : undefined,
        secretKey: v.secretKey || undefined,
        bucket: v.bucket,
        pathStyle: v.pathStyle,
      })
      message.success(`profile ${name} 已保存（生效需「启用」）`)
      close()
      void reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const activate = (p: StorageProfile) => {
    modal.confirm({
      title: `切换存储后端到 ${p.name}？`,
      width: 560,
      okText: '校验并切换',
      content: (
        <Typography.Paragraph style={{ marginBottom: 0 }}>
          切换前会先校验目标 bucket 连通性。注意：
          <br />· 新签发的上传/下载 URL 立即指向新后端（在飞 URL 约 1 小时内仍指向旧后端）；
          <br />· <b>历史对象不会自动迁移</b>——trainer 下载旧 episode、worker 拉取未缓存网络时，
          目标后端须已有同键对象（请先用 rclone sync 等工具同步）。
        </Typography.Paragraph>
      ),
      onOk: async () => {
        try {
          await api.activateStorage(p.name)
          message.success(`已切换到 ${p.name}`)
          void reload()
        } catch (e) {
          message.error(e instanceof Error ? e.message : String(e))
        }
      },
    })
  }

  const remove = (p: StorageProfile) => {
    modal.confirm({
      title: `删除 profile ${p.name}？`,
      okText: '删除',
      okButtonProps: { danger: true },
      content: '仅删除配置记录，不影响对象存储中的数据。',
      onOk: async () => {
        try {
          await api.deleteStorageProfile(p.name)
          message.success(`profile ${p.name} 已删除`)
          void reload()
        } catch (e) {
          message.error(e instanceof Error ? e.message : String(e))
        }
      },
    })
  }

  if (error) {
    return <Alert type="error" showIcon message="加载 /api/storage 失败" description={error} />
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="存储后端由调度器独占管理，worker 不持有凭据（只跟随预签名 URL），切换对 worker 透明"
      />
      <Card
        size="small"
        title={`存储后端（当前生效：${data?.active ?? '-'}）`}
        extra={
          <Button type="primary" size="small" onClick={openCreate}>
            新增 profile
          </Button>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {(data?.profiles ?? []).map((p) => (
            <Card
              key={p.name}
              size="small"
              type="inner"
              title={
                <Space size={8}>
                  {p.name}
                  {p.name === data?.active && <Tag color="green">生效中</Tag>}
                  {!p.hasSecret && <Tag color="orange">未配置凭据</Tag>}
                </Space>
              }
              extra={
                <Space size={8}>
                  <Button size="small" onClick={() => openEdit(p)}>
                    编辑
                  </Button>
                  {p.name !== data?.active && (
                    <>
                      <Button size="small" type="primary" onClick={() => activate(p)}>
                        启用
                      </Button>
                      <Button size="small" danger onClick={() => remove(p)}>
                        删除
                      </Button>
                    </>
                  )}
                </Space>
              }
            >
              <Descriptions size="small" column={2}>
                <Descriptions.Item label="Endpoint">
                  {p.endpoint || <Typography.Text type="secondary">（AWS 默认解析）</Typography.Text>}
                </Descriptions.Item>
                <Descriptions.Item label="Bucket">{p.bucket}</Descriptions.Item>
                <Descriptions.Item label="Region">{p.region || '-'}</Descriptions.Item>
                <Descriptions.Item label="Path Style">{p.pathStyle ? '是' : '否'}</Descriptions.Item>
                <Descriptions.Item label="AccessKey">
                  {p.accessKey || <Typography.Text type="secondary">未设置</Typography.Text>}
                </Descriptions.Item>
                <Descriptions.Item label="SecretKey">{p.hasSecret ? '已配置' : '未配置'}</Descriptions.Item>
              </Descriptions>
            </Card>
          ))}
        </Space>
      </Card>

      <Modal
        title={editing ? `编辑 profile：${editing.name}` : '新增存储 profile'}
        open={editing !== null || creating}
        onOk={save}
        onCancel={close}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          {!editing && (
            <Form.Item
              name="name"
              label="名称"
              rules={[
                { required: true, message: '请输入名称' },
                { pattern: /^[A-Za-z0-9_-]{1,32}$/, message: '仅字母数字与 - _（1~32 字符）' },
              ]}
            >
              <Input placeholder="如 minio / r2" />
            </Form.Item>
          )}
          <Form.Item name="endpoint" label="Endpoint" extra="Cloudflare R2 / MinIO / RustFS 填 S3 兼容端点；AWS 留空">
            <Input placeholder="https://<account>.r2.cloudflarestorage.com 或 http://192.168.0.104:9000" />
          </Form.Item>
          <Form.Item name="bucket" label="Bucket" rules={[{ required: true, message: '请输入 bucket' }]}>
            <Input placeholder="banqi" />
          </Form.Item>
          <Form.Item name="region" label="Region" extra="通常 auto">
            <Input placeholder="auto" />
          </Form.Item>
          <Form.Item name="accessKey" label="AccessKey ID">
            <Input placeholder={editing?.accessKey || ''} />
          </Form.Item>
          <Form.Item
            name="secretKey"
            label="SecretKey"
            extra={editing ? '留空 = 保持原值不变' : '新建必填'}
            rules={editing ? [] : [{ required: true, message: '新建 profile 必须提供 SecretKey' }]}
          >
            <Input.Password placeholder={editing?.hasSecret ? '留空保持不变' : ''} autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="pathStyle" label="Path Style 寻址" valuePropName="checked" extra="MinIO / RustFS 等本地实现须开启；R2 关闭">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
