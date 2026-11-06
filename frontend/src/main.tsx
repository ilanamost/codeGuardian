import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import './styles/main.css'
import App from './App.tsx'
import { ROUTER_BASENAME } from './lib/basePath'
import { ignoreMonacoCancel } from './lib/ignoreMonacoCancel'
import { createAppStore } from './store'

ignoreMonacoCancel()

const store = createAppStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter basename={ROUTER_BASENAME}>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>,
)
