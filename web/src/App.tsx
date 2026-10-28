import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { ProviderPage } from './pages/ProviderPage';
import { GooglePage } from './pages/GooglePage';
import { AgendaPage } from './pages/AgendaPage';
import { SyncPage } from './pages/SyncPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { SyncJobDetailPage } from './pages/SyncJobDetailPage';
import { MatchesPage } from './pages/MatchesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TeachingStatsPage } from './pages/TeachingStatsPage';
import { GradesPage } from './pages/GradesPage';
import { CoursesPage } from './pages/CoursesPage';
import { ClassOverridesPage } from './pages/ClassOverridesPage';

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/provider" element={<ProviderPage />} />
        <Route path="/providers" element={<ProviderPage />} />
        <Route path="/google" element={<GooglePage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/events" element={<AgendaPage />} />
        <Route path="/matches" element={<MatchesPage />} />
        <Route path="/planification" element={<SchedulesPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/sync/:jobId" element={<SyncJobDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/teaching" element={<TeachingStatsPage />} />
        <Route path="/courses" element={<CoursesPage />} />
        <Route path="/mes-cours" element={<CoursesPage />} />
        <Route path="/grades" element={<GradesPage />} />
        <Route path="/notes" element={<GradesPage />} />
        <Route path="/effectifs" element={<ClassOverridesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
