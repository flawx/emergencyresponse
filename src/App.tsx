import { Navigate, Route, Routes } from 'react-router-dom'
import { EmergencySelectPage } from './pages/EmergencySelectPage'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { SirenControlPage } from './pages/SirenControlPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/:region" element={<EmergencySelectPage />} />
      <Route path="/:region/:emergency" element={<SirenControlPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
