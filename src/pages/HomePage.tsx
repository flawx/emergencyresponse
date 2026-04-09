import { useNavigate } from 'react-router-dom'
import { PanelLayout } from '../components/PanelLayout'
import { REGIONS } from '../utils/sirenConfig'

export function HomePage() {
  const navigate = useNavigate()
  return (
    <PanelLayout title="Select region" subtitle="Emergency siren control console" showBack={false}>
      <div className="space-y-3">
        {REGIONS.map((region) => (
          <button
            key={region.id}
            type="button"
            onClick={() => navigate(`/${region.id}`)}
            className="flex min-h-16 w-full items-center justify-between rounded-xl border border-slate-700 bg-panel-800 px-4 py-3 text-left text-lg font-semibold tracking-wide text-slate-100 transition hover:border-slate-500"
          >
            <span>{region.label}</span>
            <span>{region.flag}</span>
          </button>
        ))}
      </div>
    </PanelLayout>
  )
}
