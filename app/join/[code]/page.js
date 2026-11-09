'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { useSession } from '../../../lib/useSession';
import Auth from '../../../components/Auth';

export default function Join() {
  const { code } = useParams();
  const router = useRouter();
  const session = useSession();
  const [family, setFamily] = useState(undefined);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.rpc('family_by_code', { code }).then(({ data }) => setFamily(data || null));
  }, [code]);

  async function join(e) {
    e.preventDefault();
    const { error } = await supabase.rpc('join_family', { code, member_name: name });
    if (error) setErr(error.message); else router.push('/');
  }

  if (family === undefined || session === undefined) return null;
  if (family === null) return <main className="center"><div className="card"><h2>Invite not valid</h2><p>Ask the family owner for a new link.</p></div></main>;
  if (!session) return <main className="center"><div><p className="hint center-t">Sign in to join “{family}”</p><Auth /></div></main>;

  return (
    <main className="center">
      <form className="card" onSubmit={join}>
        <h2>Join “{family}”</h2>
        <p>Other members can see your location and your route of the last 7 days only while sharing is switched on. Stopping deletes your last position and hides your route. You can delete your route history at any time.</p>
        <input placeholder="Your name (shown to family)" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit">Join family</button>
        {err && <p className="warn">{err}</p>}
      </form>
    </main>
  );
}
