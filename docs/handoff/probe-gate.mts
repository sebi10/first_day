// Live probe of the Firestore version gate, for use right after a deploy that bumps
// DOC_VERSION (see HANDOFF.md §6.4 item 10 and docs/DECISIONS.md "Deploy log").
//
// Run it from island-company/ so it resolves the `firebase` package from its node_modules:
//   cp ../docs/handoff/probe-gate.mts .probe-gate.mts
//   OLD_V=2 NEW_V=3 node_modules/.bin/tsx .probe-gate.mts; rm .probe-gate.mts
// In the cloud container, prefix NODE_USE_ENV_PROXY=1. For a dry run against the
// emulators, add PROBE_EMULATOR=<host> FS_PORT=<n> AUTH_PORT=<n> (and, behind a proxy,
// no_grpc_proxy=<host>).
//
// Post-deploy probe of the live Firestore version gate. It writes nothing: each
// attempt is an update (exists precondition) of an island doc that doesn't exist,
// so a write the rules allow still fails as not-found and no doc is created, even
// if the new rules haven't propagated yet. Expect v:OLD_V -> permission-denied
// (old builds are refused) and v:NEW_V -> not-found (the new build passes the rules).
// It also tries to list the islands (a read of at most one): expect permission-denied,
// so island codes can't be enumerated.
// The anonymous user it signs in with is deleted before exiting.
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, deleteUser, getAuth, signInAnonymously } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDocs, initializeFirestore, limit, query, updateDoc } from 'firebase/firestore';

const OLD = Number(process.env.OLD_V ?? 2);
const NEW = Number(process.env.NEW_V ?? 3);
const emu = process.env.PROBE_EMULATOR;
const live = { apiKey: 'AIzaSyBiUcPpgH90USJ3yqF8_ZMec4NZBnqqw88', authDomain: 'islandgame-efc37.firebaseapp.com', projectId: 'islandgame-efc37', appId: '1:6783640049:web:ff8fc71840b4928d792450' };
const app = initializeApp(emu ? { apiKey: 'demo-key', projectId: 'demo-island' } : live, 'probe');
const auth = getAuth(app);
if (emu) connectAuthEmulator(auth, `http://${emu}:${process.env.AUTH_PORT ?? 9099}`, { disableWarnings: true });
const db = initializeFirestore(app, {});
if (emu) connectFirestoreEmulator(db, emu, Number(process.env.FS_PORT ?? 8080));
const user = (await signInAnonymously(auth)).user;
const attempt = async (v: number) => {
  const ref = doc(db, 'islands', 'zzgateprobe' + Math.random().toString(36).slice(2, 8));
  try {
    await updateDoc(ref, { json: '{}', week: 0, updatedAt: Date.now(), v });
    return 'WRITTEN';
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};
const older = await attempt(OLD);
const newer = await attempt(NEW);
const listed = await getDocs(query(collection(db, 'islands'), limit(1))).then(
  (q) => `LISTED ${q.size}`,
  (e) => (e as { code?: string }).code ?? String(e),
);
try { await deleteUser(user); console.log('probe user deleted'); } catch (e) { console.log('user delete failed:', (e as Error).message); }
console.log(`v:${OLD} -> ${older} (want permission-denied)`);
console.log(`v:${NEW} -> ${newer} (want not-found)`);
console.log(`list islands -> ${listed} (want permission-denied)`);
const ok = older === 'permission-denied' && newer === 'not-found' && listed === 'permission-denied';
console.log(ok ? 'GATE LIVE' : 'GATE NOT CONFIRMED');
await deleteApp(app);
process.exit(ok ? 0 : 1);
