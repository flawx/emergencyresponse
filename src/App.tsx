import { Navigate, Route, Routes } from 'react-router-dom'
import { EmergencySelectPage } from './pages/EmergencySelectPage'
import { HomePage } from './pages/HomePage'
import { SirenControlPage } from './pages/SirenControlPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/:region" element={<EmergencySelectPage />} />
      <Route path="/:region/:emergency" element={<SirenControlPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
