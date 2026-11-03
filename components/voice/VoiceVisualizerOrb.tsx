'use client';

import { useEffect, useRef } from 'react';
import { ORB_REDUCED_MOTION_SCALE, orbScale } from './orb-math';

// Base radius is 60% of half the canvas so the largest scale (1.35) stays inside the canvas.
const BASE_RADIUS_FACTOR = 0.6;

export function VoiceVisualizerOrb({ level, active, size = 160 }: { level: number; active: boolean; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  const activeRef = useRef(active);

  useEffect(() => {
    levelRef.current = level;
    activeRef.current = active;
  }, [level, active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;

    const draw = () => {
      const scale = reduceMotion ? ORB_REDUCED_MOTION_SCALE : orbScale(levelRef.current);
      const radius = (size / 2) * BASE_RADIUS_FACTOR * scale;
      const center = size / 2;
      const glow = activeRef.current ? 0.9 : 0.45;

      ctx.clearRect(0, 0, size, size);
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);
      gradient.addColorStop(0, `rgba(129, 140, 248, ${glow})`);
      gradient.addColorStop(0.7, `rgba(99, 102, 241, ${glow * 0.6})`);
      gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fill();

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [size]);

  return <canvas ref={canvasRef} role="img" aria-label="Voice activity" />;
}
