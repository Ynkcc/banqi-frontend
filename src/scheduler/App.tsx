import Spin from 'antd/es/spin'
import Layout from 'antd/es/layout'
import Menu from 'antd/es/menu'
import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'

// 页面按路由懒加载：Table/Form 等重组件只随对应页面分包加载。
const Episodes = lazy(() => import('./pages/Episodes'))
const Generation = lazy(() => import('./pages/Generation'))
const Jobs = lazy(() => import('./pages/Jobs'))
const Matches = lazy(() => import('./pages/Matches'))
const Networks = lazy(() => import('./pages/Networks'))
const Overview = lazy(() => import('./pages/Overview'))
const Replay = lazy(() => import('./pages/Replay'))
const Storage = lazy(() => import('./pages/Storage'))
const TrainConfig = lazy(() => import('./pages/TrainConfig'))
const Workers = lazy(() => import('./pages/Workers'))

const menuItems = [
  { key: '/', label: <Link to="/">总览</Link> },
  { key: '/jobs', label: <Link to="/jobs">任务管理</Link> },
  { key: '/networks', label: <Link to="/networks">网络</Link> },
  { key: '/matches', label: <Link to="/matches">对战 / SPRT</Link> },
  { key: '/train-config', label: <Link to="/train-config">训练超参</Link> },
  { key: '/storage', label: <Link to="/storage">存储</Link> },
  { key: '/workers', label: <Link to="/workers">Worker</Link> },
  { key: '/episodes', label: <Link to="/episodes">对局记录</Link> },
  { key: '/generation', label: <Link to="/generation">本代数据</Link> },
  { key: '/replay', label: <Link to="/replay">对局回放</Link> },
]

export default function App() {
  const { pathname } = useLocation()
  const selected = menuItems.some((item) => item.key === pathname) ? pathname : '/'

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="dark" width={208}>
        <div className="brand">banqi scheduler</div>
        <Menu theme="dark" mode="inline" selectedKeys={[selected]} items={menuItems} />
      </Layout.Sider>
      <Layout>
        <Layout.Content style={{ padding: 24 }}>
          <Suspense fallback={<Spin size="large" style={{ display: 'block', margin: '80px auto' }} />}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/collect" element={<Navigate to="/jobs" replace />} />
              <Route path="/networks" element={<Networks />} />
              <Route path="/matches" element={<Matches />} />
              <Route path="/train-config" element={<TrainConfig />} />
              <Route path="/storage" element={<Storage />} />
              <Route path="/workers" element={<Workers />} />
              <Route path="/episodes" element={<Episodes />} />
              <Route path="/replay" element={<Replay />} />
              <Route path="/generation" element={<Generation />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
