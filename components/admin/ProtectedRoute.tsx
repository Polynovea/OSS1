"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Lock, User } from "lucide-react";
import { getSupabaseBrowserIdentityProvider } from "@/lib/auth/supabaseProvider";
import { canAccessPath } from "@/lib/admin/access";
import { useAdminAccess } from "@/lib/admin/useAdminAccess";

function LoginScreen({
  identifier, setIdentifier, password, setPassword, error, loading, onSubmit,
}: {
  identifier: string;
  setIdentifier: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  error: string;
  loading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const goldRef = useRef<HTMLDivElement>(null);
  const violetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      if (goldRef.current) goldRef.current.style.transform = `translate(${x * 30}px, ${y * 30}px)`;
      if (violetRef.current) violetRef.current.style.transform = `translate(${x * -40}px, ${y * -40}px)`;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <>
      <style>{`
        @keyframes login-orb-pulse {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.12); opacity: 1; }
        }
        .login-gold-orb { animation: login-orb-pulse 10s ease-in-out infinite; }
        .login-violet-orb { animation: login-orb-pulse 8s ease-in-out infinite 2s; }
      `}</style>

      {/* Full-page atmosphere layer */}
      <div className="fixed inset-0 z-0 bg-canvas bg-dot-grid" />

      {/* Gold orb — top left */}
      <div
        ref={goldRef}
        className="login-gold-orb pointer-events-none fixed z-0 w-[70vw] h-[70vw] top-[-5%] left-[-10%] bg-[radial-gradient(circle,rgba(230,211,163,0.18)_0%,rgba(230,211,163,0.06)_40%,transparent_70%)] blur-[60px]"
      />

      {/* Violet orb — bottom right */}
      <div
        ref={violetRef}
        className="login-violet-orb pointer-events-none fixed z-0 w-[70vw] h-[70vw] bottom-[-15%] right-[-10%] bg-[radial-gradient(circle,rgba(124,58,237,0.22)_0%,rgba(124,58,237,0.08)_40%,transparent_70%)] blur-[70px]"
      />

      {/* Page */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-6">
        <main className="w-full max-w-[420px]">
          <div
            className="rounded-2xl p-10 bg-[#0E0E11]/80 border border-action/20 shadow-[0_24px_80px_rgba(0,0,0,0.6),_inset_0_1px_0_rgba(230,211,163,0.08)] backdrop-blur-[20px]"
          >
            {/* Brand */}
            <header className="mb-10 flex flex-col items-center">
              <div className="mb-4 transition-transform duration-500 hover:scale-110">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M24 4L44 24L24 44L4 24L24 4Z" fill="rgba(230,211,163,0.10)" stroke="rgba(230,211,163,0.55)" strokeWidth="1.5" />
                  <path d="M24 12L36 24L24 36L12 24L24 12Z" fill="rgba(230,211,163,0.15)" stroke="rgba(230,211,163,0.35)" strokeWidth="1" />
                  <circle cx="24" cy="24" r="3" fill="#E6D3A3" />
                </svg>
              </div>
              <h1 className="font-headline font-bold text-2xl tracking-[-0.01em] text-on-surface mb-1">POLYNOVEA</h1>
              <p className="font-body text-[10px] font-semibold tracking-[0.2em] uppercase text-action/50">Executive Command</p>
            </header>

            {/* Title */}
            <div className="mb-7">
              <h2 className="font-headline font-extrabold text-[32px] leading-tight tracking-[-0.02em] text-on-surface">Sign in</h2>
            </div>

            {/* Form */}
            <form onSubmit={onSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <label className="font-body text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
                  Email
                </label>
                <div className="relative group">
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    autoFocus
                    className="w-full h-12 rounded-xl border border-subtle bg-surface-1 pl-4 pr-11 text-sm text-on-surface outline-none transition-all placeholder:text-fg-muted focus:border-primary"
                  />
                  <User size={15} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-fg-muted transition-colors group-focus-within:text-primary/60" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-body text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
                  Password
                </label>
                <div className="relative group">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full h-12 rounded-xl border border-subtle bg-surface-1 pl-4 pr-11 text-sm text-on-surface outline-none transition-all focus:border-primary"
                  />
                  <Lock size={15} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-fg-muted transition-colors group-focus-within:text-primary/60" />
                </div>
              </div>

              {error && (
                <p className="rounded-xl border border-danger bg-danger-muted px-3 py-2.5 text-xs text-danger">{error}</p>
              )}

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="group flex w-full h-12 items-center justify-center gap-2 rounded-full border-none bg-primary/90 font-body text-[12px] font-bold uppercase tracking-[0.12em] text-background transition-all duration-300 hover:bg-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 shadow-[0_8px_32px_rgba(230,211,163,0.15)]"
                >
                  {loading ? "Authenticating..." : (
                    <>
                      Sign In
                      <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Footer */}
            <div className="mt-8 flex flex-col items-center gap-3">
              <button type="button" className="font-body text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-muted transition-colors hover:text-primary">
                Forgot access credentials?
              </button>
              <div className="h-px w-8 bg-surface-2" />
              <p className="text-center font-body text-[11px] text-fg-muted leading-relaxed max-w-[260px]">
                Authorized personnel only. Access monitored by Global Security Protocols.
              </p>
            </div>
          </div>

          {/* Status indicator */}
          <div className="mt-6 flex items-center justify-center gap-2 opacity-50 transition-opacity hover:opacity-100">
            <span className="h-1.5 w-1.5 rounded-full bg-success-muted animate-pulse" />
            <span className="font-body text-[10px] font-semibold uppercase tracking-[0.15em] text-fg-muted">
              System Status: Operational
            </span>
          </div>
        </main>

        {/* Bottom bar */}
        <div className="fixed bottom-0 left-0 right-0 z-10 flex flex-col items-center justify-between gap-3 px-8 py-4 sm:flex-row">
          <p className="font-body text-[10px] uppercase tracking-[0.08em] text-fg-muted">
            © {new Date().getFullYear()} Polynovea Executive Command. All Rights Reserved.
          </p>
          <nav className="flex gap-6">
            {["Privacy Protocol", "Terms of Access", "System Status"].map((label) => (
              <span key={label} className="cursor-default font-body text-[10px] uppercase tracking-[0.08em] text-fg-muted transition-colors hover:text-fg-secondary">
                {label}
              </span>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { session, profile, checked, allowed } = useAdminAccess();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const resolvedEmail = identifier.trim().toLowerCase();

    const { error } = await getSupabaseBrowserIdentityProvider().signInWithPassword({ email: resolvedEmail, password });
    if (error) setError(error.message);

    setLoading(false);
  };

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <div className="w-8 h-8 border-2 border-outline border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!session || !allowed) {
    return <LoginScreen identifier={identifier} setIdentifier={setIdentifier} password={password} setPassword={setPassword} error={error} loading={loading} onSubmit={handleLogin} />;
  }

  if (!canAccessPath(profile, pathname)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-[520px] rounded-2xl border border-outline-variant bg-surface p-10 shadow-2xl">
          <div className="mb-5">
            <p className="font-body text-[10px] font-semibold uppercase tracking-[0.12em] text-primary mb-3">Access Locked</p>
            <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface mb-3">You do not have access to this section.</h1>
            <p className="font-body text-sm text-on-surface-variant">
              Your account is active, but it is not allowed to open this route. Ask the master account to update your CMS or Content permissions.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/admin"
              className="inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 font-body text-[12px] font-bold uppercase tracking-[0.08em] text-background no-underline"
            >
              Back To Gateway
            </Link>
            <button
              type="button"
              onClick={() => void getSupabaseBrowserIdentityProvider().signOut()}
              className="inline-flex items-center justify-center rounded-xl border border-outline px-5 py-3 font-body text-[12px] font-bold uppercase tracking-[0.08em] text-on-surface-variant bg-transparent cursor-pointer"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
