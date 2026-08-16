import Link from "next/link";
import type { Metadata } from "next";
import { LandingScene } from "@/components/LandingScene";
import "./landing.css";

export const metadata: Metadata = {
  title: "Energy Monitor",
  description:
    "A resident-facing view into your unit's live voltage, current, and power draw — with automatic fault detection and breaker response.",
};

export default function LandingPage() {
  const year = new Date().getFullYear();

  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <span className="landing-nav-mark">
          <span className="app-shell-brand-mark">⚡</span>
          <span>Energy Monitor</span>
        </span>
        <Link href="/login" className="ghost-btn landing-nav-cta">
          Sign in
        </Link>
      </nav>

      <section className="landing-hero">
        <LandingScene />

        <div className="landing-hero-inner">
          <span className="page-eyebrow">Resident Energy Monitor</span>
          <h1 className="landing-headline">
            <span className="landing-headline-line">Three phases.</span>
            <span className="landing-headline-line">One breaker.</span>
            <span className="landing-headline-line">
              <span className="landing-headline-accent amber">Zero</span> surprises.
            </span>
          </h1>

          <p className="landing-lede">
            A live view into your unit&rsquo;s voltage, current, and power draw —
            read straight off the ESP32 and PZEM-004T meter at your panel. When a
            phase drifts outside a safe range it&rsquo;s logged as an alert; if it
            doesn&rsquo;t clear, the breaker can trip itself before you have to.
          </p>

          <div className="landing-cta-row">
            <Link href="/login" className="primary-btn">
              Sign in to your dashboard
            </Link>
            <span className="landing-cta-note">
              Access is per-resident. Ask your building manager for an account.
            </span>
          </div>

          <div className="landing-hero-photo">
            <div className="landing-hero-photo-frame">
              <img
                src="/hardware-build.jpg"
                alt="Breadboard prototype of the energy monitor: an ESP32 dev board, three PZEM-004T current sensor modules, a relay cutoff board, a DS3231 RTC module, and an 18650 battery shield, wired together on a perfboard."
                width={960}
                height={723}
                loading="eager"
                decoding="async"
              />
              <span className="landing-hero-photo-caption">
                <span className="landing-hero-photo-eyebrow">The prototype</span>
                ESP32 &middot; 3&times; PZEM-004T &middot; relay cutoff
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section-shell landing-watch">
        <span className="page-eyebrow">What it watches</span>

        <div className="landing-watch-item">
          <span className="landing-watch-index">01</span>
          <h3 className="landing-watch-title">Per-phase telemetry</h3>
          <p className="landing-watch-copy">
            Voltage, current, power, frequency, and power factor — tracked
            separately for Phase A, B, and C, not blended into one number that
            hides which line actually moved.
          </p>
        </div>

        <div className="landing-watch-item">
          <span className="landing-watch-index">02</span>
          <h3 className="landing-watch-title">Fault vs. incident</h3>
          <p className="landing-watch-copy">
            A short spike gets logged and left alone. A fault that won&rsquo;t
            clear gets promoted into a tracked incident, timestamped from start
            to recovery.
          </p>
        </div>

        <div className="landing-watch-item">
          <span className="landing-watch-index">03</span>
          <h3 className="landing-watch-title">Blackouts, counted</h3>
          <p className="landing-watch-copy">
            Every outage is a dated event with a duration — not just a gap in
            the chart you have to notice yourself.
          </p>
        </div>
      </section>

      <section className="landing-section-shell landing-respond">
        <div className="landing-respond-text">
          <h2>How it responds</h2>
          <p>
            Local hardware safety runs on the ESP32 itself, independent of
            Wi-Fi — an over- or under-voltage condition can trip the relay
            without waiting on the cloud to confirm it.
          </p>
          <p>
            Everything the cloud side decides — a manual trip, an auto-trip, a
            reset — gets written to an audit log with who initiated it and why.
          </p>
        </div>

        <div className="landing-respond-figure">
          <div className="landing-respond-number">60s</div>
          <div className="landing-respond-caption">
            before a spike is promoted to a logged incident
          </div>
        </div>
      </section>

      <footer className="landing-section-shell landing-footer">
        <div>
          <span className="landing-footer-mark">
            <span className="app-shell-brand-mark">⚡</span>
            <span>Energy Monitor</span>
          </span>
          <p className="landing-footer-meta">
            Built on an ESP32 and a PZEM-004T meter. © {year} Energy Monitor.
          </p>
        </div>
        <div className="landing-footer-links">
          <Link href="/login">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
