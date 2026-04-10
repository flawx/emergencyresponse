import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function BackButton() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      aria-label="Go back"
      onClick={() => navigate(-1)}
      className="rounded-xl border border-slate-700 bg-panel-900 px-3 py-2 text-slate-100 transition hover:border-slate-500"
    >
      <ArrowLeft size={18} aria-hidden />
    </button>
  )
}
