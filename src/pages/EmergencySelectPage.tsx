import { Flame, Shield, Truck } from 'lucide-react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { PanelLayout } from '../components/PanelLayout'
import { EMERGENCIES, REGIONS, type EmergencyType, type Region } from '../utils/sirenConfig'

const emergencyIconClass = 'h-4 w-4 shrink-0 opacity-80'

function emergencyIcon(id: EmergencyType) {
  switch (id) {
    case 'fire':
      return <Flame className={emergencyIconClass} strokeWidth={2} aria-hidden />
    case 'police':
      return <Shield className={emergencyIconClass} strokeWidth={2} aria-hidden />
    case 'ambulance':
      return <Truck className={emergencyIconClass} strokeWidth={2} aria-hidden />
    default:
      return null
  }
}

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
            className="flex min-h-16 w-full items-center gap-2 rounded-xl border border-slate-700 bg-panel-800 px-4 py-3 text-left text-base font-semibold tracking-normal text-slate-200 transition hover:border-slate-500"
          >
            {emergencyIcon(emergency.id)}
            <span className="truncate">{emergency.label}</span>
          </button>
        ))}
      </div>
    </PanelLayout>
  )
}
