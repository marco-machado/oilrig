import { type MeResponse, DisplayName, Password, Username } from '@oilrig/shared';
import { AuthError, auth } from './net/auth.ts';
import { brandMark, button, el, field, input, setButton } from './ui/components/index.ts';
import { COORDS } from './ui/coords.ts';
import './ui/components.css';
import './ui/screens.css';
import './signup.css';

// /signup: create an account. Only open while the server's ALLOW_SIGNUPS is "true";
// otherwise the page says so (and the server refuses sign-ups either way).

const root = document.getElementById('signup')!;
const card = el('div', { class: 'oh-signup__card oh-glass oh-glass--strong' });
const back = (text: string, label: string) => el('p', { class: 'oh-signup__foot' }, `${text} `, el('a', { class: 'oh-link', href: '/' }, label));
root.append(
  el(
    'div',
    { class: 'oh-signup' },
    el('div', { class: 'oh-signup__brand' }, brandMark(40), el('span', { class: 'oh-eyebrow' }, COORDS)),
    el('h1', { class: 'oh-wordmark' }, 'Oilrig'),
    el('p', { class: 'oh-signup__tagline' }, 'Create an account to come aboard.'),
    card,
  ),
);

function closed() {
  card.replaceChildren(el('p', { class: 'oh-signup__note' }, 'Sign-ups are closed.'), back('', 'Back to sign in'));
}

function signedIn(name: string) {
  card.replaceChildren(el('p', { class: 'oh-signup__note' }, 'You are signed in as ', el('b', {}, name), '.'), back('', 'Come aboard'));
}

function form() {
  const username = input({ type: 'text', name: 'username', maxlength: '24', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
  const displayName = input({ type: 'text', name: 'display-name', maxlength: '24', autocomplete: 'nickname' });
  const password = input({ type: 'password', name: 'password', maxlength: '256', autocomplete: 'new-password' });
  const again = input({ type: 'password', name: 'password-again', maxlength: '256', autocomplete: 'new-password' });
  const submit = button({ label: 'Create account', variant: 'primary', size: 'lg', block: true, trail: 'arrow', type: 'submit' });
  const status = el('p', { class: 'oh-join__status', role: 'status' });
  const f = el(
    'form',
    { class: 'oh-join__fields', novalidate: '' },
    field('Username', username, 'a-z, 0-9, _ and -'),
    field('Display name', displayName, 'Shown above your avatar'),
    field('Password', password, 'At least 8 characters'),
    field('Password again', again),
    submit,
    status,
  );
  const fail = (message: string, at?: HTMLInputElement) => {
    status.textContent = message;
    status.classList.add('is-error');
    if (at) {
      at.setAttribute('aria-invalid', 'true');
      at.focus();
    }
  };
  for (const i of [username, displayName, password, again]) i.addEventListener('input', () => i.removeAttribute('aria-invalid'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    const u = Username.safeParse(username.value);
    if (!u.success) return fail(u.error.issues[0].message, username);
    const d = DisplayName.safeParse(displayName.value);
    if (!d.success) return fail(d.error.issues[0].message, displayName);
    const p = Password.safeParse(password.value);
    if (!p.success) return fail(p.error.issues[0].message, password);
    if (password.value !== again.value) return fail('The passwords do not match.', again);
    setButton(submit, 'Creating…', { busy: true });
    try {
      await auth.signUp(u.data, d.data, p.data);
      location.assign('/');
    } catch (err) {
      setButton(submit, 'Create account', { trail: 'arrow' });
      if (!(err instanceof AuthError)) return fail('Something went wrong.');
      if (err.code === 'signups-closed') return closed();
      fail(err.message, err.code === 'username-taken' ? username : err.code === 'name-taken' ? displayName : undefined);
    }
  });
  card.replaceChildren(f, back('Already have an account?', 'Sign in'));
  username.focus();
}

let me: MeResponse | null = null;
try {
  me = await auth.me();
} catch {
  card.replaceChildren(el('p', { class: 'oh-signup__note' }, 'The server cannot be reached right now.'), back('', 'Back'));
}
if (me?.user) signedIn(me.user.displayName);
else if (me && !me.signups) closed();
else if (me) form();
