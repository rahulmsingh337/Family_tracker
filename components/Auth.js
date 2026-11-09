'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Auth() {
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e) {
    e.preventDefault();
    setMsg('');
    const creds = { email, password };
    const { data, error } = mode === 'in'
      ? await supabase.auth.signInWithPassword(creds)
      : await supabase.auth.signUp(creds);
    if (error) setMsg(error.message);
    else if (!data.session) setMsg('Check your email to confirm your address, then sign in.');
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{mode === 'in' ? 'Sign in' : 'Create account'}</h2>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" placeholder="Password (min 6 characters)" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button type="submit">{mode === 'in' ? 'Sign in' : 'Create account'}</button>
      {msg && <p className="warn">{msg}</p>}
      <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'No account? Create one' : 'Have an account? Sign in'}
      </button>
    </form>
  );
}
