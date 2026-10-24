import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { ProviderPage } from './pages/ProviderPage';
import { GooglePage } from './pages/GooglePage';
import { AgendaPage } from './pages/AgendaPage';
import { AgendasPage } from './pages/AgendasPage';
import { CalendarPage } from './pages/CalendarPage';
import { ImportsPage } from './pages/ImportsPage';
import { SyncPage } from './pages/SyncPage';
import { SettingsPage } from './pages/SettingsPage';
import { TeachingStatsPage } from './pages/TeachingStatsPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/agendas" element={<AgendasPage />} />
        <Route path="/imports" element={<ImportsPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/provider" element={<ProviderPage />} />
        <Route path="/providers" element={<ProviderPage />} />
        <Route path="/google" element={<GooglePage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/events" element={<AgendaPage />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/teaching" element={<TeachingStatsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
