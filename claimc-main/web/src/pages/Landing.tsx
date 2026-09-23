import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LogoIcon } from '../components/LogoIcon';

/**
 * ClaimChain landing — Halo fintech design language:
 * #F5F5F5 canvas, TT Norms Pro with tight negative letter-spacing, black pill
 * buttons with white arrow circles, dual infinite marquees, full-bleed video
 * hero. Copy adapted from the "USD Halo" reference to ClaimChain's product.
 */

const NAV_LINKS: Array<[string, string]> = [
  ['System', '/system'],
  ['Pipeline', '/pipeline'],
  ['Integrity', '/integrity'],
  ['Memory', '/memory'],
  ['Explorer', '/explorer'],
];

const HERO_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260423_161253_c72b1869-400f-45ed-ac0c-52f68c2ed5bd.mp4';
const USECASE_VIDEO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260423_183428_ab5e672a-f608-4dcb-b319-f3e040f02e2d.mp4';
const CARD_IMAGE =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260423_164207_f243351d-ed59-48ec-83a0-a5e996bdbe3c.png&w=1280&q=85';

/** Partner/stack marquee items — each with its own typographic voice. */
const BRANDS: Array<{ name: string; style: React.CSSProperties }> = [
  { name: 'Polygon', style: { fontFamily: 'Georgia, serif', fontWeight: 700, letterSpacing: '-0.02em', fontSize: 15 } },
  { name: 'Hardhat', style: { fontFamily: 'Arial, sans-serif', fontWeight: 900, letterSpacing: '0.08em', fontSize: 13, textTransform: 'uppercase' } },
  { name: 'Hugging Face', style: { fontFamily: "'Trebuchet MS', sans-serif", fontWeight: 600, letterSpacing: '0.01em', fontSize: 15, fontStyle: 'italic' } },
  { name: 'Tesseract', style: { fontFamily: "'Courier New', monospace", fontWeight: 700, letterSpacing: '0.12em', fontSize: 13, textTransform: 'uppercase' } },
  { name: 'Ethers', style: { fontFamily: 'Palatino, "Book Antiqua", serif', fontWeight: 400, letterSpacing: '-0.01em', fontSize: 16 } },
  { name: 'UPI', style: { fontFamily: 'Impact, "Arial Narrow", sans-serif', fontWeight: 400, letterSpacing: '0.04em', fontSize: 14 } },
  { name: 'IPFS', style: { fontFamily: 'Verdana, sans-serif', fontWeight: 700, letterSpacing: '-0.03em', fontSize: 13 } },
];

const BACKERS: Array<{ name: string; style: React.CSSProperties }> = [
  { name: 'RBI Sandbox', style: { fontFamily: "'Times New Roman', serif", fontWeight: 400, letterSpacing: '0.02em', fontSize: 14 } },
  { name: 'POLYGON VILLAGE', style: { fontFamily: '"Arial Black", sans-serif', fontWeight: 900, letterSpacing: '0.08em', fontSize: 16 } },
  { name: 'IRDAI', style: { fontFamily: 'Impact, "Arial Narrow", sans-serif', fontWeight: 700, letterSpacing: '0.05em', fontSize: 18 } },
  { name: 'AgriStack', style: { fontFamily: 'Georgia, serif', fontWeight: 600, letterSpacing: '-0.02em', fontSize: 17 } },
  { name: 'NABARD', style: { fontFamily: 'Helvetica, sans-serif', fontWeight: 700, letterSpacing: '-0.01em', fontSize: 15 } },
  { name: 'ONDC', style: { fontFamily: 'Verdana, sans-serif', fontWeight: 700, letterSpacing: '0.06em', fontSize: 14, textTransform: 'uppercase' } },
  { name: 'eNAM', style: { fontFamily: "'Courier New', monospace", fontWeight: 700, letterSpacing: '0.18em', fontSize: 14 } },
  { name: 'SETU', style: { fontFamily: 'Palatino, serif', fontWeight: 500, letterSpacing: '0.03em', fontSize: 15 } },
];

function ArrowPill({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-3 rounded-full bg-black py-2 pl-8 pr-2 text-base font-medium text-white transition-colors duration-200 hover:bg-gray-800"
    >
      {children}
      <span className="rounded-full bg-white p-2">
        <ArrowRight className="h-5 w-5 text-black" />
      </span>
    </Link>
  );
}

