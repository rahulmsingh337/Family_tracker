'use client';
import { useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';

export default function Auth() {
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e) {
    e.preventDefault();
    setMsg('');
    try {
      if (mode === 'in') await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (x) {
      setMsg((x.code || x.message).replace('auth/', '').replace(/-/g, ' '));
    }
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
