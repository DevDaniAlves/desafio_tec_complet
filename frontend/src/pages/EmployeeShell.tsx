import { LogOut, MessageSquareText, UserRound } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { Avatar, Mark } from '../components/Mark';

export function EmployeeShell() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  if (!user) return null;
  const here = pathname === '/perfil' ? 'Meu perfil' : 'Atendimento';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Mark size={20} color="#037AF6" />
          <span>Nexo Assist</span>
        </div>
        <nav>
          <NavLink to="/" end className="nav-item">
            <MessageSquareText size={16} /> Atendimento
          </NavLink>
          <NavLink to="/perfil" className="nav-item">
            <UserRound size={16} /> Meu perfil
          </NavLink>
        </nav>
        <div className="grow" />
        <div className="me">
          <Avatar name={user.name} />
          <div className="me-text">
            <b>{user.name}</b>
            <span>{user.email}</span>
          </div>
        </div>
        <button className="nav-item nav-button" onClick={() => signOut()}>
          <LogOut size={16} /> Sair
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            <span className="muted">Service desk de TI</span>
            <span className="muted">›</span>
            <span>{here}</span>
          </div>
          <span className="pill pill-success pill-dot">Assistente online</span>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
