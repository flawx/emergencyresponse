import { Settings } from 'lucide-react'
import { Link } from 'react-router-dom'

export function SettingsNavButton() {
  return (
    <Link
      to="/settings"
      aria-label="Settings"
      className="rounded-xl border border-slate-700 bg-slate-900 p-2 text-slate-200 transition hover:border-slate-500"
    >
      <Settings size={18} aria-hidden />
    </Link>
  )
}
