import { NavLink } from 'react-router-dom'
import { mobileNavList } from '../lib/navList'

export default function MobileNav() {
  return (
    <nav
      aria-label="Mobile"
      className="fixed inset-x-0 bottom-0 z-20 flex h-(--mobile-nav-height) items-stretch justify-around bg-sidebar-bg text-sidebar-text lg:hidden"
    >
      {mobileNavList.map(({ label, Icon, to }) => (
        <NavLink
          key={to}
          to={to}
          end
          aria-label={label}
          className={({ isActive }) =>
            `flex flex-1 items-center justify-center ${isActive ? 'bg-sidebar-active text-white' : 'hover:text-white'}`
          }
        >
          <Icon size={24} aria-hidden="true" />
        </NavLink>
      ))}
    </nav>
  )
}
