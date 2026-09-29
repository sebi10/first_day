// The map (docs/EXPANSION.md 5; package B builds it: the camera, gestures,
// hotspots, presets, Explore). THIS IS PACKAGE A's STUB, the stage-2 contract:
// it renders today's <Island> with today's toggle (tap empty ground: all <-> my
// zone; a builder figure: the build site; "See the island" back), moved out of
// home.tsx unchanged. It never calls `onObject` (today nothing on the island
// opens a sheet but the carts); B's map does. B owns this file from here.
import { useEffect, useState } from 'preact/hooks';
import type { IslandState, Role } from '../../sim/types';
import { fx } from '../feedback';
import { Island } from '../island';
import { siteBox } from '../island/geo';
import { Icon } from '../kit';
import type { ObjectRef } from '../objects';
import { settings } from '../settings';

/** today's view state, which B's presets build on: the seat's zone, the builders' site, or the whole island (null) */
type View = 'zone' | 'site' | null;
const viewOf = (preset: string | undefined): View => (preset === 'zone' || preset === 'site' ? preset : null);

export function MapView(p: {
  s: IslandState;
  role: Role | null;
  /** an object on the map was tapped: its sheet (home.tsx: the inspect sheet; a cart goes to onCart) */
  onObject: (r: ObjectRef) => void;
  /** a ground power cart was tapped: the GSE sheet on it */
  onCart: (cartId: string) => void;
  /** the preset to open on: 'zone' | 'site' | 'all' (default: all) */
  initial?: string;
  /**
   * stage-2 addition to 14.3 (optional): go to a preset from outside the map, e.g. the builders' line on Home jumps to
   * the build site. The map moves when `n` changes.
   */
  go?: { preset: string; n: number };
}) {
  const { s, role } = p;
  const [view, setView] = useState<View>(() => viewOf(p.initial));
  useEffect(() => {
    if (p.go) setView(viewOf(p.go.preset));
  }, [p.go?.n]);
  void p.onObject;
  const site = siteBox(s);
  const zoom: View = view === 'site' && !site ? null : view === 'zone' && !role ? null : view;
  return (
    <div class="island-wrap" style={{ cursor: 'pointer' }}>
      <Island
        s={s}
        focus={zoom === 'zone' ? role : zoom}
        reduceMotion={settings.get().reduceMotion}
        onTap={() => {
          fx.tap();
          setView(zoom ? null : 'zone');
        }}
        onCart={(id) => {
          fx.tap();
          p.onCart(id);
        }}
        onBuilders={
          site && zoom !== 'site'
            ? () => {
                fx.tap();
                setView('site');
              }
            : undefined
        }
      />
      {zoom === 'site' ? (
        <button
          class="island-back"
          onClick={() => {
            fx.tap();
            setView(null);
          }}
        >
          <Icon name="island" size={16} /> See the island
        </button>
      ) : (
        <span class="island-hint">
          {s.weather === 'clear' ? '☀' : s.weather === 'wind' ? '〰 wind' : '⛈ storm'} · tap to {zoom ? 'see the island' : 'zoom to your zone'}
          {/* a builder figure is a tap target of its own (fix round 1: a tap near one opened the site unannounced) */}
          {site && !zoom ? ' · a builder: the site' : ''}
        </span>
      )}
    </div>
  );
}
