import { CircleHelp, GitBranch, History, LayoutDashboard, PlusSquare, Settings, type LucideIcon } from 'lucide-react'

export type NavItem = { label: string; Icon: LucideIcon; to: string }

export const navList: NavItem[] = [
  { label: 'Dashboard', Icon: LayoutDashboard, to: '/' },
  { label: 'New Review', Icon: PlusSquare, to: '/review/new' },
  { label: 'Review History', Icon: History, to: '/history' },
  { label: 'GitHub Integration', Icon: GitBranch, to: '/github' }
]

export const settingsNav: NavItem = { label: 'Settings', Icon: Settings, to: '/settings' }

export const helpNav: NavItem = { label: 'Help', Icon: CircleHelp, to: '/help' }

export const mobileNavList: NavItem[] = [...navList, settingsNav, helpNav]
