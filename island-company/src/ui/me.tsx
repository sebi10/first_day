// Me tab: role track, tools, cosmetics, devices (phone ↔ computer), invite,
// notifications, settings.
import { useState } from 'preact/hooks';
import { firebaseStore } from '../net/firebase';
import { deleteLocal } from '../net/local';
import { onlineAvailable, sessions } from '../net/session';
import { PP_UID } from '../net/store';
import { PUZZLES } from '../puzzles';
import { COSMETICS, ROLE_LABEL, ROLE_LONG, TOOLS } from '../sim/data';
import { levelProgress } from '../sim/progression';
import { ROLES, type Role } from '../sim/types';
import { fx } from './feedback';
import { Btn, Icon, Seg, toast, Toggle, usd } from './kit';
import { settings, type Settings } from './settings';
import { shareText } from './share';
import { C, ROLE_TINT } from './theme';
import type { Ctl } from './useIsland';

export const inviteUrl = (id: string) => `${location.origin}${location.pathname}#/join/${id}`;

export function Me({ ctl, onLeave }: { ctl: Ctl; onLeave(): void }) {
  const { s, role, ref } = ctl;
  const me = role ? s.players[role] : undefined;
  const [st, setSt] = useState<Settings>(settings.get());
  const [topic, setTopic] = useState(s.ntfy ?? '');
  const [name, setName] = useState(me?.name ?? '');
  const set = (p: Partial<Settings>) => {
    settings.set(p);
    setSt(settings.get());
  };
  if (!role || !me) return null;
  const lp = levelProgress(me.xp);
  const tools = TOOLS[role];
  const cos = COSMETICS[role];

  return (
    <div class="screen single">
      <div class="topbar">
        <h1 class="grow">{me.name}</h1>
        <span class="chip" style={{ background: `${ROLE_TINT[role]}66` }}>
          {ROLE_LONG[role]}
        </span>
      </div>

      <div class="card col" style={{ gap: 8 }}>
        <div class="row spread">
          <b>Level {lp.level}</b>
          <span class="label num">
            {lp.level >= 30 ? 'Mentor' : `${lp.into.toLocaleString('en-US')} / ${lp.need.toLocaleString('en-US')} XP`}
          </span>
        </div>
        <div class="bar" style={{ height: 12 }}>
          <i style={{ width: `${lp.pct * 100}%`, background: ROLE_TINT[role] }} />
        </div>
        <span class="label">
          Perfect-puzzle bonus +{Math.min(15, me.perfects)}% (cap 15%) · tools every 3 levels, cosmetics every 5 · level 30 = mentor badge
        </span>
        <div class="row" style={{ gap: 8 }}>
          <div class="field grow">
            <input type="text" value={name} maxLength={20} aria-label="Your name" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </div>
          <Btn small kind="soft" disabled={!name.trim() || name === me.name} onClick={() => ctl.dispatch({ t: 'rename', role, name: name.trim() })}>
            Rename
          </Btn>
        </div>
      </div>

      <div class="card col" style={{ gap: 6 }}>
        <h3>Tools</h3>
        {tools.map((t) => {
          const got = lp.level >= t.level;
          return (
            <div class="row" key={t.id} style={{ opacity: got ? 1 : 0.55 }}>
              <span style={{ color: got ? C.palm : C.inkSoft }}>
                <Icon name={got ? 'check' : 'clock'} size={18} />
              </span>
              <span class="grow">
                <b>{t.name}</b> <span class="label">· L{t.level}</span>
                <div class="label">{t.effect}</div>
              </span>
            </div>
          );
        })}
      </div>

      <div class="card col" style={{ gap: 6 }}>
        <h3>Personal bests</h3>
        {Object.values(PUZZLES)
          .filter((d) => d.role === role || me.best?.[d.id] !== undefined)
          .map((d) => {
            const b = me.best?.[d.id];
            return (
              <div class="row spread" key={d.id}>
                <span>
                  {d.title} {d.role !== role && <span class="label">· {ROLE_LABEL[d.role]}</span>}
                </span>
                <b class="num" style={{ color: b !== undefined && b >= 0.95 ? C.palm : undefined }}>
                  {b === undefined ? '—' : `${Math.round(b * 100)}${b >= 0.95 ? ' ★' : ''}`}
                </b>
              </div>
            );
          })}
        <span class="label">No leaderboard inside the island: compete on skill in the weekly challenge (Board).</span>
      </div>

      <div class="card col" style={{ gap: 8 }}>
        <h3>Your zone</h3>
        <div class="row wrap" style={{ gap: 10 }}>
          {cos.map((c) => {
            const got = lp.level >= c.level;
            const on = me.cosmetic === c.id;
            return (
              <button
                key={c.id}
                aria-label={`${c.name}${got ? '' : `, unlocks at level ${c.level}`}`}
                disabled={!got}
                onClick={() => ctl.dispatch({ t: 'cosmetic', role, id: c.id })}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  border: on ? `3px solid ${C.ink}` : '3px solid transparent',
                  background: c.color,
                  opacity: got ? 1 : 0.3,
                  position: 'relative',
                }}
              >
                {!got && <span style={{ fontSize: 11, fontWeight: 800 }}>L{c.level}</span>}
              </button>
            );
          })}
        </div>
        <span class="label">Visible to your crew on the island.</span>
      </div>

      <Devices ctl={ctl} />

      <div class="card col" style={{ gap: 8 }}>
        <h3>Notifications</h3>
        <span class="label">
          Free push via the ntfy app (iOS/Android/desktop): subscribe to the same topic on each device. Pings when someone ends a turn, when a week resolves, and
          on counter-offers. Quiet hours 22:00–08:00.
        </span>
        <div class="row" style={{ gap: 8 }}>
          <div class="field grow">
            <input type="text" value={topic} placeholder="e.g. island-7qk2-crew" aria-label="ntfy topic" onInput={(e) => setTopic((e.target as HTMLInputElement).value)} />
          </div>
          <Btn small kind="soft" onClick={() => ctl.dispatch({ t: 'setNtfy', topic }).then((ok) => ok && toast('Saved for the whole crew'))}>
            Save
          </Btn>
        </div>
        {!topic && (
          <Btn small kind="ghost" onClick={() => setTopic(`island-${s.id}`)}>
            Suggest a topic
          </Btn>
        )}
      </div>

      <div class="card col" style={{ gap: 4 }}>
        <h3>Settings</h3>
        <Toggle label="Haptics" value={st.haptics} onChange={(v) => set({ haptics: v })} />
        <Toggle label="Sound" value={st.sound} onChange={(v) => set({ sound: v })} hint="Respects the silent switch" />
        <Toggle label="Reduce motion" value={st.reduceMotion} onChange={(v) => set({ reduceMotion: v })} hint="Fades instead of flights" />
        <Toggle label="Left-handed layout" value={st.leftHanded} onChange={(v) => set({ leftHanded: v })} />
        <Toggle label="Longer puzzle timers (+50%)" value={st.timerBoost} onChange={(v) => set({ timerBoost: v })} hint="No score penalty" />
      </div>

      <div class="card col" style={{ gap: 8 }}>
        <h3>This device</h3>
        <span class="label">
          {ref.mode === 'firebase' ? 'Online: progress lives on the server and follows your seat to every linked device.' : 'Stored on this device only.'}
        </span>
        <Btn
          kind="ghost"
          small
          onClick={() => {
            if (!confirm(`Remove ${s.name} from this device?${ref.mode === 'local' ? ' The island is only stored here and will be deleted.' : ' It stays on the server.'}`)) return;
            if (ref.mode === 'local') deleteLocal(s.id);
            sessions.remove(s.id);
            onLeave();
          }}
        >
          Leave island on this device
        </Btn>
      </div>
    </div>
  );
}