function Navbar() {
  return (
    <nav className="absolute left-0 right-0 top-0 z-20 px-6 py-5">
      <div className="mx-auto flex max-w-[88rem] items-center justify-between">
        <div className="flex items-center gap-2.5">
          <LogoIcon className="h-7 w-7 text-black" />
          <span className="text-2xl font-medium tracking-tight text-black">ClaimChain</span>
        </div>
        <div className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map(([label, to]) => (
            <Link key={to} to={to} className="text-base font-medium text-gray-700 transition-colors duration-200 hover:text-black">
              {label}
            </Link>
          ))}
        </div>
        <Link
          to="/console"
          className="rounded-full bg-black px-7 py-2.5 text-base font-medium text-white transition-colors duration-200 hover:bg-gray-800"
        >
          Open Console
        </Link>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="flex flex-1 items-end px-6 pb-6 pt-20">
      <div className="relative w-full overflow-hidden rounded-2xl" style={{ height: 'calc(100vh - 96px)' }}>
        <video autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" src={HERO_VIDEO} />
        <div className="relative z-10 flex h-full flex-col items-start justify-start p-12 pt-36">
          <h1 className="mb-4 max-w-xl text-5xl font-medium leading-tight text-black md:text-6xl" style={{ letterSpacing: '-0.04em' }}>
            Every Claim
            <br />
            Proves Itself
          </h1>
          <p
            className="mb-8 max-w-md text-base leading-relaxed text-black/70 md:text-lg"
            style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}
          >
            An automated, AI-verified claims engine for micro-insurance — every decision hashed and sealed on-chain, tamper-proof by construction.
          </p>
          <ArrowPill to="/console">Open the console</ArrowPill>

          {/* Brand marquee */}
          <div className="mt-24 w-full max-w-md overflow-hidden">
            <div className="marquee-track">
              {[...BRANDS, ...BRANDS].map((b, i) => (
                <span key={i} className="mx-7 shrink-0 whitespace-nowrap text-black/60" style={b.style}>
                  {b.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoSection() {
  return (
    <section className="bg-[#F5F5F5] px-6 py-24" id="system">
      <div className="mx-auto max-w-[88rem]">
        <div className="mb-16 grid grid-cols-1 items-start gap-12 md:grid-cols-2">
          <div>
            <h2 className="mb-8 text-4xl font-medium leading-tight text-black md:text-5xl" style={{ letterSpacing: '-0.03em' }}>
              Meet ClaimChain.
            </h2>
            <ArrowPill to="/console">Discover it</ArrowPill>
          </div>
          <p className="text-2xl leading-relaxed text-black/70 md:text-3xl">
            ClaimChain is a claims engine that verifies photographic evidence with a trained AI memory — and seals every decision on-chain, where nobody can quietly edit it.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            className="rounded-2xl lg:col-span-2"
            style={{ backgroundImage: `url(${CARD_IMAGE})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            <div className="flex min-h-80 flex-col justify-between p-7">
              <h3 className="text-2xl font-medium leading-snug text-black" style={{ letterSpacing: '-0.02em' }}>
                Fraud that can&apos;t hide
              </h3>
              <p className="max-w-xs text-base text-black/70">
                Every photo is fingerprinted — perceptual hashes, EXIF forensics and a CLIP embedding memory that remembers every past case.
              </p>
            </div>
          </div>
          <div className="rounded-2xl bg-[#2B2644] p-7">
            <div className="flex min-h-80 flex-col justify-between">
              <h3 className="text-2xl font-medium leading-snug text-white" style={{ letterSpacing: '-0.02em' }}>
                Always verified,
                <br />
                never typed.
              </h3>
              <p className="text-base text-white/60">
                Verdicts are computed by a 7-stage pipeline — no button decides a claim, and flagged claims are locked from payout by rule, not by trust.
              </p>
            </div>
          </div>
          <div className="rounded-2xl bg-[#2B2644] p-7">
            <div className="flex min-h-80 flex-col justify-between">
              <h3 className="text-2xl font-medium leading-snug text-white" style={{ letterSpacing: '-0.02em' }}>
                Fully
                <br />
                sealed.
              </h3>
              <p className="text-base text-white/60">
                Submissions, AI decisions, human reviews and payouts — each becomes a hash-linked record on-chain. Retro-edits break the chain loudly.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BackedBy() {
  return (
    <section className="bg-[#F5F5F5] px-6" id="pipeline">
      <div className="mx-auto grid max-w-[88rem] grid-cols-1 items-center gap-8 md:grid-cols-4">
        <p className="text-base leading-relaxed text-black/70">
          Built on open rails
          <br />
          and public infrastructure.
        </p>
        <div className="overflow-hidden md:col-span-3">
          <div className="backers-track">
            {[...BACKERS, ...BACKERS].map((b, i) => (
              <span key={i} className="mx-10 shrink-0 whitespace-nowrap text-black/50" style={b.style}>
                {b.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function UseCases() {
  return (
    <section className="bg-[#F5F5F5] px-6 py-24" id="integrity">
      <div className="mx-auto grid max-w-[88rem] grid-cols-1 items-start gap-8 md:grid-cols-2">
        <div className="pt-2 md:pr-12">
          <p className="mb-2 text-sm text-black/60">ClaimChain in practice</p>
          <h2 className="mb-6 text-5xl font-medium leading-none text-black md:text-6xl" style={{ letterSpacing: '-0.04em' }}>
            Use modes
          </h2>
          <p className="max-w-sm text-base leading-relaxed text-black/60">
            ClaimChain powers crop and livestock insurance, cooperative treasuries, parametric payouts and any program where small claims meet big fraud risk.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            <Link to="/system" className="text-black/60 transition-colors hover:text-black">Architecture →</Link>
            <Link to="/pipeline" className="text-black/60 transition-colors hover:text-black">The 7 stages →</Link>
            <Link to="/integrity" className="text-black/60 transition-colors hover:text-black">Tamper demo →</Link>
          </div>
        </div>
        <div className="relative min-h-[720px] overflow-hidden rounded-3xl">
          <video autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" src={USECASE_VIDEO} />
          <div className="relative z-10 p-10 md:p-12">
            <h3 className="mb-5 text-4xl font-medium leading-tight text-black md:text-5xl" style={{ letterSpacing: '-0.03em' }}>
              Integrity
            </h3>
            <p className="mb-8 max-w-md text-base text-black/70">
              Auditors and regulators verify any claim&apos;s history with a single hash — no PII exposed, no trust required. Try the retro-edit demo inside the console and watch the chain break.
            </p>
            <Link to="/console" className="group inline-flex items-center gap-3 text-base font-medium text-black">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 backdrop-blur transition-colors group-hover:bg-white">
                <ArrowRight className="h-4 w-4 text-black" />
              </span>
              Know more
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-[#F5F5F5]">
      <div className="flex h-screen flex-col overflow-hidden">
        <Navbar />
        <Hero />
      </div>
      <InfoSection />
      <BackedBy />
      <UseCases />
    </div>
  );
}
