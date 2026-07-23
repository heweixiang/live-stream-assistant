import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'
import './styles/splitpanes.css'

// 避免白/黑屏时完全看不到错误
window.addEventListener('error', (e) => {
  console.error('[live-assistant]', e.error || e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[live-assistant:promise]', e.reason)
})

createApp(App).mount('#app')
