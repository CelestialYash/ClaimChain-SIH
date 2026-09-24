import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, LogIn, ShieldCheck } from 'lucide-react';
import { LogoIcon } from '../components/LogoIcon';
import { useAuth } from '../lib/auth';

/**
 * Insurer login (INSURER_AUTH_DB_SECURITY_PLAN.md §2). One-click presets fill
 * the demo inspector accounts — the judge sees auth working in two clicks.
 */

const PRESETS = [
  { email: 'inspector1@claimchain.gov.in', password: 'inspector1', label: 'Inspector 1', desc: 'Senior Fraud Investigator · Yavatmal / Nanded' },
  { email: 'inspector2@claimchain.gov.in', password: 'inspector2', label: 'Inspector 2', desc: 'Micro-claims Officer · Nashik / Pune' },
  { email: 'supervisor@claimchain.gov.in', password: 'supervisor', label: 'Supervisor', desc: 'Auditor · full override authority' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const destination = location.state?.from ?? '/console';

  async function doLogin(em: string, pw: string) {
    setError(null);
    setBusy(true);
    try {
      await login(em, pw);
      navigate(destination, { replace: true });
    } catch (e) {
      setError((e as Error).message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F5F5F5] px-6">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <LogoIcon className="h-7 w-7 text-black" />
          <span className="text-xl font-medium tracking-tight text-black">ClaimChain</span>
        </Link>

        <div className="rounded-2xl border border-black/10 bg-white p-8">
          <div className="mb-6 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-black" />
            <h1 className="text-2xl font-medium tracking-tight text-black" style={{ letterSpacing: '-0.03em' }}>
              Insurer sign in
            </h1>
          </div>
          <p className="mb-6 text-sm leading-relaxed text-black/60">
            Human review, overrides and payouts are restricted to authenticated inspectors. Every action is sealed on-chain with your identity.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void doLogin(email, password);
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-semibold uppercase tracking-widest text-black/50">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="inspector1@claimchain.gov.in"
                className="h-11 w-full rounded-lg border border-black/15 bg-white px-3 text-sm text-black outline-none transition-colors focus:border-black"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-semibold uppercase tracking-widest text-black/50">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 w-full rounded-lg border border-black/15 bg-white px-3 text-sm text-black outline-none transition-colors focus:border-black"
              />
            </div>

            {error && <div className="rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/10 px-3 py-2 text-sm text-[#b91c1c]">{error}</div>}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {busy ? 'Signing in…' : 'Sign in'}
              <LogIn className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-8 border-t border-black/10 pt-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-black/50">One-click demo accounts</p>
            <div className="space-y-2">
              {PRESETS.map((p) => (
                <button
                  key={p.email}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEmail(p.email);
                    setPassword(p.password);
                    void doLogin(p.email, p.password);
                  }}
                  className="group flex w-full items-center justify-between rounded-xl border border-black/10 px-4 py-3 text-left transition-colors hover:border-black/40 disabled:opacity-50"
                >
                  <span>
                    <span className="block text-sm font-medium text-black">{p.label}</span>
                    <span className="block text-xs text-black/50">{p.desc}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-black/40 transition-transform group-hover:translate-x-0.5 group-hover:text-black" />
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-black/40">Passwords are bcrypt-hashed · sessions are 24h JWTs · actions are audit-sealed</p>
      </div>
    </div>
  );
}
