'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { arrayUnion, doc, getDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useSession } from '../../../lib/useSession';
import Auth from '../../../components/Auth';

export default function Join() {
  const { code } = useParams();
  const router = useRouter();
  const user = useSession();
  const [inv, setInv] = useState(undefined);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'invites', code)).then((s) => setInv(s.exists() ? s.data() : null)).catch(() => setInv(null));
  }, [code, user]);

  async function join(e) {
    e.preventDefault();
    try {
      const b = writeBatch(db);
      b.set(doc(db, 'families', inv.fid, 'members', user.uid), { name, sharing: false, code });
      b.set(doc(db, 'users', user.uid), { families: arrayUnion(inv.fid) }, { merge: true });
      await b.commit();
      router.push('/');
    } catch {
      setErr('Could not join. The invite may have been reset.');
    }
  }

  if (user === undefined) return null;
  if (!user) return <main className="center"><div><p className="hint center-t">Sign in to accept this invite</p><Auth /></div></main>;
  if (inv === undefined) return null;
  if (inv === null) return <main className="center"><div className="card"><h2>Invite not valid</h2><p>Ask the family owner for a new link.</p></div></main>;

  return (
    <main className="center">
      <form className="card" onSubmit={join}>
        <h2>Join “{inv.name}”</h2>
        <p>Other members can see your location and your route of the last 7 days only while sharing is switched on. Stopping deletes your last position and hides your route. You can delete your route history at any time.</p>
        <input placeholder="Your name (shown to family)" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit">Join family</button>
        {err && <p className="warn">{err}</p>}
      </form>
    </main>
  );
}
