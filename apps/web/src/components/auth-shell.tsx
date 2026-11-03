import Link from "next/link";
import type { ReactNode } from "react";
import { ConsyrionMark } from "./brand/consyrion-logo";
import { ConsyrionOrbitalLogo } from "./brand/orbital-logo";
import { RibbonField } from "./fx/ribbon-field";
import { Icon, type IconName } from "./ui/icons";

const FEATURES: Array<{ icon: IconName; text: [string, string]; color: string }> = [
  { icon: "layers", text: ["Independent", "AI perspectives"], color: "text-primary" },
  { icon: "lock", text: ["Your keys.", "Your control."], color: "text-success" },
  { icon: "cube", text: ["Build only", "after approval"], color: "text-accent-text" },
];

/**
 * Brand stage for sign-in, sign-up and invitations (design concept in PR #78): always dark, full-page light
 * ribbons, headline and orbital illustration on the left, the glass form card on the right.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="stage-dark relative isolate min-h-svh overflow-x-clip bg-bg text-text">
      <RibbonField />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_30%_55%,rgb(34_211_238/0.08),transparent_55%),radial-gradient(ellipse_at_85%_45%,rgb(139_92_246/0.1),transparent_50%)]"
      />
      <div className="mx-auto flex min-h-svh w-full max-w-[1440px] flex-col px-4 py-6 md:px-10 lg:py-8">
        <Link href="/" className="flex w-fit items-center gap-4" aria-label="CONSYRION AI home">
          <ConsyrionMark size={52} title="" className="drop-shadow-[0_0_14px_rgb(34_211_238/0.45)]" />
          <span>
            <span className="block font-[family-name:var(--font-display)] text-xl tracking-[0.32em]">CONSYRION AI</span>
            <span className="block text-xs tracking-[0.18em] text-muted">Debate. Decide. Deliver.</span>
          </span>
        </Link>
        <div className="grid flex-1 items-center gap-4 py-4 lg:py-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(400px,0.9fr)] lg:gap-[clamp(32px,5vw,96px)]">
          <section aria-label="About CONSYRION AI">
            <p className="hidden font-[family-name:var(--font-display)] text-[clamp(44px,4.6vw,76px)] lg:block leading-[1.02] font-semibold tracking-[-0.035em]">
              Many perspectives.
              <span className="block bg-[linear-gradient(90deg,#22d3ee,#2ee6a8)] bg-clip-text text-transparent">One clear decision.</span>
            </p>
            <p className="mt-4 hidden text-[clamp(16px,1.5vw,22px)] tracking-[0.3em] text-muted lg:block">Debate. Decide. Deliver.</p>
            {/* One scene for all sizes (one WebGL setup): compact above the form on mobile. */}
            <ConsyrionOrbitalLogo className="mx-auto max-w-[360px] lg:mt-2 lg:max-w-[560px]" />
            <ul className="mt-6 hidden grid-cols-3 divide-x divide-glass-line lg:grid">
              {FEATURES.map((feature) => (
                <li key={feature.icon} className="flex items-center gap-4 px-6 first:pl-0">
                  <Icon name={feature.icon} className={`size-9 shrink-0 ${feature.color} drop-shadow-[0_0_8px_currentColor]`} />
                  <span className="text-[15px] leading-snug">
                    {feature.text[0]}
                    <br />
                    {feature.text[1]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <div className="mx-auto w-full max-w-[600px]">
            <div className="rounded-[26px] bg-[linear-gradient(140deg,rgb(34_211_238/0.9),rgb(47_123_255/0.5)_45%,rgb(139_92_246/0.9))] p-px shadow-[0_0_60px_-10px_rgb(34_211_238/0.35),0_0_90px_-20px_rgb(139_92_246/0.4)]">
              <div className="rounded-[25px] bg-[rgb(7_13_26/0.86)] px-6 py-8 backdrop-blur-xl sm:px-10 sm:py-12 lg:px-12">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
