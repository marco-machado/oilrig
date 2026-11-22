import { type Account, type ApiKeyInfo, DisplayName, MAX_KEYS_PER_USER, NET, Password } from '@oilrig/shared';
import { AuthError, auth } from '../net/auth.ts';
import { button, el, field, group, icon, iconButton, input, row, section, setButton, setText, type sheet } from './components/index.ts';

// The Account section of the menu: display name, password, and API keys for AI agents.

const when = (ms: number | null) => (ms === null ? 'never used' : `used ${new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);

/** A one-line status under a form: empty, a note, or an error. */
function status() {
  const e = el('p', { class: 'oh-form-status', role: 'status' });
  return {
    el: e,
    set(text: string, error = false) {
      e.textContent = text;
      e.classList.toggle('is-error', error);
    },
  };
}

const errorText = (err: unknown) => (err instanceof AuthError ? err.message : 'Something went wrong.');

export function buildAccount(s: ReturnType<typeof sheet>, onChanged: (a: Account) => void) {
  let account: Account | null = null;
  s.setEyebrow('Signed in');

  // Display name
  const nameInput = input({ type: 'text', maxlength: String(NET.nameMaxLength), autocomplete: 'nickname', 'aria-label': 'Display name' });
  const nameStatus = status();
  const nameBtn = button({ label: 'Save', variant: 'secondary', type: 'submit' });
  const nameForm = el('form', { class: 'oh-form', novalidate: '' }, field('Display name', nameInput, 'Shown above your avatar and in chat'), el('div', { class: 'oh-form__actions' }, nameBtn), nameStatus.el);
  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parsed = DisplayName.safeParse(nameInput.value);
    if (!parsed.success) return nameStatus.set(parsed.error.issues[0].message, true);
    if (parsed.data === account?.displayName) return nameStatus.set('That is already your name.');
    setButton(nameBtn, 'Saving…', { busy: true });
    try {
      const { user } = await auth.rename(parsed.data);
      account = user;
      nameInput.value = user.displayName;
      nameStatus.set('Saved. Everyone aboard sees the new name.');
      onChanged(user);
    } catch (err) {
      nameStatus.set(errorText(err), true);
    } finally {
      setButton(nameBtn, 'Save');
    }
  });

  // Password
  const current = input({ type: 'password', autocomplete: 'current-password', 'aria-label': 'Current password' });
  const next = input({ type: 'password', autocomplete: 'new-password', 'aria-label': 'New password' });
  const again = input({ type: 'password', autocomplete: 'new-password', 'aria-label': 'New password again' });
  const pwStatus = status();
  const pwBtn = button({ label: 'Change password', variant: 'secondary', type: 'submit' });
  const pwForm = el(
    'form',
    { class: 'oh-form', novalidate: '' },
    field('Current password', current),
    field('New password', next, 'At least 8 characters'),
    field('New password again', again),
    el('div', { class: 'oh-form__actions' }, pwBtn),
    pwStatus.el,
  );
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parsed = Password.safeParse(next.value);
    if (!parsed.success) return pwStatus.set(parsed.error.issues[0].message, true);
    if (next.value !== again.value) return pwStatus.set('The new passwords do not match.', true);
    setButton(pwBtn, 'Changing…', { busy: true });
    try {
      await auth.changePassword(current.value, next.value);
      current.value = next.value = again.value = '';
      pwStatus.set('Changed. Other browsers and devices were signed out.');
    } catch (err) {
      pwStatus.set(errorText(err), true);
    } finally {
      setButton(pwBtn, 'Change password');
    }
  });

  // API keys
  const keyList = el('div', { class: 'oh-group' });
  const keyName = input({ type: 'text', maxlength: '40', placeholder: 'What it is for', 'aria-label': 'Key name' });
  const keyBtn = button({ label: 'Create key', variant: 'secondary', icon: 'key', type: 'submit' });
  const keyStatus = status();
  const reveal = el('div', { class: 'oh-keybox' });
  reveal.hidden = true;
  const keyForm = el('form', { class: 'oh-form oh-form--inline', novalidate: '' }, keyName, keyBtn);
  let keys: ApiKeyInfo[] = [];

  const renderKeys = () => {
    keyList.replaceChildren(
      ...(keys.length
        ? keys.map((k) =>
            row(
              k.name,
              `${k.prefix}… · ${when(k.lastUsed)}`,
              iconButton('trash', `Revoke ${k.name}`, async () => {
                if (!confirm(`Revoke "${k.name}"? Agents using it lose access and its avatars leave.`)) return;
                try {
                  await auth.revokeKey(k.id);
                  keyStatus.set(`Revoked "${k.name}".`);
                  await loadKeys();
                } catch (err) {
                  keyStatus.set(errorText(err), true);
                }
              }),
            ),
          )
        : [el('div', { class: 'oh-row' }, el('div', { class: 'oh-row__desc' }, 'No keys yet.'))]),
    );
    keyForm.hidden = keys.length >= MAX_KEYS_PER_USER;
  };

  const loadKeys = async () => {
    try {
      keys = (await auth.keys()).keys;
      renderKeys();
    } catch (err) {
      keyStatus.set(errorText(err), true);
    }
  };

  keyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = keyName.value.trim();
    if (!name) return keyStatus.set('Name the key first.', true);
    setButton(keyBtn, 'Creating…', { busy: true });
    try {
      const r = await auth.createKey(name);
      keyName.value = '';
      keyStatus.set('');
      const code = el('code', { class: 'oh-keybox__key' }, r.key);
      const copy = button({
        label: 'Copy',
        variant: 'ghost',
        size: 'sm',
        icon: 'copy',
        onClick: () => {
          void navigator.clipboard?.writeText(r.key).then(() => setButton(copy, 'Copied', { icon: 'check' }));
        },
      });
      reveal.replaceChildren(el('p', {}, icon('alert'), `Copy “${r.info.name}” now: it is shown only once.`), el('div', { class: 'oh-keybox__row' }, code, copy));
      reveal.hidden = false;
      await loadKeys();
    } catch (err) {
      keyStatus.set(errorText(err), true);
    } finally {
      setButton(keyBtn, 'Create key', { icon: 'key' });
    }
  });

  const who = el('p', { class: 'oh-caption' });
  s.body.append(
    section('Profile', who, group(el('div', { class: 'oh-row oh-row--stack' }, nameForm))),
    section('Password', group(el('div', { class: 'oh-row oh-row--stack' }, pwForm))),
    section(
      'API keys',
      el('p', { class: 'oh-caption' }, `Let AI agents come aboard through the REST API (/api/v1) or MCP (/mcp). Up to ${MAX_KEYS_PER_USER} keys; revoking one sends its avatars away.`),
      keyList,
      keyForm,
      reveal,
      keyStatus.el,
    ),
  );

  return {
    setAccount(a: Account | null) {
      account = a;
      if (!a) return;
      setText(who, `Signed in as @${a.username}.`);
      nameInput.value = a.displayName;
    },
    /** When the section opens: fresh key list, cleared messages and passwords. */
    opened() {
      nameStatus.set('');
      pwStatus.set('');
      keyStatus.set('');
      reveal.hidden = true;
      current.value = next.value = again.value = '';
      void loadKeys();
    },
  };
}
