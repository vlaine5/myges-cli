import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { ProviderPage } from './pages/ProviderPage';
import { GooglePage } from './pages/GooglePage';
import { AgendaPage } from './pages/AgendaPage';
import { AgendasPage } from './pages/AgendasPage';
import { ImportsPage } from './pages/ImportsPage';
import { SyncPage } from './pages/SyncPage';
import { SyncJobDetailPage } from './pages/SyncJobDetailPage';
import { MatchesPage } from './pages/MatchesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TeachingStatsPage } from './pages/TeachingStatsPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/agendas" element={<AgendasPage />} />
        <Route path="/imports" element={<ImportsPage />} />
        <Route path="/provider" element={<ProviderPage />} />
        <Route path="/providers" element={<ProviderPage />} />
        <Route path="/google" element={<GooglePage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/events" element={<AgendaPage />} />
        <Route path="/matches" element={<MatchesPage />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/sync/:jobId" element={<SyncJobDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/teaching" element={<TeachingStatsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
