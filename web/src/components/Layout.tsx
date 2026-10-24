import { NavLink, Outlet } from 'react-router-dom';

const navigation = [
  { to: '/', label: 'Accueil' },
  { to: '/agenda', label: 'Evenements' },
  { to: '/matches', label: 'Rapprochements' },
  { to: '/provider', label: 'Provider' },
  { to: '/google', label: 'Google' },
  { to: '/sync', label: 'Sync' },
  { to: '/teaching', label: 'Heures ens.' },
  { to: '/effectifs', label: 'Effectifs' },
  { to: '/settings', label: 'Parametres' },
];

export function Layout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Production perso</p>
          <h1>Academic Sync</h1>
          <p className="muted">
            Admin local multi-provider pour agenda academique, Google Calendar, ICS et scheduler.
          </p>
        </div>

        <nav className="nav">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
