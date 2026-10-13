import CursorGrid from '../reactbits/CursorGrid';
import { useIsTouch } from '../lib/useIsMobile';

/**
 * Ambient layer beneath the whole console: two slow aurora blooms, a reactive
 * lattice that lights under the cursor, one scanline, and film grain. All of it
 * sits behind the map at low opacity so it reads as depth, not decoration.
 */
export default function Backdrop({ intense = false }: { intense?: boolean }) {
  // A cursor-reactive lattice has nothing to react to on a touch screen, and it
  // costs a rAF loop and battery — so phones get the aurora without it.
  const touch = useIsTouch();

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-void grain">
      <div
        className="aurora animate-driftA"
        style={{
          width: '58vw',
          height: '58vw',
          left: '-12vw',
          top: '-18vw',
          background: 'radial-gradient(circle, rgba(34,211,238,0.30), transparent 62%)',
          opacity: intense ? 0.9 : 0.55,
        }}
      />
      <div
        className="aurora animate-driftB"
        style={{
          width: '52vw',
          height: '52vw',
          right: '-14vw',
          bottom: '-20vw',
          background: 'radial-gradient(circle, rgba(168,85,247,0.26), transparent 62%)',
          opacity: intense ? 0.85 : 0.5,
        }}
      />
      <div
        className="aurora animate-driftA"
        style={{
          width: '38vw',
          height: '38vw',
          right: '22vw',
          top: '10vh',
          animationDelay: '-9s',
          background: 'radial-gradient(circle, rgba(255,107,44,0.16), transparent 65%)',
          opacity: 0.45,
        }}
      />

      {!touch && (
      <div className="absolute inset-0 opacity-[0.55]">
        <CursorGrid
          cellSize={78}
          color="#22D3EE"
          radius={190}
          falloff="smooth"
          holdTime={260}
          fadeDuration={1100}
          lineWidth={1}
          maxOpacity={0.42}
          fillOpacity={0.02}
          gridOpacity={0.018}
          cellRadius={2}
          clickPulse
          pulseSpeed={520}
        />
      </div>
      )}

      <div className="scanline" />
    </div>
  );
}
