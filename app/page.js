'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
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
  return 12742000 * Math.asin(Math.sqrt(x)); // metres
};

export default function Home() {
  const session = useSession();
  const uid = session?.user.id;
  const [fams, setFams] = useState(null);
  const [fid, setFid] = useState(null);
  const [members, setMembers] = useState([]);
  const [locs, setLocs] = useState({});
  const [form, setForm] = useState({ family: '', name: '' });
  const [err, setErr] = useState('');
  const [code, setCode] = useState(null);
  const lastSent = useRef(0);
  const lastHist = useRef(null);
  const [trailUser, setTrailUser] = useState(null);
  const [range, setRange] = useState(24);
  const [trail, setTrail] = useState([]);
  const [awake, setAwake] = useState(false);

  const loadFams = useCallback(async () => {
    const { data } = await supabase.from('members')
      .select('family_id,name,families(name,invite_code,owner)').eq('user_id', uid);
    setFams(data || []);
    setFid((cur) => (data?.some((f) => f.family_id === cur) ? cur : data?.[0]?.family_id || null));
  }, [uid]);

  const loadFamily = useCallback(async () => {
    if (!fid) return;
    const { data: ms } = await supabase.from('members').select('user_id,name,sharing').eq('family_id', fid);
    setMembers(ms || []);
    const { data: ls } = await supabase.from('locations').select('*').in('user_id', (ms || []).map((m) => m.user_id));
    setLocs(Object.fromEntries((ls || []).map((l) => [l.user_id, l])));
  }, [fid]);

  useEffect(() => { if (uid) loadFams(); }, [uid, loadFams]);

  useEffect(() => {
    if (!fid) return;
    setCode(null);
    loadFamily();
    const ch = supabase.channel('fam-' + fid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, loadFamily)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `family_id=eq.${fid}` }, loadFamily)
      .subscribe();
    const t = setInterval(loadFamily, 60000); // refreshes "x min ago" + realtime fallback
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, [fid, loadFamily]);

  const sharing = !!members.find((m) => m.user_id === uid)?.sharing;

  // Location push: only while the tab is open and sharing is on.
  useEffect(() => {
    if (!sharing || !uid) return;
    lastSent.current = 0;
    lastHist.current = null;
    const push = (lat, lng, accuracy, source) =>
      supabase.from('locations').upsert({ user_id: uid, lat, lng, accuracy, source, updated_at: new Date().toISOString() });
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
          supabase.from('location_history').insert({ user_id: uid, lat: la, lng: lo, accuracy: ac });
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
    if (!trailUser) { setTrail([]); return; }
    const since = new Date(Date.now() - range * 3600e3).toISOString();
    supabase.from('location_history').select('lat,lng,recorded_at')
      .eq('user_id', trailUser).gte('recorded_at', since).order('recorded_at').limit(2000)
      .then(({ data }) => setTrail(data || []));
  }, [trailUser, range]);

  async function transfer(m) {
    if (!window.confirm(`Make ${m.name} the owner? You will lose owner controls.`)) return;
    const { error } = await supabase.rpc('transfer_ownership', { fid, new_owner: m.user_id });
    if (error) setErr(error.message); else loadFams();
  }

  async function clearHistory() {
    if (!window.confirm('Delete your saved route history?')) return;
    await supabase.from('location_history').delete().eq('user_id', uid);
    setTrail([]);
  }

  async function toggle() {
    const on = !sharing;
    await supabase.from('members').update({ sharing: on }).eq('user_id', uid);
    await loadFamily();
    if (!on) { await supabase.from('locations').delete().eq('user_id', uid); setErr(''); loadFamily(); }
  }

  async function create(e) {
    e.preventDefault();
    const { data, error } = await supabase.rpc('create_family', { family_name: form.family, member_name: form.name });
    if (error) return setErr(error.message);
    setFid(data);
    loadFams();
  }

  async function remove(userId) {
    if (userId === uid) {
      const { error } = await supabase.rpc('leave_family', { fid });
      if (error) return setErr(error.message);
      setFid(null); loadFams();
    } else {
      await supabase.from('members').delete().eq('family_id', fid).eq('user_id', userId);
      loadFamily();
    }
  }

  async function rotate() {
    const { data } = await supabase.rpc('rotate_invite', { fid });
    if (data) setCode(data);
  }

  if (session === undefined) return null;
  if (!session) return <main className="center"><Auth /></main>;
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
          <button type="button" className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </form>
      </main>
    );
  }

  const fam = fams.find((f) => f.family_id === fid)?.families;
  const isOwner = fam?.owner === uid;
  const link = `${window.location.origin}/join/${code || fam?.invite_code}`;
  const points = members.filter((m) => locs[m.user_id]).map((m) => ({ ...locs[m.user_id], name: m.name, me: m.user_id === uid }));

  return (
    <div className="app">
      <aside>
        <h1>{fam?.name}</h1>
        {fams.length > 1 && (
          <select value={fid || ''} onChange={(e) => setFid(e.target.value)}>
            {fams.map((f) => <option key={f.family_id} value={f.family_id}>{f.families.name}</option>)}
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
            const l = locs[m.user_id];
            return (
              <li key={m.user_id}>
                <div>
                  <b>{m.name}{m.user_id === uid ? ' (you)' : ''}</b>
                  <span>{!m.sharing ? 'Not sharing' : !l ? 'Waiting for location…' : `${ago(l.updated_at)} · ${l.source === 'ip' ? 'approximate' : `±${Math.round(l.accuracy)} m`}`}</span>
                </div>
                <div className="acts">
                  {m.sharing && <button className="link" onClick={() => setTrailUser(trailUser === m.user_id ? null : m.user_id)}>{trailUser === m.user_id ? 'Hide trail' : 'Trail'}</button>}
                  {isOwner && m.user_id !== uid && <button className="link" onClick={() => transfer(m)}>Make owner</button>}
                  {(isOwner || m.user_id === uid) && <button className="link" onClick={() => remove(m.user_id)}>{m.user_id === uid ? 'Leave' : 'Remove'}</button>}
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
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        <button className="link" onClick={clearHistory}>Delete my route history</button>
      </aside>
      <section><LiveMap points={points} trail={trail} /></section>
    </div>
  );
}
