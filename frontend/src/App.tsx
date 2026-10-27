import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Admin } from './pages/Admin';
import { Console } from './pages/Console';
import { EmployeeShell } from './pages/EmployeeShell';
import { Login } from './pages/Login';
import { Chat } from './pages/Chat';
import { Profile } from './pages/Profile';

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot" aria-busy="true" />;

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  if (user.role === 'admin') {
    return (
      <Routes>
        <Route path='/admin' element={<Admin />} />
        <Route path='*' element={<Navigate to='/admin' replace />} />
      </Routes>
    );
  }

  if (user.role === 'analyst') {
    return (
      <Routes>
        <Route path="/console" element={<Console />} />
        <Route path="*" element={<Navigate to="/console" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<EmployeeShell />}>
        <Route path="/" element={<Chat />} />
        <Route path="/perfil" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
