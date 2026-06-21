import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Card, Field, ErrorBanner } from './ui.jsx';
import HMLogo from './HMLogo.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <Card className="login-card">
        <div className="login-brand">
          <HMLogo size={56} />
          <div style={{ textAlign: 'center' }}>
            <div className="name">Attendance OS</div>
            <div className="sub">HaseebMadeIt</div>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 0, textAlign: 'center' }}>Sign in to manage attendance.</p>
        <ErrorBanner error={error} />
        <form onSubmit={submit} className="grid" style={{ gap: 12 }}>
          <Field label="Email">
            <input type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="muted" style={{ fontSize: '.82rem', marginBottom: 0 }}>
          Admin users are created in Supabase → Authentication. The browser uses the
          anon key; access is gated by row-level security.
        </p>
      </Card>
    </div>
  );
}