function Devices({ ctl }: { ctl: Ctl }) {
  const { s, role, ref } = ctl;
  const me = role ? s.players[role] : undefined;
  const [moving, setMoving] = useState(false);
  const [claim, setClaim] = useState<Role>(ref.role);
  if (!role || !me) return null;
  const url = inviteUrl(s.id);
  const open = ROLES.filter((r) => !s.players[r]);

  if (ref.passAndPlay) {
    return (
      <div class="card col" style={{ gap: 8 }}>
        <h3>Pass and play</h3>
        <span class="label">All three seats live on this device. Switch seats from the top bar.</span>
        {onlineAvailable() ? (
          <>
            <b style={{ marginTop: 6 }}>Move this island online</b>
            <span class="label">
              Carries every week, level and asset to the server. You keep one seat here; friends claim the other two with the invite link on their phones or computers.
            </span>
            <Seg<Role> value={claim} onChange={setClaim} options={ROLES.map((r) => ({ v: r, label: ROLE_LABEL[r] }))} />
            <Btn
              disabled={moving}
              onClick={async () => {
                setMoving(true);
                try {
                  await firebaseStore.migrate(s);
                  const uid = await firebaseStore.uid();
                  const r = await firebaseStore.dispatch(s.id, { t: 'join', uid, name: s.players[claim]?.name ?? ROLE_LABEL[claim], role: claim });
                  if (r.error) throw new Error(r.error);
                  sessions.upsert({ id: s.id, name: s.name, mode: 'firebase', role: claim, passAndPlay: false });
                  deleteLocal(s.id);
                  toast('Island moved online. Share the invite link.');
                  location.hash = `#/i/${s.id}`;
                  location.reload();
                } catch (e) {
                  toast(String((e as Error).message ?? e));
                  setMoving(false);
                }
              }}
            >
              {moving ? 'Moving…' : `Move online as ${ROLE_LABEL[claim]}`}
            </Btn>
          </>
        ) : (
          <span class="label">To play across phones and computers, add the free Firebase config (see the start screen → Online setup).</span>
        )}
      </div>
    );
  }

  return (
    <div class="card col" style={{ gap: 8 }}>
      <h3>Crew and devices</h3>
      <div class="row spread">
        <span class="col" style={{ gap: 0 }}>
          <span class="label">Island code</span>
          <b class="code">{s.id}</b>
        </span>
        <Btn small kind="soft" onClick={() => shareText(s.name, `Join ${s.name} on Island Company${open.length ? ` — ${open.map((r) => ROLE_LABEL[r]).join(' or ')} seat open` : ''}.`, url)}>
          <Icon name="share" size={16} /> Invite
        </Btn>
      </div>
      <div class="divider" />
      <b>Play this seat on another device</b>
      <span class="label">
        On your computer or another phone: open the game, choose “Join with a code”, enter the island code, pick {ROLE_LABEL[role]} and this seat code. Progress carries over
        through the server.
      </span>
      <div class="row spread">
        <span class="col" style={{ gap: 0 }}>
          <span class="label">Seat code (keep it to yourself)</span>
          <b class="code" style={{ letterSpacing: '0.15em' }}>
            {me.seatKey}
          </b>
        </span>
        <Btn
          small
          kind="soft"
          onClick={() => {
            fx.tap();
            void navigator.clipboard?.writeText(`${url} seat ${me.seatKey}`).then(() => toast('Copied'));
          }}
        >
          Copy
        </Btn>
      </div>
      <span class="label num">
        Linked devices: {1 + (me.devices?.length ?? 0)} · island value {usd(s.cash)}
      </span>
      <div class="divider" />
      <b>Crew seat codes</b>
      <span class="label">If a crewmate's phone loses its sign-in, read them their code so they can relink (Join with a code → their seat → code).</span>
      {ROLES.filter((r) => r !== role && s.players[r]).map((r) => (
        <div class="row spread" key={r}>
          <span class="label">
            {s.players[r]!.name} · {ROLE_LABEL[r]}
          </span>
          <b class="code num" style={{ letterSpacing: '0.12em' }}>
            {s.players[r]!.seatKey}
          </b>
        </div>
      ))}
      {ROLES.some((r) => s.players[r]?.uid.startsWith(PP_UID.mech.slice(0, 3))) && (
        <span class="label">Unclaimed pass-and-play seats: anyone joining with the invite link can take them over, progress intact.</span>
      )}
    </div>
  );
}
