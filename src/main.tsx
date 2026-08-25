import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { App } from './App'
import './styles.css'
import './design-system.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('App root element is missing')
}

// Android WebView 的 backdrop-filter 在滚动时存在闪烁/残影的已知渲染缺陷,
// 标记平台后由 CSS 关闭毛玻璃,桌面浏览器不受影响。
document.documentElement.dataset.platform = Capacitor.getPlatform()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
