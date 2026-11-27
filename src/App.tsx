import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import HomePage from '@/pages/HomePage';
import LibraryPage from '@/pages/LibraryPage';
import PlaylistsPage from '@/pages/PlaylistsPage';
import SearchPage from '@/pages/SearchPage';
import SettingsPage from '@/pages/SettingsPage';
import MarketplacePage from '@/pages/MarketplacePage';
import DevelopersPage from '@/pages/DevelopersPage';
import TrackPage from '@/pages/TrackPage';

export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/developers" element={<DevelopersPage />} />
          <Route path="/track/:id" element={<TrackPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
