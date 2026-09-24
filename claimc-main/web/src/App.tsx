import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Landing from './pages/Landing';
import Console from './pages/Console';
import SystemPage from './pages/System';
import PipelinePage from './pages/Pipeline';
import IntegrityPage from './pages/Integrity';
import MemoryPage from './pages/Memory';
import ExplorerPage from './pages/Explorer';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './lib/auth';
import type { ReactNode } from 'react';

/**
 * ClaimChain SPA shell — Halo fintech design language.
 *  /          → Landing (marketing, video hero, marquees)
 *  /login     → insurer sign-in (one-click demo inspectors)
 *  /console   → working claims dashboard (auth-gated actions)
 *  /system    → architecture deep dive
 *  /pipeline  → 7-stage verification pipeline explained
 *  /integrity → hash chain, guard rules, live tamper demo
 *  /memory    → trained fraud memory (live stats)
 *  /explorer  → live chain event feed + search
 *
 * Auth model: /console requires a signed-in inspector (protected route);
 * the marketing + explainer pages stay public.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/console"
            element={
              <RequireAuth>
                <Console />
              </RequireAuth>
            }
          />
          <Route path="/system" element={<SystemPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/integrity" element={<IntegrityPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
