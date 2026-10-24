import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { App } from './App'
import { AuthPage } from './pages/Auth'
import { ListPage } from './pages/List'
import { DetailPage } from './pages/Detail'
import { AppFormPage } from './pages/AppForm'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/login" replace />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/apps" element={<ListPage />} />
          <Route path="/apps/new" element={<AppFormPage />} />
          <Route path="/apps/:id" element={<DetailPage />} />
          <Route path="/apps/:id/edit" element={<AppFormPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
