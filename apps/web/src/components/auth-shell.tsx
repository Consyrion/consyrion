import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConsyriumMark } from "./brand/consyrium-logo";
import { AuthScene } from "./auth-scene";
import { RibbonField } from "./fx/ribbon-field";
import { Icon, type IconName } from "./ui/icons";

// Each feature has two lines in messages: auth.shell.features.<key>.{line1,line2}.
const FEATURES: Array<{ icon: IconName; key: "perspectives" | "keys" | "build"; color: string }> = [
  { icon: "layers", key: "perspectives", color: "text-primary" },
  { icon: "lock", key: "keys", color: "text-success" },
  { icon: "cube", key: "build", color: "text-accent-text" },
];

/**
 * Brand stage for sign-in, sign-up and invitations (design concept in PR #78): always dark, full-page light
 * ribbons, headline and orbital illustration on the left, the glass form card on the right.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const t = useTranslations("auth.shell");
  return (
    <div className="stage-dark relative isolate min-h-svh overflow-x-clip bg-bg text-text">
      <RibbonField />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_30%_55%,rgb(34_211_238/0.08),transparent_55%),radial-gradient(ellipse_at_85%_45%,rgb(139_92_246/0.1),transparent_50%)]"
      />
      <div className="mx-auto flex min-h-svh w-full max-w-[1440px] flex-col px-4 py-6 md:px-10 lg:py-8">
        <Link href="/" className="flex w-fit items-center gap-4" aria-label={t("home")}>
          <ConsyriumMark size={52} title="" className="drop-shadow-[0_0_14px_rgb(34_211_238/0.45)]" />
          <span>
            <span className="block font-[family-name:var(--font-display)] text-xl tracking-[0.32em]">CONSYRIUM AI</span>
            <span className="block text-xs tracking-[0.18em] text-muted">{t("tagline")}</span>
          </span>
        </Link>
        <div className="grid flex-1 items-center gap-4 py-4 lg:py-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(400px,0.9fr)] lg:gap-[clamp(32px,5vw,96px)]">
          {/* QA 12.11.26 (phone): the form sat below the animation, out of view – on small screens it comes first. */}
          <section aria-label={t("about")} className="max-lg:order-2">
            <p className="hidden font-[family-name:var(--font-display)] text-[clamp(44px,4.6vw,76px)] lg:block leading-[1.02] font-semibold tracking-[-0.035em]">
              {t("headline1")}
              <span className="block bg-[linear-gradient(90deg,#22d3ee,#2ee6a8)] bg-clip-text text-transparent">{t("headline2")}</span>
            </p>
            <p className="mt-4 hidden text-[clamp(16px,1.5vw,22px)] tracking-[0.3em] text-muted lg:block">{t("tagline")}</p>
            {/* The landing page's 3D scene (first chapter), compact below the form on mobile. */}
            <AuthScene className="mx-auto max-w-[420px] lg:mt-2 lg:max-w-[640px]" />
            <ul className="mt-6 hidden grid-cols-3 divide-x divide-glass-line lg:grid">
              {FEATURES.map((feature) => (
                <li key={feature.icon} className="flex items-center gap-4 px-6 first:pl-0">
                  <Icon name={feature.icon} className={`size-9 shrink-0 ${feature.color} drop-shadow-[0_0_8px_currentColor]`} />
                  <span className="text-[15px] leading-snug">
                    {t(`features.${feature.key}.line1`)}
                    <br />
                    {t(`features.${feature.key}.line2`)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <div className="mx-auto w-full max-w-[600px] max-lg:order-1">
            <div className="rounded-[26px] bg-[linear-gradient(140deg,rgb(34_211_238/0.9),rgb(47_123_255/0.5)_45%,rgb(139_92_246/0.9))] p-px shadow-[0_0_60px_-10px_rgb(34_211_238/0.35),0_0_90px_-20px_rgb(139_92_246/0.4)]">
              <div className="rounded-[25px] bg-[rgb(7_13_26/0.86)] px-6 py-8 backdrop-blur-xl sm:px-10 sm:py-12 lg:px-12">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
