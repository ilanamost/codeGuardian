import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import './styles/main.css'
import App from './App.tsx'
import { ROUTER_BASENAME } from './lib/basePath'
import { completeGithubReturn } from './lib/github-return'
import { ignoreMonacoCancel } from './lib/ignoreMonacoCancel'
import { createServices } from './services'
import { createAppStore } from './store'

ignoreMonacoCancel()

async function start() {
  // Plan 048: the return from GitHub is finished (code read and removed from the URL, swapped for
  // a token) before the store and the router exist, so the first session restore already has it.
  const services = createServices()
  await completeGithubReturn(services.session)

  const store = createAppStore({ services })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Provider store={store}>
        <BrowserRouter basename={ROUTER_BASENAME}>
          <App />
        </BrowserRouter>
      </Provider>
    </StrictMode>,
  )
}

void start()
