"use client";

import { useMessages, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { usePageVisible, usePrefersReducedMotion } from "@/lib/motion";
import { ConsyriumOrbitalLogo } from "./brand/orbital-logo";
import type { SceneLabels, StoryScene } from "./landing/story-scene";

/**
 * Sign-in / sign-up illustration: the first chapter of the landing page's 3D scene (same spheres, model names,
 * plasma core and pointer reaction – owner request 06.11.26: "not like the landing page"). Without WebGL 2 the
 * previous orbital logo is shown. Reduced motion or the Pause button: a still frame, no loop.
 */
export function AuthScene({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StoryScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const t = useTranslations("story");
  const labels = (useMessages() as { scene?: SceneLabels }).scene;
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    import("./landing/story-scene")
      .then(({ createStoryScene }) => {
        if (cancelled) return;
        const scene = createStoryScene(canvas, { mobile: window.matchMedia("(max-width: 767px)").matches, labels, framing: "center", stars: false });
        if (!scene) {
          setFailed(true);
          return;
        }
        sceneRef.current = scene;
        scene.setProgress(0);
        scene.frame(0);
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [labels]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || !canvas) return;
    const ro = new ResizeObserver(() => {
      sceneRef.current?.resize();
      sceneRef.current?.frame(0);
    });
    ro.observe(canvas);
    if (reduced || !visible || paused) {
      return () => {
        ro.disconnect();
      };
    }
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
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));
      last = now;
      sceneRef.current?.frame(dt);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerup", onLeave);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [ready, reduced, visible, paused]);

  if (failed) return <ConsyriumOrbitalLogo className={className} />;
  return (
    <div className={`relative aspect-[4/3] w-full ${className}`}>
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full" />
      {!reduced ? (
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className="absolute right-0 bottom-0 min-h-11 rounded-lg border border-glass-line bg-surface/60 px-3 py-2 text-xs text-muted hover:text-text"
        >
          {paused ? t("play") : t("pause")}
        </button>
      ) : null}
    </div>
  );
}
