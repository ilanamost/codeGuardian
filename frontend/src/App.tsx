import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import AppShell from './components/AppShell'
import RequireSession from './components/RequireSession'
import SignedOutOnly from './components/SignedOutOnly'
import DashboardPage from './pages/DashboardPage'
import GithubWizardPage from './pages/GithubWizardPage'
import HelpPage from './pages/HelpPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ReviewHistoryPage from './pages/ReviewHistoryPage'
import ReviewPage from './pages/ReviewPage'
import SettingsPage from './pages/SettingsPage'
import { ROUTE_PATH } from './lib/route.constants'
import { useApplySettings } from './lib/useApplySettings'
import { useAppDispatch } from './store/hooks'
import { restoreSession } from './store/session.slice'

// Plan 028: the session is restored once on load (GET /api/session) and every app route sits
// inside the guard; /login and /register are for signed-out visitors only.
export default function App() {
  const dispatch = useAppDispatch()
  useApplySettings()

  useEffect(() => {
    dispatch(restoreSession())
  }, [dispatch])

  return (
    <>
      <Routes>
        <Route path={ROUTE_PATH.login} element={<SignedOutOnly><LoginPage /></SignedOutOnly>} />
        <Route path={ROUTE_PATH.register} element={<SignedOutOnly><RegisterPage /></SignedOutOnly>} />
        <Route element={<RequireSession />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/review/new" element={<ReviewPage />} />
            <Route path="/review/:id" element={<ReviewPage />} />
            <Route path="/history" element={<ReviewHistoryPage />} />
            <Route path="/github" element={<GithubWizardPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="*" element={<Navigate to={ROUTE_PATH.home} replace />} />
          </Route>
        </Route>
      </Routes>
      <Toaster richColors closeButton position="top-center" />
    </>
  )
}
