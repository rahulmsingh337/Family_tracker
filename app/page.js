'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot,
  orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { useSession } from '../lib/useSession';
import Auth from '../components/Auth';

const LiveMap = dynamic(() => import('../components/LiveMap'), { ssr: false });

const ago = (t) => {
  const s = (Date.now() - new Date(t)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const dist = (a, b) => {
  const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
};
const newCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export default function Home() {
  const user = useSession();
  const uid = user?.uid;
  const [fams, setFams] = useState(null);
  const [fid, setFid] = useState(null);
  const [famDoc, setFamDoc] = useState(null);
  const [members, setMembers] = useState([]);
  const [locs, setLocs] = useState({});
  const [form, setForm] = useState({ family: '', name: '' });
  const [err, setErr] = useState('');
  const [trailUser, setTrailUser] = useState(null);
  const [range, setRange] = useState(24);
  const [trail, setTrail] = useState([]);
  const [awake, setAwake] = useState(false);
  const lastSent = useRef(0);
  const lastHist = useRef(null);
  const famIds = useRef([]);

  const loadFams = useCallback(async () => {
    const u = await getDoc(doc(db, 'users', uid));
    const out = [];
    for (const id of u.exists() ? u.data().families || [] : []) {
      try { const s = await getDoc(doc(db, 'families', id)); if (s.exists()) out.push({ id, name: s.data().name }); } catch {}
    }
    famIds.current = out.map((f) => f.id);
    setFams(out);
    setFid((cur) => (out.some((f) => f.id === cur) ? cur : out[0]?.id || null));
  }, [uid]);

  useEffect(() => { if (uid) loadFams(); }, [uid, loadFams]);

  useEffect(() => {
    if (!fid) return;
    setTrailUser(null);
    const f = doc(db, 'families', fid);
    const off = [
      onSnapshot(f, (s) => setFamDoc(s.exists() ? { id: s.id, ...s.data() } : null), () => loadFams()),
      onSnapshot(collection(f, 'members'), (s) => setMembers(s.docs.map((d) => ({ uid: d.id, ...d.data() }))), () => loadFams()),
      onSnapshot(query(collection(f, 'locs'), where('sharing', '==', true)),
        (s) => setLocs(Object.fromEntries(s.docs.map((d) => [d.id, d.data({ serverTimestamps: 'estimate' })]))), () => {}),
    ];
    const t = setInterval(() => setMembers((m) => [...m]), 60000); // refresh "x min ago"
    return () => { off.forEach((u) => u()); clearInterval(t); };
  }, [fid, loadFams]);

  const sharing = !!members.find((m) => m.uid === uid)?.sharing;

  // Location push: only while the tab is open and sharing is on. Written to every family you belong to.
  useEffect(() => {
    if (!sharing || !uid) return;
    lastSent.current = 0;
    lastHist.current = null;
    const push = (lat, lng, accuracy, source) => famIds.current.forEach((id) =>
      setDoc(doc(db, 'families', id, 'locs', uid), { lat, lng, accuracy, source, sharing: true, updatedAt: serverTimestamp() }).catch(() => {}));
    const fallback = async () => {
      const j = await fetch('/api/ip-location').then((r) => r.json()).catch(() => ({}));
      if (j.lat) { push(j.lat, j.lng, null, 'ip'); setErr('GPS unavailable or denied. Showing an approximate (IP-based) position.'); }
      else setErr('Location is unavailable. Allow location access in your browser settings.');
    };
    if (!navigator.geolocation) { fallback(); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (Date.now() - lastSent.current < 30000) return;
        lastSent.current = Date.now();
        setErr('');
        const { latitude: la, longitude: lo, accuracy: ac } = p.coords;
        push(la, lo, ac, 'gps');
        const h = lastHist.current; // history: one point per 50 m moved or 5 min
        if (!h || Date.now() - h.t > 300000 || dist(h, { lat: la, lng: lo }) > 50) {
          lastHist.current = { lat: la, lng: lo, t: Date.now() };
          famIds.current.forEach((fi) => addDoc(collection(db, 'families', fi, 'locs', uid, 'trail'),
            { lat: la, lng: lo, t: serverTimestamp(), expireAt: Timestamp.fromMillis(Date.now() + 7 * 864e5) }).catch(() => {}));
        }
      },
      fallback,
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [sharing, uid]);

  useEffect(() => {
    if (!sharing || !awake || !('wakeLock' in navigator)) return;
    let lock;
    const get = () => navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    get();
    const vis = () => document.visibilityState === 'visible' && get();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release(); };
  }, [sharing, awake]);

  useEffect(() => {
    if (!trailUser || !fid) { setTrail([]); return; }
    const since = Timestamp.fromMillis(Date.now() - range * 3600e3);
    getDocs(query(collection(db, 'families', fid, 'locs', trailUser, 'trail'), where('t', '>=', since), orderBy('t'), limit(2000)))
      .then((s) => setTrail(s.docs.map((d) => {
        const x = d.data({ serverTimestamps: 'estimate' });
        return { lat: x.lat, lng: x.lng, recorded_at: x.t.toDate().toISOString() };
      })))
      .catch((x) => setErr(x.message));
  }, [trailUser, range, fid]);

  async function toggle() {
    const on = !sharing;
    try {
      await Promise.all(famIds.current.map((id) => updateDoc(doc(db, 'families', id, 'members', uid), { sharing: on })));
      if (!on) { await Promise.all(famIds.current.map((id) => deleteDoc(doc(db, 'families', id, 'locs', uid)))); setErr(''); }
    } catch (x) { setErr(x.message); }
  }

  async function create(e) {
    e.preventDefault();
    try {
      const f = doc(collection(db, 'families'));
      const code = newCode();
      const b = writeBatch(db);
      b.set(f, { name: form.family, owner: uid, inviteCode: code, createdAt: serverTimestamp() });
      b.set(doc(f, 'members', uid), { name: form.name, sharing: false, code });
      b.set(doc(db, 'invites', code), { fid: f.id, name: form.family });
      b.set(doc(db, 'users', uid), { families: arrayUnion(f.id) }, { merge: true });
      await b.commit();
      setFid(f.id);
      loadFams();
    } catch (x) { setErr(x.message); }
  }

  async function transfer(m) {
    if (!window.confirm(`Make ${m.name} the owner? You will lose owner controls.`)) return;
    try { await updateDoc(doc(db, 'families', fid), { owner: m.uid }); } catch (x) { setErr(x.message); }
  }

  async function remove(userId) {
    try {
      const b = writeBatch(db);
      if (userId === uid) {
        if (famDoc.owner === uid) return setErr('Transfer ownership before leaving.');
        b.set(doc(db, 'users', uid), { families: arrayRemove(fid) }, { merge: true });
      }
      b.delete(doc(db, 'families', fid, 'members', userId));
      b.delete(doc(db, 'families', fid, 'locs', userId));
      await b.commit();
      if (userId === uid) { setFid(null); loadFams(); }
    } catch (x) { setErr(x.message); }
  }

  async function rotate() {
    const code = newCode();
    const b = writeBatch(db);
    b.update(doc(db, 'families', fid), { inviteCode: code });
    b.delete(doc(db, 'invites', famDoc.inviteCode));
    b.set(doc(db, 'invites', code), { fid, name: famDoc.name });
    try { await b.commit(); } catch (x) { setErr(x.message); }
  }

  async function clearHistory() {
    if (!window.confirm('Delete your saved route history?')) return;
    for (const f of fams) {
      const s = await getDocs(collection(db, 'families', f.id, 'locs', uid, 'trail'));
      await Promise.all(s.docs.map((d) => deleteDoc(d.ref)));
    }
    setTrail([]);
  }

  if (user === undefined) return null;
  if (!user) return <main className="center"><Auth /></main>;
  if (fams === null) return <main className="center">Loading…</main>;

  if (!fams.length) {
    return (
      <main className="center">
        <form className="card" onSubmit={create}>
          <h2>Create your family</h2>
          <input placeholder="Family name" value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })} required />
          <input placeholder="Your name (shown to family)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <button type="submit">Create family</button>
          {err && <p className="warn">{err}</p>}
          <button type="button" className="link" onClick={() => signOut(auth)}>Sign out</button>
        </form>
      </main>
    );
  }
  if (!famDoc || famDoc.id !== fid) return <main className="center">Loading…</main>;

  const isOwner = famDoc.owner === uid;
  const link = `${window.location.origin}/join/${famDoc.inviteCode}`;
  const points = members.filter((m) => locs[m.uid]).map((m) => ({
    ...locs[m.uid], updated_at: locs[m.uid].updatedAt?.toDate?.(), name: m.name, me: m.uid === uid,
  }));

  return (
    <div className="app">
      <aside>
        <h1>{famDoc.name}</h1>
        {fams.length > 1 && (
          <select value={fid || ''} onChange={(e) => setFid(e.target.value)}>
            {fams.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <button className={sharing ? 'on' : ''} onClick={toggle}>
          {sharing ? 'Sharing your location. Tap to stop' : 'Share my location'}
        </button>
        {sharing && (
          <label className="hint">
            <input type="checkbox" checked={awake} onChange={(e) => setAwake(e.target.checked)} style={{ width: 'auto', marginRight: 8 }} />
            Keep screen on (tab must stay open; uses more battery)
          </label>
        )}
        {err && <p className="warn">{err}</p>}
        <ul>
          {members.map((m) => {
            const l = locs[m.uid];
            return (
              <li key={m.uid}>
                <div>
                  <b>{m.name}{m.uid === uid ? ' (you)' : ''}{m.uid === famDoc.owner ? ' ★' : ''}</b>
                  <span>{!m.sharing ? 'Not sharing' : !l ? 'Waiting for location…' : `${ago(l.updatedAt?.toDate?.() ?? Date.now())} · ${l.source === 'ip' ? 'approximate' : `±${Math.round(l.accuracy)} m`}`}</span>
                </div>
                <div className="acts">
                  {m.sharing && <button className="link" onClick={() => setTrailUser(trailUser === m.uid ? null : m.uid)}>{trailUser === m.uid ? 'Hide trail' : 'Trail'}</button>}
                  {isOwner && m.uid !== uid && <button className="link" onClick={() => transfer(m)}>Make owner</button>}
                  {((isOwner && m.uid !== uid) || (m.uid === uid && !isOwner)) && (
                    <button className="link" onClick={() => remove(m.uid)}>{m.uid === uid ? 'Leave' : 'Remove'}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {trailUser && (
          <div className="row">
            <span className="hint">Trail:</span>
            <select value={range} onChange={(e) => setRange(+e.target.value)}>
              <option value={1}>last hour</option><option value={24}>last 24 h</option><option value={168}>last 7 days</option>
            </select>
            <span className="hint">{trail.length} points</span>
          </div>
        )}
        {isOwner && (
          <div className="invite">
            <p>Invite link. Anyone with it can join, so only send it to family.</p>
            <code>{link}</code>
            <div className="row">
              <button onClick={() => navigator.clipboard.writeText(link)}>Copy link</button>
              <button className="link" onClick={rotate}>Reset link</button>
            </div>
          </div>
        )}
        <button className="link" onClick={() => signOut(auth)}>Sign out</button>
        <button className="link" onClick={clearHistory}>Delete my route history</button>
      </aside>
      <section><LiveMap points={points} trail={trail} /></section>
    </div>
  );
}
