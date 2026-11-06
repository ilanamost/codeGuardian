import { Link, NavLink } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { ACCOUNT_TEXT } from '../lib/account.constants'
import { helpNav, navList, settingsNav } from '../lib/navList'
import { ROUTE_PATH } from '../lib/route.constants'
import { useAccount } from '../lib/useAccount'
import ProfilePhoto from './ProfilePhoto'

// The signed-in user: the session's account (GET /api/account when it is not loaded yet, a
// background load: no toast if it fails). The photo changes together with the Account panel's.
// Plan 034: a link to Settings > Account (keyboard focus ring, hover and pointer cursor).
function SidebarProfile() {
  const { account } = useAccount({ silent: true })
  if (!account) return null
  return (
    <Link
      to={ROUTE_PATH.settingsSection('account')}
      data-testid="sidebar-profile"
      aria-label={ACCOUNT_TEXT.profileLink(account.fullName)}
      title={ACCOUNT_TEXT.profileLink(account.fullName)}
      className="mt-4 flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-sidebar-active hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <ProfilePhoto account={account} size="small" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{account.fullName}</p>
        <p className="truncate text-xs">{account.email}</p>
      </div>
    </Link>
  )
}

export default function Sidebar() {
  return (
    <aside className="hidden w-(--sidebar-width) shrink-0 flex-col bg-sidebar-bg p-4 text-sidebar-text lg:flex">
      <div className="mb-6 flex items-center gap-3 px-2 py-2">
        <ShieldCheck size={32} className="text-primary" aria-hidden="true" />
        <div>
          <p className="font-semibold text-white">CodeGuardian</p>
          <p className="text-xs">AI Code Reviewer</p>
        </div>
      </div>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {navList.map(({ label, Icon, to }) => (
          <NavLink
            key={label}
            to={to}
            end
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                isActive ? 'bg-sidebar-active text-white' : 'hover:text-white'
              }`
            }
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-1">
        <NavLink
          to={settingsNav.to}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
              isActive ? 'bg-sidebar-active text-white' : 'hover:text-white'
            }`
          }
        >
          <settingsNav.Icon size={18} aria-hidden="true" />
          {settingsNav.label}
        </NavLink>
        <NavLink
          to={helpNav.to}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
              isActive ? 'bg-sidebar-active text-white' : 'hover:text-white'
            }`
          }
        >
          <helpNav.Icon size={18} aria-hidden="true" />
          {helpNav.label}
        </NavLink>
        <SidebarProfile />
      </div>
    </aside>
  )
}
