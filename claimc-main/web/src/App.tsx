import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing';
import Console from './pages/Console';
import SystemPage from './pages/System';
import PipelinePage from './pages/Pipeline';
import IntegrityPage from './pages/Integrity';
import MemoryPage from './pages/Memory';
import ExplorerPage from './pages/Explorer';

/**
 * ClaimChain SPA shell — Halo fintech design language.
 *  /          → Landing (marketing, video hero, marquees)
 *  /console   → working claims dashboard (real API, guarded lanes)
 *  /system    → architecture deep dive
 *  /pipeline  → 7-stage verification pipeline explained
 *  /integrity → hash chain, guard rules, live tamper demo
 *  /memory    → trained fraud memory (live stats)
 *  /explorer  → live chain event feed + search
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/console" element={<Console />} />
        <Route path="/system" element={<SystemPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/integrity" element={<IntegrityPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/explorer" element={<ExplorerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
