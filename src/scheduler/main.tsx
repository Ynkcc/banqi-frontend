// antd 用 es 子路径导入：本组合 Vite7/Rollup 下 barrel 命名导入存在摇树泄漏
// （未使用组件如 DatePicker/Form 会被整包拖入），子路径导入可稳定摇树。
import AntApp from 'antd/es/app'
import ConfigProvider from 'antd/es/config-provider'
import zhCN from 'antd/es/locale/zh_CN'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// 多页面构建下本应用挂在 /scheduler.html，改用 HashRouter：
// 路由形如 /scheduler.html#/networks，无需服务端回退配置。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <AntApp>
        <HashRouter>
          <App />
        </HashRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
)
