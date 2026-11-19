import { useEffect, useRef } from 'react';
import { ThemeMode } from '../types/telemetry';

interface AtmoBackdropProps {
  windSpeedKmh: number;
  theme: ThemeMode;
}

interface Streamline {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
}

export function AtmoBackdrop({ windSpeedKmh, theme }: AtmoBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const windRef = useRef(windSpeedKmh);
  const themeRef = useRef(theme);

  useEffect(() => {
    windRef.current = windSpeedKmh;
  }, [windSpeedKmh]);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const streamlines: Streamline[] = Array.from({ length: 55 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      len: 45 + Math.random() * 85,
      speed: 0.4 + Math.random() * 0.9,
      alpha: 0.04 + Math.random() * 0.09,
    }));

    const drawFrame = (advance: boolean) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const isLight = themeRef.current === 'stone';
      const strokeBase = isLight ? '28, 25, 23' : '243, 237, 226';
      const velocityFactor = Math.max(0.35, Math.min(3.2, windRef.current / 6.5));

      for (const s of streamlines) {
        if (advance) {
          s.x += s.speed * velocityFactor;
          if (s.x > canvas.width + s.len) {
            s.x = -s.len;
            s.y = Math.random() * canvas.height;
          }
        }
        const waveY = s.y + Math.sin(s.x * 0.004 + s.speed) * 14;
        const grad = ctx.createLinearGradient(s.x - s.len, waveY, s.x, waveY);
        grad.addColorStop(0, `rgba(${strokeBase}, 0)`);
        grad.addColorStop(1, `rgba(${strokeBase}, ${s.alpha})`);

        ctx.beginPath();
        ctx.moveTo(s.x - s.len, waveY);
        ctx.lineTo(s.x, waveY);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    };

    if (reducedMotion) {
      drawFrame(false);
      return () => {
        window.removeEventListener('resize', resize);
      };
    }

    let rafId = 0;
    let lastDraw = 0;
    const loop = (ts: number) => {
      if (!document.hidden && ts - lastDraw >= 32) {
        lastDraw = ts;
        drawFrame(true);
      }
      rafId = window.requestAnimationFrame(loop);
    };
    rafId = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="atmo-stage" aria-hidden="true">
      <div className="atmo-aura atmo-aura-1" />
      <div className="atmo-aura atmo-aura-2" />
      <canvas ref={canvasRef} className="atmo-backdrop" />
    </div>
  );
}

