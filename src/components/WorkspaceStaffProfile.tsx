import { Camera, Save, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { api, compressImageFile, imageBlobToDataUrl } from '../lib/api';
import type { StaffMember } from '../lib/types';

export function WorkspaceStaffProfile({
  user,
  onSaved,
}: {
  user: StaffMember;
  onSaved: (user: StaffMember) => void;
}) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [removePhoto, setRemovePhoto] = useState(false);
  const [authType, setAuthType] = useState<'password' | 'pin'>(user.authType ?? 'password');
  const [currentCredential, setCurrentCredential] = useState('');
  const [newCredential, setNewCredential] = useState('');
  const [confirmCredential, setConfirmCredential] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setError('');
    setNotice('');
    try {
      const compressed = await compressImageFile(file);
      if (compressed.blob.size > 1024 * 1024) {
        throw new Error('Choose a smaller photo; profile pictures must be 1MB or less after compression.');
      }
      setPhotoDataUrl(await imageBlobToDataUrl(compressed.blob));
      setRemovePhoto(false);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.saveStaffProfile({
        name,
        phone,
        ...(photoDataUrl ? { photoDataUrl } : {}),
        ...(removePhoto ? { removePhoto: true } : {}),
      });
      onSaved(result.user);
      setPhotoDataUrl('');
      setRemovePhoto(false);
      setNotice('Your profile was updated.');
    } catch (reason) {
      setError((reason as Error).message || 'Your profile could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  async function saveAuthentication(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    if (newCredential !== confirmCredential) {
      setError(authType === 'pin' ? 'The PIN entries do not match.' : 'The passwords do not match.');
      setBusy(false);
      return;
    }
    try {
      const result = await api.saveStaffAuthentication({ currentCredential, authType, newCredential });
      onSaved(result.user);
      setCurrentCredential('');
      setNewCredential('');
      setConfirmCredential('');
      setNotice(`Authentication type changed to ${authType === 'pin' ? 'PIN' : 'Password'}.`);
    } catch (reason) {
      setError((reason as Error).message || 'Authentication settings could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  const photoUrl = photoDataUrl || (!removePhoto ? user.profilePhotoUrl : undefined);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-xs font-semibold tracking-wider text-[#D61F26]">MY ACCOUNT</p>
        <h1 className="mt-1 text-2xl font-bold text-[#081E3E] dark:text-white">Staff profile</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Update your name, phone number, and profile photo. Your sign-in email cannot be changed here.
        </p>
      </header>

      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">{error}</p>}

      <form onSubmit={saveProfile} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200 dark:bg-[#061327] dark:ring-slate-700">
            {photoUrl
              ? <img src={photoUrl} alt={`${name || 'Staff'} profile`} className="h-full w-full object-cover" />
              : <UserRound className="h-10 w-10 text-slate-400" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-600">
              <Camera className="h-4 w-4" />
              Choose photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => {
                  void choosePhoto(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
            {(photoUrl || user.profilePhotoUrl) && (
              <button
                type="button"
                onClick={() => {
                  setPhotoDataUrl('');
                  setRemovePhoto(Boolean(user.profilePhotoUrl));
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-red-700 dark:border-slate-600 dark:text-red-300"
              >
                <X className="h-4 w-4" />
                Remove photo
              </button>
            )}
          </div>
          <p className="w-full text-xs text-slate-500 dark:text-slate-400">JPEG, PNG, or WebP; compressed to JPEG and limited to 1MB.</p>
        </div>

        <label className="block text-sm font-medium">
          Full name
          <input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]" />
        </label>
        <label className="block text-sm font-medium">
          Phone number
          <input type="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]" />
          <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
            Use the required country code if you want to enable WhatsApp consent later. Changing this number withdraws consent saved for the previous number.
          </span>
        </label>
        <label className="block text-sm font-medium">
          Sign-in email
          <input type="email" value={user.email} readOnly aria-readonly="true"
            className="mt-1 w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-500 dark:border-slate-700 dark:bg-[#061327] dark:text-slate-400" />
        </label>
        <button type="submit" disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#081E3E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#D61F26] disabled:opacity-60">
          <Save className="h-4 w-4" />
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      <form onSubmit={saveAuthentication} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
        <div>
          <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">Authentication type</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Choose a password or a six-digit PIN for future sign-ins. Confirm your current credential before changing it.
          </p>
        </div>
        <label className="block text-sm font-medium">
          Sign in with
          <select value={authType} onChange={(event) => setAuthType(event.target.value as 'password' | 'pin')}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-[#061327]">
            <option value="password">Password</option>
            <option value="pin">PIN (6 digits)</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          Current {user.authType === 'pin' ? 'PIN' : 'password'}
          <input required type="password" value={currentCredential}
            inputMode={user.authType === 'pin' ? 'numeric' : 'text'}
            pattern={user.authType === 'pin' ? '[0-9]{6}' : undefined}
            maxLength={user.authType === 'pin' ? 6 : 128}
            autoComplete="current-password"
            onChange={(event) => setCurrentCredential(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]" />
        </label>
        <label className="block text-sm font-medium">
          {authType === 'pin' ? 'New six-digit PIN' : 'New password'}
          <input required type="password" value={newCredential}
            inputMode={authType === 'pin' ? 'numeric' : undefined}
            pattern={authType === 'pin' ? '[0-9]{6}' : undefined}
            minLength={authType === 'pin' ? 6 : 12}
            maxLength={authType === 'pin' ? 6 : 128}
            autoComplete="new-password"
            onChange={(event) => setNewCredential(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]" />
        </label>
        <label className="block text-sm font-medium">
          Confirm new {authType === 'pin' ? 'PIN' : 'password'}
          <input required type="password" value={confirmCredential}
            inputMode={authType === 'pin' ? 'numeric' : undefined}
            pattern={authType === 'pin' ? '[0-9]{6}' : undefined}
            minLength={authType === 'pin' ? 6 : 12}
            maxLength={authType === 'pin' ? 6 : 128}
            autoComplete="new-password"
            onChange={(event) => setConfirmCredential(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]" />
        </label>
        <button type="submit" disabled={busy}
          className="rounded-lg bg-[#081E3E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#D61F26] disabled:opacity-60">
          {busy ? 'Saving…' : 'Update authentication'}
        </button>
      </form>
    </div>
  );
}
