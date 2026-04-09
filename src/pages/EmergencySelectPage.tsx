import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { PanelLayout } from '../components/PanelLayout'
import { EMERGENCIES, REGIONS, type Region } from '../utils/sirenConfig'

export function EmergencySelectPage() {
  const { region } = useParams()
  const navigate = useNavigate()
  const regionData = REGIONS.find((item) => item.id === region)

  if (!regionData) return <Navigate to="/" replace />

  return (
    <PanelLayout title="Select emergency" subtitle={`${regionData.label} ${regionData.flag}`}>
      <div className="space-y-3">
        {EMERGENCIES.map((emergency) => (
          <button
            key={emergency.id}
            type="button"
            onClick={() => navigate(`/${region as Region}/${emergency.id}`)}
            className="min-h-16 w-full rounded-xl border border-slate-700 bg-panel-800 px-4 py-3 text-left text-lg font-semibold tracking-wide text-slate-100 transition hover:border-slate-500"
          >
            {emergency.label}
          </button>
        ))}
      </div>
    </PanelLayout>
  )
}
