"use client";

import Link from "next/link";
import { useMessages, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { usePageVisible, usePrefersReducedMotion } from "@/lib/motion";
import { buttonClasses } from "../ui/button";
import { STORY_CHAPTERS, type StoryChapter } from "./story-chapters";
import type { SceneLabels, StoryScene } from "./story-scene";
import { progressFromRects } from "./story-timeline";

/** Stage colour mood per chapter: reveal, objection, verdict, approval and build each read differently. */
const MOOD: Record<string, string> = {
  "open-council": "radial-gradient(60% 55% at 62% 45%, rgb(34 211 238 / 0.22), transparent 70%)",
  "twelve-minds": "radial-gradient(60% 55% at 62% 45%, rgb(47 123 255 / 0.16), transparent 70%)",
  "minority-review": "radial-gradient(45% 45% at 70% 62%, rgb(251 191 36 / 0.22), transparent 70%), linear-gradient(rgb(0 0 0 / 0.28), rgb(0 0 0 / 0.28))",
  "consensus-round": "radial-gradient(60% 55% at 60% 55%, rgb(46 230 168 / 0.14), transparent 70%)",
  "final-verdict": "radial-gradient(55% 55% at 62% 48%, rgb(34 211 238 / 0.2), rgb(139 92 246 / 0.12) 45%, transparent 75%)",
  approval: "radial-gradient(55% 55% at 62% 50%, rgb(46 230 168 / 0.22), transparent 72%)",
  build: "radial-gradient(60% 60% at 66% 50%, rgb(139 92 246 / 0.2), transparent 72%)",
};

/** Chapters with a short navigation label (the others use their title). */
const SHORT_IDS = new Set(["top", "prepare", "approval", "build", "start"]);

interface Cta {
  label: string;
  href: string;
}

/**
 * Homepage scroll story (#85): one sticky 3D scene (three.js, loaded on demand) behind semantic chapter cards.
 * The chapter under the middle of the viewport drives the scene; native scrolling only. Reduced motion, missing
 * WebGL 2 or a load error show the same chapters as a static process story.
 */
export function ProcessStory({ start, secondary, signIn }: { start: Cta; secondary: Cta; signIn: Cta }) {
  const t = useTranslations("story");
  // Texts inside the 3D scene follow the visitor's language (messages `scene.*`, English fallback in the scene).
  const sceneLabels = (useMessages() as { scene?: SceneLabels }).scene;
  // Structure (ids, phases, order) from STORY_CHAPTERS; the words from the interface language. Phase titles stay the
  // canonical product names in every language (CLAUDE.md).
  const chapters: StoryChapter[] = STORY_CHAPTERS.map((c) => ({
    ...c,
    kicker: t(`chapters.${c.id}.kicker`),
    title: c.phase ? c.title : t(`chapters.${c.id}.title`),
    text: t(`chapters.${c.id}.text`),
    example: c.example ? t(`chapters.${c.id}.example`) : undefined,
    points: c.points ? (t.raw(`chapters.${c.id}.points`) as string[]) : undefined,
  }));
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  // Static until the client knows motion is fine (the server assumes reduced motion); static for good on failure.
  const [failed, setFailed] = useState(false);
  const mode: "stage" | "static" = reduced || failed ? "static" : "stage";
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const chapterRefs = useRef<Array<HTMLLIElement | null>>([]);
  const sceneRef = useRef<StoryScene | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // The page is rendered static first and switches to the taller stage layout after hydration; a deep link
  // (#overview, #approval, …) has to be scrolled to again once the layout has settled.
  useEffect(() => {
    if (mode !== "stage" || !window.location.hash) return;
    const frame = requestAnimationFrame(() => document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView());
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  // Scene lifecycle.
  useEffect(() => {
    if (mode !== "stage") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    import("./story-scene")
      .then(({ createStoryScene }) => {
        if (cancelled) return;
        const scene = createStoryScene(canvas, { mobile: window.matchMedia("(max-width: 767px)").matches, labels: sceneLabels });
        if (!scene) {
          setFailed(true);
          return;
        }
        sceneRef.current = scene;
        // Draw the first frame right away, so the stage is never empty (also in a tab that opens in the background).
        scene.setProgress(0);
        scene.frame(0);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [mode, sceneLabels]);

  // Scroll → progress → render loop (only while the story is on screen and the tab is visible).
  useEffect(() => {
    if (mode !== "stage" || !visible) return;
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    if (!section || !canvas) return;
    let onScreen = true;
    const io = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting);
    });
    io.observe(section);
    const ro = new ResizeObserver(() => sceneRef.current?.resize());
    ro.observe(canvas);
    // Pointer → plasma core (canvas NDC); touch releases the pointer when lifted.
    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      sceneRef.current?.setPointer({ x: ((e.clientX - rect.left) / rect.width) * 2 - 1, y: -(((e.clientY - rect.top) / rect.height) * 2 - 1) });
    };
    const onLeave = (e: PointerEvent) => {
      if (e.type === "pointerleave" || e.pointerType !== "mouse") sceneRef.current?.setPointer(null);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerup", onLeave, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    let shown = -1;
    let target = 0;
    let lastActive = -1;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // rAF timestamps can be slightly older than the start value: never step time backwards.
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
      last = now;
      if (!onScreen) return;
      const rects = chapterRefs.current.map((el) => {
        const r = el?.getBoundingClientRect();
        return { top: r?.top ?? 0, height: r?.height ?? 1 };
      });
      target = progressFromRects(rects, window.innerHeight);
      const index = Math.floor(target + 0.001);
      if (index !== lastActive) {
        lastActive = index;
        setActive(index);
      }
      const settled = Math.abs(shown - target) < 0.0005;
      shown = shown < 0 ? target : shown + (target - shown) * Math.min(1, dt * 7);
      const scene = sceneRef.current;
      if (!scene) return;
      // Paused and nothing scrolled: no need to draw.
      if (pausedRef.current && settled) return;
      scene.setProgress(shown);
      scene.frame(pausedRef.current ? 0 : dt);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerup", onLeave);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [mode, visible]);

  const stage = mode === "stage";
  const last = chapters.length - 1;

  const chapterNav = (
    <nav
      aria-label={t("chaptersLabel")}
      className={
        stage
          ? // QA 12.11.26 (phone): the chapter chips stood above the headline – on small screens they appear once the reader
            // has scrolled past the intro.
            `pointer-events-auto absolute inset-x-0 top-[64px] flex gap-2 overflow-x-auto px-4 py-2 md:inset-x-auto md:top-1/2 md:right-6 md:-translate-y-1/2 md:flex-col md:gap-1 md:overflow-visible md:p-0 ${active === 0 ? "max-md:hidden" : ""}`
          : "mx-auto flex max-w-6xl flex-wrap gap-2 px-4 pt-10 md:px-8"
      }
    >
      {chapters.map((chapter, index) => (
        <a
          key={chapter.id}
          href={`#${chapter.id}`}
          aria-current={stage && active === index ? "step" : undefined}
          className="group flex shrink-0 items-center gap-2 rounded-full border border-glass-line bg-bg/70 px-3 py-1.5 text-xs text-muted backdrop-blur hover:text-text aria-[current=step]:border-[#22d3ee]/70 aria-[current=step]:text-text md:justify-end md:border-transparent md:bg-transparent md:px-1 md:py-0.5 md:backdrop-blur-none"
        >
          <span className={stage ? "md:sr-only md:group-hover:not-sr-only md:group-focus-visible:not-sr-only md:group-aria-[current=step]:not-sr-only" : ""}>
            {SHORT_IDS.has(chapter.id) ? t(`short.${chapter.id}`) : chapter.title}
          </span>
          <span
            aria-hidden="true"
            className={`${stage ? "md:block" : ""} hidden size-2.5 rounded-full border border-[#9fc4ff]/60 group-aria-[current=step]:border-[#22d3ee] group-aria-[current=step]:bg-[#22d3ee] group-aria-[current=step]:shadow-[0_0_10px_#22d3ee]`}
          />
        </a>
      ))}
    </nav>
  );

  return (
    <section id="how" ref={sectionRef} aria-labelledby="story-title" className="relative" data-story={mode}>
      <h2 id="story-title" className="sr-only">
        {t("title")}
      </h2>

      {stage ? (
        // The absolute frame spans the whole story; the sticky stage inside it ends exactly where the story ends.
        <div className="pointer-events-none absolute inset-0">
          <div className="sticky top-0 h-svh overflow-hidden">
            <div
              aria-hidden="true"
              className="absolute inset-0 transition-[background] duration-700"
              style={{ background: MOOD[STORY_CHAPTERS[active]?.id ?? ""] ?? "transparent" }}
            />
            <canvas ref={canvasRef} aria-hidden="true" className="relative size-full" />
            <p className="absolute top-[72px] left-4 rounded-full border border-glass-line bg-bg/70 px-3 py-1 text-xs text-muted backdrop-blur md:top-auto md:bottom-6 md:left-10">
              {t("illustration")}
            </p>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              className="pointer-events-auto absolute top-[64px] right-4 min-h-11 rounded-lg border border-glass-line bg-bg/70 px-3 py-2 text-xs text-muted backdrop-blur hover:text-text md:top-auto md:right-6 md:bottom-6"
            >
              {paused ? t("play") : t("pause")}
            </button>
            {chapterNav}
          </div>
        </div>
      ) : (
        <>
          {chapterNav}
          <p className="mx-auto max-w-6xl px-4 pt-3 text-xs text-muted md:px-8">{t("example")}</p>
        </>
      )}

      <ol className={stage ? "pointer-events-none relative" : "relative mx-auto max-w-3xl space-y-4 px-4 py-10 md:px-8"}>
        {chapters.map((chapter, index) => {
          const intro = index === 0;
          const closing = index === last;
          return (
            <li
              key={chapter.id}
              id={chapter.id}
              ref={(el) => {
                chapterRefs.current[index] = el;
              }}
              className={
                stage
                  ? // Rows are click-through so the stage controls behind them stay usable; only the cards take clicks.
                    `pointer-events-none block px-4 md:px-10 ${intro ? "min-h-[120svh] pt-[40svh] md:min-h-[130svh] md:pt-[22svh]" : "min-h-[125svh] pb-[30svh] md:min-h-[115svh] md:pb-[12svh]"}`
                  : "scroll-mt-20"
              }
            >
              <article
                className={`pointer-events-auto w-full rounded-3xl border border-glass-line bg-[rgb(6_12_26/0.6)] p-5 backdrop-blur-md md:p-8 ${stage ? (intro ? "max-w-[620px] md:ml-[2vw]" : "sticky top-[50svh] max-w-[460px] md:top-[24svh] md:ml-[3vw]") : ""} ${chapter.phase || chapter.id === "approval" ? "shadow-[0_0_40px_-18px_rgb(34_211_238/0.6)]" : ""}`}
              >
                <p
                  className={`text-xs font-semibold tracking-[0.25em] ${chapter.id === "approval" ? "text-warning" : chapter.id === "build" ? "text-accent-text" : "text-primary"}`}
                >
                  {stage ? null : <span className="mr-2 text-muted">{String(index + 1).padStart(2, "0")}</span>}
                  {chapter.kicker.toUpperCase()}
                </p>
                {intro ? (
                  <h1 className="mt-3 font-[family-name:var(--font-display)] text-[clamp(40px,6vw,84px)] leading-[1.02] font-semibold tracking-[-0.035em]">
                    <span className="sr-only">{chapter.title}</span>
                    {chapter.title.split(" ").map((word, i) => (
                      <span
                        key={word}
                        aria-hidden="true"
                        className={i === 2 ? "block bg-[linear-gradient(90deg,#22d3ee,#2ee6a8)] bg-clip-text text-transparent" : "block"}
                      >
                        {word}
                      </span>
                    ))}
                  </h1>
                ) : (
                  <h3
                    className={`mt-2 font-[family-name:var(--font-display)] font-semibold tracking-tight ${closing ? "text-2xl md:text-3xl" : "text-2xl md:text-[32px]"}`}
                  >
                    {chapter.title}
                  </h3>
                )}
                <p className={`mt-3 text-muted ${intro ? "md:text-lg" : "text-sm md:text-base"}`}>{chapter.text}</p>
                {chapter.example ? (
                  <p className="mt-4 rounded-xl border border-[#22d3ee]/30 bg-[#22d3ee]/[0.07] px-3.5 py-2.5 text-sm">
                    <span className="mr-1.5 text-xs font-semibold tracking-[0.18em] text-primary">{t("exampleLabel").toUpperCase()}</span>
                    {chapter.example}
                  </p>
                ) : null}
                {chapter.points ? (
                  <ul className="mt-4 space-y-2 text-sm">
                    {chapter.points.map((point) => (
                      <li key={point} className="flex gap-2.5">
                        <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_var(--glow-cyan)]" />
                        {point}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {intro || closing ? (
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                      href={start.href}
                      className={buttonClasses(
                        "primary",
                        "h-12 rounded-xl bg-[linear-gradient(90deg,#1cc8ff,#5ef0c8)] px-6 text-base font-semibold text-[#03121c]",
                      )}
                    >
                      {start.label}
                    </Link>
                    {intro ? (
                      <a href={secondary.href} className={buttonClasses("secondary", "h-12 rounded-xl px-6 text-base")}>
                        {secondary.label}
                      </a>
                    ) : (
                      <Link href={signIn.href} className={buttonClasses("secondary", "h-12 rounded-xl px-6 text-base")}>
                        {signIn.label}
                      </Link>
                    )}
                  </div>
                ) : null}
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
