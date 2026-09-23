import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LogoIcon } from './LogoIcon';

/**
 * Shared Halo-language primitives used across the marketing pages and the
 * Console: hairline white cards, status chips, section titles, page heroes
 * and the site chrome (solid header + footer) for inner pages.
 */

export const TONE_CLASS: Record<string, string> = {
  ok: 'bg-[#10b981]/10 text-[#0b7a5c] border-[#10b981]/30',
  ai: 'bg-[#06b6d4]/10 text-[#0e7490] border-[#06b6d4]/30',
  warn: 'bg-[#f59e0b]/10 text-[#b45309] border-[#f59e0b]/30',
  bad: 'bg-[#ef4444]/10 text-[#b91c1c] border-[#ef4444]/30',
  muted: 'bg-black/5 text-black/50 border-black/10',
};

export function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${TONE_CLASS[tone] ?? TONE_CLASS.muted}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-black/10 bg-white ${className}`}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
      <h2 className="text-sm font-medium tracking-tight text-black" style={{ letterSpacing: '-0.01em' }}>
        {children}
      </h2>
      {right}
    </div>
  );
}

/** Inner-page hero: eyebrow + oversized tight title + lead paragraph. */
export function PageHero({ eyebrow, title, lead }: { eyebrow: string; title: string; lead: string }) {
  return (
    <section className="bg-[#F5F5F5] px-6 pb-10 pt-14">
      <div className="mx-auto max-w-[88rem]">
        <p className="mb-2 text-sm text-black/60">{eyebrow}</p>
        <h1 className="mb-5 max-w-3xl text-5xl font-medium leading-none text-black md:text-6xl" style={{ letterSpacing: '-0.04em' }}>
          {title}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-black/60 md:text-lg">{lead}</p>
      </div>
    </section>
  );
}

/** Solid header used by all inner pages (the landing keeps its own absolute one). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-black/10 bg-[#F5F5F5]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[88rem] items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <LogoIcon className="h-6 w-6 text-black" />
          <span className="text-lg font-medium tracking-tight text-black">ClaimChain</span>
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {[
            ['System', '/system'],
            ['Pipeline', '/pipeline'],
            ['Integrity', '/integrity'],
            ['Memory', '/memory'],
            ['Explorer', '/explorer'],
          ].map(([label, to]) => (
            <Link key={to} to={to} className="text-sm font-medium text-black/60 transition-colors hover:text-black">
              {label}
            </Link>
          ))}
        </nav>
        <Link
          to="/console"
          className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-gray-800"
        >
          Open Console
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-black/10 bg-[#F5F5F5] px-6 py-10">
      <div className="mx-auto flex max-w-[88rem] flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <LogoIcon className="h-5 w-5 text-black" />
          <span className="text-sm font-medium text-black">ClaimChain</span>
          <span className="text-xs text-black/40">AI-verified claims, sealed on-chain.</span>
        </div>
        <div className="flex flex-wrap items-center gap-5 text-xs font-medium text-black/50">
          {[
            ['System', '/system'],
            ['Pipeline', '/pipeline'],
            ['Integrity', '/integrity'],
            ['Memory', '/memory'],
            ['Explorer', '/explorer'],
          ].map(([label, to]) => (
            <Link key={to} to={to} className="transition-colors hover:text-black">
              {label}
            </Link>
          ))}
          <Link to="/console" className="transition-colors hover:text-black">
            Console
          </Link>
        </div>
      </div>
    </footer>
  );
}

/** Standard inner-page shell: header → hero → children → footer. */
export function InnerPage({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#F5F5F5]">
      <SiteHeader />
      <PageHero eyebrow={eyebrow} title={title} lead={lead} />
      <main className="flex-1 px-6 pb-16">
        <div className="mx-auto max-w-[88rem]">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

/** Back-to-landing ghost link. */
export function BackHome() {
  return (
    <Link to="/" className="inline-flex items-center gap-2 text-xs font-medium text-black/50 transition-colors hover:text-black">
      <ArrowLeft className="h-3 w-3" /> Back to landing
    </Link>
  );
}
