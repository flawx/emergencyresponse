import { Globe, Globe2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PanelLayout } from '../components/PanelLayout'
import { SettingsNavButton } from '../components/SettingsNavButton'
import { REGIONS } from '../utils/sirenConfig'

const regionIconClass = 'h-4 w-4 shrink-0 opacity-80'

export function HomePage() {
  const navigate = useNavigate()
  return (
    <PanelLayout
      title="Select region"
      subtitle="Emergency siren control console"
      showBack={false}
      headerActions={<SettingsNavButton />}
    >
      <div className="space-y-3">
        {REGIONS.map((region) => (
          <button
            key={region.id}
            type="button"
            onClick={() => navigate(`/${region.id}`)}
            className="flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-slate-700 bg-panel-800 px-4 py-3 text-left text-base font-semibold tracking-normal text-slate-200 transition hover:border-slate-500"
          >
            <span className="flex min-w-0 items-center gap-2">
              {region.id === 'america' ? (
                <Globe className={regionIconClass} strokeWidth={2} aria-hidden />
              ) : (
                <Globe2 className={regionIconClass} strokeWidth={2} aria-hidden />
              )}
              <span className="truncate">{region.label}</span>
            </span>
            <span aria-hidden>{region.flag}</span>
          </button>
        ))}
      </div>
    </PanelLayout>
  )
}
