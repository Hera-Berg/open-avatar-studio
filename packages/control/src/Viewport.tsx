import { useEffect, useRef, type RefObject } from "react";
import type { AvatarTransform, Scene } from "@oar/shared";
import type { Player } from "@oar/player";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface ViewportProps {
  playerRef: RefObject<Player | null>;
  scene: Scene | null;
  modelName: string | null;
  viewportRef: RefObject<HTMLCanvasElement>;
  bgLayerRef: RefObject<HTMLDivElement>;
  bgCanvasRef: RefObject<HTMLCanvasElement>;
}

export function Viewport({
  playerRef,
  scene,
  modelName,
  viewportRef,
  bgLayerRef,
  bgCanvasRef,
}: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; base: AvatarTransform } | null>(null);
  const pendingRef = useRef<AvatarTransform | null>(null);
  const rafRef = useRef(0);

  const queueAvatar = (av: AvatarTransform) => {
    pendingRef.current = av;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const player = playerRef.current;
        if (player && pendingRef.current) player.setAvatar(pendingRef.current);
        pendingRef.current = null;
      });
    }
  };

  // Keep the WebGL drawing buffer at device-pixel resolution.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = viewportRef.current;
    if (!container || !canvas) return;
    const onResize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(64, Math.floor(rect.width * devicePixelRatio));
      canvas.height = Math.max(64, Math.floor(rect.height * devicePixelRatio));
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    onResize();
    return () => observer.disconnect();
  }, [viewportRef]);

  // Wheel zoom. Registered natively (non-passive) so page scroll is disabled.
  useEffect(() => {
    const canvas = viewportRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const player = playerRef.current;
      if (!player || player.scene.avatar.locked) return;
      const base = player.effectiveAvatar();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      queueAvatar({ ...base, zoom: clamp(base.zoom * factor, 0.05, 40) });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerRef, viewportRef]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const player = playerRef.current;
    if (!player || player.scene.avatar.locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      base: player.effectiveAvatar(),
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    const player = playerRef.current;
    if (!d || !player) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    // Camera centre follows the pointer: drag right → camera moves left, the
    // avatar appears to move right with the cursor.
    queueAvatar({ ...d.base, x: d.base.x - dx, y: d.base.y - dy });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div className="viewport" ref={containerRef}>
      <div ref={bgLayerRef} className="bg-layer"></div>
      <canvas ref={bgCanvasRef} className="bg-canvas"></canvas>
      <canvas
        ref={viewportRef}
        className="viewport-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="hud">
        {scene?.live ? <span className="badge live">LIVE</span> : null}
        {modelName ? <span className="badge">{modelName}</span> : null}
        <span className="badge hint">
          {scene ? "drag to move · scroll to zoom" : "connecting…"}
        </span>
      </div>
    </div>
  );
}
