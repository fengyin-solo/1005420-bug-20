import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { reconcileCracks } from './api/crack-domain'
import './styles/global.css'

// 启动先归并存量裂缝：清掉同编号的残留重复记录、统一裂缝走向写法。
reconcileCracks()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
