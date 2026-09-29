import Link from "next/link";
import "./landlord.css";

export const metadata = {
  title: "KiezKiss for landlords",
};

export default function LandlordLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ll-root">
      <nav className="ll-nav">
        <Link href="/" className="ll-logo">
          <span className="ll-logo-mark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 11l9-8 9 8" />
              <path d="M5 10v10h14V10" />
            </svg>
          </span>
          KiezKiss
        </Link>
        <div className="ll-nav-links">
          <Link href="/">For renters</Link>
          <Link href="/landlord" className="active">
            For landlords
          </Link>
          <Link href="/landlord#how-it-works">How it works</Link>
          <Link href="/landlord#about">About</Link>
        </div>
      </nav>
      {children}
    </div>
  );
}
