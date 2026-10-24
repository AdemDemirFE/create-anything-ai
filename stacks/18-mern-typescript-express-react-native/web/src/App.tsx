import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AlgorithmPage } from './pages/Algorithm'
import { DocumentsPage } from './pages/Documents'
import { HomePage, LoginPage, RegisterPage } from './pages/Auth'

/**
 * Client-side routing guard mirrors the server: protected screens render
 * only with a session; the backend re-checks on every request anyway
 * (PRD §6 Home: "Require authentication at the backend as well as in
 * client routing").
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/algorithm" element={<AlgorithmPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="*" element={<p>Page not found.</p>} />
      </Routes>
    </BrowserRouter>
  )
}
