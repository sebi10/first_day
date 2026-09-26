// Start: your islands, new island, join by code, online setup.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { saveFirebaseConfig } from '../net/firebase';
import { onlineAvailable, sessions, storeFor } from '../net/session';
import type { Mode } from '../net/store';
import { ROLE_LABEL, ROLE_LONG } from '../sim/data';
import { createIsland, seatOf } from '../sim/engine';
import { ROLES, type IslandState, type Role } from '../sim/types';
import { fx } from './feedback';
import { Btn, Icon, Seg, Sheet, toast } from './kit';
import { Island } from './island';
import { settings } from './settings';
import { ROLE_TINT } from './theme';

const NAMES = ['Pelican Cay', 'Driftwood Key', 'Little Tern', 'Mango Reef', 'Gull Rock', 'Saltwind Isle', 'Coral Hollow', 'Frigate Bay'];

function RolePick({ value, onChange, taken = [] }: { value: Role | null; onChange(r: Role): void; taken?: Role[] }) {
  const icon = { mech: 'wrench', elec: 'bolt', fin: 'chart' } as const;
  return (
    <div class="rolepick" role="radiogroup">
      {ROLES.map((r) => (
        <button
          key={r}
          role="radio"
          aria-checked={value === r}
          class={value === r ? 'on' : ''}
          disabled={taken.includes(r)}
          style={{ ['--tint' as string]: ROLE_TINT[r] }}
          onClick={() => {
            fx.tap();
            onChange(r);
          }}
        >
          <Icon name={icon[r]} size={26} />
          {ROLE_LABEL[r]}
          <span class="label" style={{ fontSize: 11 }}>
            {taken.includes(r) ? 'taken' : ROLE_LONG[r].split(' ')[0]}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Start({ joinCode }: { joinCode?: string }) {
  const [, force] = useState(0);
  useEffect(() => sessions.subscribe(() => force((n) => n + 1)), []);
  const sess = sessions.get();
  const [name, setName] = useState(sess.playerName);
  const [sheet, setSheet] = useState<'new' | 'join' | 'setup' | null>(joinCode ? 'join' : null);
  const demo = useMemo<IslandState>(() => {
    const s = createIsland({ id: 'demo', name: 'Demo', now: 0, tz: 'UTC', seed: 7, creator: { uid: 'd', name: 'D', role: 'mech' } });
    s.assets.forEach((a) => (a.health = 88));
    return s;
  }, []);

  const saveName = (v: string) => {
    setName(v);
    sessions.setName(v.trim());
  };

  return (
    <div class="screen single" style={{ paddingBottom: 40 }}>
      <div class="hero">
        <h1>Island Company</h1>
        <span class="muted">Three friends, one tiny island business. The week only pays if the planes fly, the lights stay on and the cash holds.</span>
      </div>
      <div class="island-wrap">
        <Island s={demo} focus={null} reduceMotion={settings.get().reduceMotion} />
      </div>
      <div class="field">
        <span class="label">Your name</span>
        <input type="text" value={name} maxLength={20} placeholder="e.g. Seb" onInput={(e) => saveName((e.target as HTMLInputElement).value)} />
      </div>

      {sess.islands.length > 0 && (
        <div class="col" style={{ gap: 8 }}>
          <h2>Your islands</h2>
          {sess.islands.map((i) => (
            <a key={i.id} class="card row" href={`#/i/${i.id}`} style={{ textDecoration: 'none', color: 'inherit', ['--tint' as string]: ROLE_TINT[i.role] }}>
              <span class="avatar" style={{ ['--tint' as string]: ROLE_TINT[i.role] }}>
                <Icon name="island" size={18} />
              </span>
              <span class="col grow" style={{ gap: 2 }}>
                <b>{i.name}</b>
                <span class="label">
                  {i.passAndPlay ? 'Pass and play · all seats' : ROLE_LONG[i.role]} · {i.mode === 'firebase' ? 'online' : 'this device'}
                </span>
              </span>
              <Icon name="swap" size={18} />
            </a>
          ))}
        </div>
      )}

      <div class="col" style={{ gap: 8 }}>
        <Btn block disabled={!name.trim()} onClick={() => setSheet('new')}>
          New island
        </Btn>
        <Btn block kind="ghost" disabled={!name.trim()} onClick={() => setSheet('join')}>
          Join with a code
        </Btn>
        {!name.trim() && <span class="label center">Add your name first.</span>}
      </div>

      <div class="card col" style={{ gap: 6 }}>
        <h3>Install it</h3>
        <span class="label">
          iPhone: Safari → Share → Add to Home Screen. Android: Chrome menu → Install app. Computer: Chrome/Edge → install icon in the address bar. Runs full screen, works
          offline.
        </span>
        <div class="row spread">
          <span class="label">{onlineAvailable() ? '✓ Online play is set up' : 'Online play: not set up yet'}</span>
          <Btn small kind="soft" onClick={() => setSheet('setup')}>
            Online setup
          </Btn>
        </div>
      </div>

      <NewIsland open={sheet === 'new'} onClose={() => setSheet(null)} playerName={name.trim()} />
      <JoinIsland open={sheet === 'join'} onClose={() => setSheet(null)} playerName={name.trim()} initial={joinCode} />
      <Setup open={sheet === 'setup'} onClose={() => setSheet(null)} />
    </div>
  );
}

function NewIsland({ open, onClose, playerName }: { open: boolean; onClose(): void; playerName: string }) {
  const [island, setIsland] = useState(NAMES[Math.floor(Math.random() * NAMES.length)]);
  const [role, setRole] = useState<Role | null>(null);
  const [mode, setMode] = useState<'online' | 'pp'>(onlineAvailable() ? 'online' : 'pp');
  const [busy, setBusy] = useState(false);
  const [others, setOthers] = useState<Partial<Record<Role, string>>>({});
  return (
    <Sheet open={open} onClose={onClose} label="New island">
      <div class="col" style={{ gap: 14 }}>
        <h2>New island</h2>
        <div class="field">
          <span class="label">Island name</span>
          <input type="text" value={island} maxLength={24} onInput={(e) => setIsland((e.target as HTMLInputElement).value)} />
        </div>
        <span class="label">How will you play?</span>
        <Seg<'online' | 'pp'>
          value={mode}
          onChange={setMode}
          options={[
            { v: 'online', label: '3 devices · online' },
            { v: 'pp', label: '1 device · pass & play' },
          ]}
        />
        {mode === 'online' && !onlineAvailable() && <span class="fault">Online play needs the free Firebase setup first (start screen → Online setup).</span>}
        <span class="label">{mode === 'pp' ? 'Your seat' : 'Your seat (fixed for this island)'}</span>
        <RolePick value={role} onChange={setRole} />
        {mode === 'pp' && role && (
          <div class="row" style={{ gap: 8 }}>
            {ROLES.filter((r) => r !== role).map((r) => (
              <div class="field grow" key={r}>
                <span class="label">{ROLE_LABEL[r]}'s name</span>
                <input type="text" maxLength={20} value={others[r] ?? ''} placeholder={ROLE_LABEL[r]} onInput={(e) => setOthers({ ...others, [r]: (e.target as HTMLInputElement).value })} />
              </div>
            ))}
          </div>
        )}
        <Btn
          block
          disabled={!role || !island.trim() || busy || (mode === 'online' && !onlineAvailable())}
          onClick={async () => {
            if (!role) return;
            setBusy(true);
            try {
              const m: Mode = mode === 'online' ? 'firebase' : 'local';
              const id = await storeFor(m).create({ name: island.trim(), role, playerName, passAndPlay: mode === 'pp', names: others });
              sessions.upsert({ id, name: island.trim(), mode: m, role, passAndPlay: mode === 'pp' });
              fx.flourish();
              location.hash = `#/i/${id}`;
            } catch (e) {
              toast(String((e as Error).message ?? e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Building…' : 'Found the island'}
        </Btn>
      </div>
    </Sheet>
  );
}

function JoinIsland({ open, onClose, playerName: nameProp, initial }: { open: boolean; onClose(): void; playerName: string; initial?: string }) {
  const [code, setCode] = useState(initial ?? '');
  const [localName, setLocalName] = useState(nameProp);
  useEffect(() => setLocalName(nameProp), [nameProp]);
  const playerName = localName.trim();
  const [found, setFound] = useState<IslandState | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [seatKey, setSeatKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const store = storeFor('firebase');

  const parse = (v: string) => {
    const seat = / seat ([a-z2-9]{6})/i.exec(v)?.[1];
    if (seat) setSeatKey(seat.toLowerCase());
    const m = /join\/([0-9a-z]{6,})/i.exec(v) ?? /([0-9a-z]{10})/i.exec(v.trim());
    return (m?.[1] ?? v.trim()).toLowerCase();
  };

  const find = async () => {
    if (!onlineAvailable()) return toast('Online play is not set up on this device (Online setup).');
    setBusy(true);
    try {
      const id = parse(code);
      const [s, me] = await Promise.all([store.load(id), store.uid()]);
      setUid(me);
      if (!s) toast('No island with that code.');
      else {
        const mine = seatOf(s, me);
        if (mine) {
          sessions.upsert({ id: s.id, name: s.name, mode: 'firebase', role: mine });
          location.hash = `#/i/${s.id}`;
          return;
        }
        setFound(s);
      }
    } catch (e) {
      toast(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open && initial && !found) void find();
  }, [open]);

  const seatState = (r: Role) => {
    const p = found?.players[r];
    if (!p) return 'open';
    if (p.uid.startsWith('pp-')) return 'claim';
    return 'taken';
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        setFound(null);
        onClose();
      }}
      label="Join island"
    >
      <div class="col" style={{ gap: 14 }}>
        <h2>{found ? found.name : 'Join with a code'}</h2>
        {!found && (
          <>
            <div class="field">
              <span class="label">Island code or invite link</span>
              <input type="text" value={code} placeholder="e.g. 7qk2m9x4ab" autoCapitalize="off" onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
            </div>
            <Btn block disabled={!code.trim() || busy} onClick={find}>
              {busy ? 'Looking…' : 'Find island'}
            </Btn>
          </>
        )}
        {found && (
          <>
            {!nameProp && (
              <div class="field">
                <span class="label">Your name</span>
                <input
                  type="text"
                  value={localName}
                  maxLength={20}
                  placeholder="e.g. Seb"
                  onInput={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    setLocalName(v);
                    sessions.setName(v.trim());
                  }}
                />
              </div>
            )}
            <span class="label">Pick your seat. A taken seat can be linked to this device with its owner's seat code (e.g. your phone ↔ your computer).</span>
            <div class="col" style={{ gap: 8 }}>
              {ROLES.map((r) => {
                const st = seatState(r);
                const p = found.players[r];
                return (
                  <button
                    key={r}
                    class="card row"
                    style={{ border: 0, textAlign: 'left', boxShadow: role === r ? 'inset 0 0 0 3px var(--sea)' : undefined, ['--tint' as string]: ROLE_TINT[r] }}
                    onClick={() => {
                      fx.tap();
                      setRole(r);
                    }}
                  >
                    <span class="avatar" style={{ ['--tint' as string]: ROLE_TINT[r] }}>
                      {p ? p.name[0] : '+'}
                    </span>
                    <span class="col grow" style={{ gap: 0 }}>
                      <b>{ROLE_LONG[r]}</b>
                      <span class="label">
                        {st === 'open' ? 'Open seat' : st === 'claim' ? `Unclaimed · ${p?.name} · progress kept` : `${p?.name} · link a device with the seat code`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {role && seatState(role) === 'taken' && (
              <div class="field">
                <span class="label">Seat code</span>
                <input type="text" value={seatKey} maxLength={6} autoCapitalize="off" onInput={(e) => setSeatKey((e.target as HTMLInputElement).value.toLowerCase())} />
              </div>
            )}
            <Btn
              block
              disabled={!role || busy || !uid || !playerName || (seatState(role) === 'taken' && seatKey.length !== 6)}
              onClick={async () => {
                if (!role || !uid) return;
                setBusy(true);
                const taken = seatState(role) === 'taken';
                const r = await store.dispatch(found.id, { t: 'join', uid, name: playerName, role, reclaim: taken, key: taken ? seatKey : undefined });
                setBusy(false);
                if (r.error) return toast(r.error);
                sessions.upsert({ id: found.id, name: found.name, mode: 'firebase', role });
                fx.flourish();
                location.hash = `#/i/${found.id}`;
              }}
            >
              {role && seatState(role) === 'taken' ? 'Link this device' : 'Join'}
            </Btn>
          </>
        )}
      </div>
    </Sheet>
  );
}

function Setup({ open, onClose }: { open: boolean; onClose(): void }) {
  const [text, setText] = useState('');
  return (
    <Sheet open={open} onClose={onClose} label="Online setup">
      <div class="col" style={{ gap: 12 }}>
        <h2>Online setup (free, ~5 min, once)</h2>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, fontSize: 15 }}>
          <li>console.firebase.google.com → Add project (no Analytics needed). Spark plan = free.</li>
          <li>Build → Authentication → Get started → enable Anonymous.</li>
          <li>Build → Firestore Database → Create database (production mode), then paste the rules from firestore.rules in the repo.</li>
          <li>Project settings → Your apps → Web (&lt;/&gt;) → copy the firebaseConfig block and paste it below.</li>
        </ol>
        <span class="label">Whoever deploys the game can bake this in with .env.local instead, so friends never see this screen.</span>
        <div class="field">
          <textarea rows={6} value={text} placeholder="const firebaseConfig = { apiKey: '…', projectId: '…', … }" onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        </div>
        <Btn
          block
          disabled={!text.trim()}
          onClick={() => {
            if (saveFirebaseConfig(text)) {
              toast('Saved. Online play is ready on this device.');
              onClose();
              setTimeout(() => location.reload(), 500);
            } else toast('Could not find apiKey and projectId in that text.');
          }}
        >
          Save config
        </Btn>
      </div>
    </Sheet>
  );
}
