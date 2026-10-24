import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { App } from './App'
import { AlgorithmPage } from './pages/Algorithm'
import { AuthPage } from './pages/Auth'
import { HomePage } from './pages/Home'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/login" replace />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/algorithm" element={<AlgorithmPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
