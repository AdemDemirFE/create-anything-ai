import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AlgorithmPage } from './pages/Algorithm'
import { HomePage, LoginPage, RegisterPage } from './pages/Auth'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/algorithm" element={<AlgorithmPage />} />
        <Route path="*" element={<p>Page not found.</p>} />
      </Routes>
    </BrowserRouter>
  )
}
