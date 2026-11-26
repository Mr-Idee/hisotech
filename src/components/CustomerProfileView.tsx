import { AlertCircle, Camera, CheckCircle2, Cpu, LogOut, Plus, UserCheck, Wrench } from 'lucide-react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { api, compressImageFile, imageBlobToDataUrl } from '../lib/api';
import { listenForCustomerLogout, notifyCustomerLogoutAcrossTabs } from '../lib/auth-sync';
import type {
  CustomerEquipment,
  CustomerProfile,
  ServiceTicket,
  TicketCategory,
} from '../lib/types';
import { PushSubscriptionControl } from './PushSubscriptionControl';

export function CustomerProfileView() {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [equipment, setEquipment] = useState<CustomerEquipment[]>([]);
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [sessionBusy, setSessionBusy] = useState(true);

  // Sign-in and first-use password setup state
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPin, setAuthPin] = useState('');
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'setup' | 'link'>('login');
  const [authBusy, setAuthBusy] = useState(false);

  // Profile Edit state
  const [profName, setProfName] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profLocation, setProfLocation] = useState('');
  const [profCompany, setProfCompany] = useState('');
  const [profRef, setProfRef] = useState('');
  const [emailMarketingConsent, setEmailMarketingConsent] = useState(false);
  const [whatsappMarketingConsent, setWhatsappMarketingConsent] = useState(false);
  const [whatsappUpdatesConsent, setWhatsappUpdatesConsent] = useState(false);

  // Equipment Add state
  const [eqType, setEqType] = useState('Hybrid Inverter');
  const [eqBrand, setEqBrand] = useState('');
  const [eqSerial, setEqSerial] = useState('');
  const [eqKw, setEqKw] = useState('');
  const [eqDate, setEqDate] = useState(new Date().toISOString().slice(0, 10));
  const [eqNotes, setEqNotes] = useState('');
  const [eqPhotos, setEqPhotos] = useState<{ name: string; dataUrl: string }[]>([]);

  // Service Request / Complaint state
  const [tktEqId, setTktEqId] = useState('');
  const [tktCategory, setTktCategory] = useState<TicketCategory>('Complaint');
  const [tktPriority, setTktPriority] = useState<'Normal' | 'Urgent'>('Normal');
  const [tktSubject, setTktSubject] = useState('');
  const [tktDesc, setTktDesc] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function syncState(data: {
    profile: CustomerProfile;
    equipment: CustomerEquipment[];
    tickets: ServiceTicket[];
  }) {
    setProfile(data.profile);
    setEquipment(data.equipment);
    setTickets(data.tickets);
    setEmailMarketingConsent(Boolean(data.profile.emailMarketingConsent));
    setWhatsappMarketingConsent(Boolean(data.profile.whatsappMarketingConsent));
    setWhatsappUpdatesConsent(Boolean(data.profile.whatsappUpdatesConsent));
    setProfName(data.profile.name);
    setProfPhone(data.profile.phone);
    setProfLocation(data.profile.location);
    setProfCompany(data.profile.company);
    setProfRef(data.profile.refCode);
  }

  function clearCustomerSession(message: string) {
    setProfile(null);
    setEquipment([]);
    setTickets([]);
    setSessionBusy(false);
    setError(message);
    setNotice('');
  }

  useEffect(() => listenForCustomerLogout(() => {
    clearCustomerSession('You were signed out in another tab. Please sign in again to continue.');
  }), []);

  useLayoutEffect(() => {
    let active = true;
    const hash = window.location.hash;
    const queryIndex = hash.indexOf('?');
    const token = queryIndex >= 0
      ? new URLSearchParams(hash.slice(queryIndex + 1)).get('token')
      : null;
    if (token) {
      window.history.replaceState(null, '', '#customer');
    }

    const restoreSession = token
      ? api.verifyCustomerLoginLink(token).then((res) => {
          if (active) syncState(res);
        })
      : api.customerSession().then((res) => {
          if (active && res.authenticated && res.profile) {
            syncState({ profile: res.profile, equipment: res.equipment, tickets: res.tickets });
          }
        });

    restoreSession
      .catch((err) => {
        if (active) {
          setError((err as Error).message);
        }
      })
      .finally(() => {
        if (active) setSessionBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setAuthBusy(true);
    try {
      syncState(await api.loginCustomer(authEmail, authPassword));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handlePasswordSetup(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (authPassword !== authPasswordConfirm) {
      setError('The passwords do not match.');
      return;
    }
    setAuthBusy(true);
    try {
      await api.setupCustomerPassword(authEmail, authPin, authPassword);
      setAuthMode('login');
      setAuthPin('');
      setAuthPassword('');
      setAuthPasswordConfirm('');
      setNotice('Password created. You can now sign in to your customer portal.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await api.saveCustomerProfile({
        name: profName,
        phone: profPhone,
        location: profLocation,
        company: profCompany,
        refCode: profRef,
      });
      setProfile(res.profile);
      setEmailMarketingConsent(Boolean(res.profile.emailMarketingConsent));
      setWhatsappMarketingConsent(Boolean(res.profile.whatsappMarketingConsent));
      setWhatsappUpdatesConsent(Boolean(res.profile.whatsappUpdatesConsent));
      setNotice('Customer profile details updated.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoginLink(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setAuthBusy(true);
    try {
      const result = await api.requestCustomerLoginLink({ email: authEmail });
      setNotice(result.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSaveConsents(e: React.FormEvent) {
      e.preventDefault();
      setError('');
      setNotice('');
      setBusy(true);
      try {
        const result = await api.saveCustomerMarketingConsent({
          email: emailMarketingConsent,
          whatsapp: whatsappMarketingConsent,
          whatsappUpdates: whatsappUpdatesConsent,
        });
        setProfile((current) => current ? {
          ...current,
          emailMarketingConsent: result.emailMarketingConsent,
          whatsappMarketingConsent: result.whatsappMarketingConsent,
          whatsappUpdatesConsent: result.whatsappUpdatesConsent,
        } : current);
        setNotice('Your marketing communication preferences were saved.');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
    }
  }

  async function handleAddEquipment(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await api.saveCustomerEquipment({
        equipmentType: eqType,
        brandModel: eqBrand,
        serialNumber: eqSerial,
        capacityKw: eqKw,
        installDate: eqDate,
        notes: eqNotes,
        photos: eqPhotos,
      });
      setEquipment(res.equipment);
      setEqBrand('');
      setEqSerial('');
      setEqKw('');
      setEqNotes('');
      setEqPhotos([]);
      setNotice('Installed solar equipment registered to your profile.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await api.submitCustomerTicket({
        equipmentId: tktEqId || null,
        category: tktCategory,
        priority: tktPriority,
        subject: tktSubject,
        description: tktDesc,
      });
      setTickets(res.tickets);
      setTktSubject('');
      setTktDesc('');
      setNotice(`Ticket ${res.ticketCode} sent to HI-SOTECH Help Desk & Admin team.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-[#0B1D39]">
          <p className="text-xs font-semibold tracking-wider text-[#D61F26]">CUSTOMER CARE &amp; EQUIPMENT PORTAL</p>
          <h1 className="mt-1 text-2xl font-bold text-[#081E3E] dark:text-white">
            Customer Portal Sign In
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Customer portal accounts are created by HI-SOTECH Admin after quotation approval. First-time users set a password with the one-time PIN sent to their email.
          </p>

          {sessionBusy && (
            <p className="mt-4 text-sm text-slate-500" role="status">Checking your secure customer session…</p>
          )}
          {error && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/80 dark:text-rose-100">
              {error}
            </p>
          )}
          {notice && (
            <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200" role="status">
              {notice}
            </p>
          )}

          <form
            onSubmit={authMode === 'login' ? handleAuth : authMode === 'setup' ? handlePasswordSetup : handleLoginLink}
            className="mt-6 space-y-4 text-sm"
          >
            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Customer Email</span>
              <input
                type="email"
                required
                value={authEmail}
                maxLength={254}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@domain.com"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-[#061327]"
              />
            </label>
            {authMode === 'setup' ? (
              <>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Four-digit setup PIN</span>
                  <input
                    type="text"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    value={authPin}
                    onChange={(e) => setAuthPin(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm tracking-[0.3em] dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">New password (at least 12 characters)</span>
                  <input
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Confirm new password</span>
                  <input
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    value={authPasswordConfirm}
                    onChange={(e) => setAuthPasswordConfirm(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
              </>
            ) : authMode === 'login' ? (
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Password</span>
                <input
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
            ) : null}
            <button
              type="submit"
              disabled={authBusy || sessionBusy}
              className="inline-flex items-center gap-2 rounded-lg bg-[#081E3E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#D61F26]"
            >
              <UserCheck className="h-4 w-4" />
              {authBusy ? 'Please wait...' : authMode === 'setup' ? 'Create Password' : authMode === 'link' ? 'Email Sign-In Link' : 'Sign In'}
            </button>
            <div className="flex flex-wrap gap-4">
              {authMode === 'login' ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setNotice('');
                      setAuthMode('setup');
                      setAuthPassword('');
                    }}
                    className="text-xs font-semibold text-[#D61F26] underline underline-offset-2"
                  >
                    First time? Set up password with PIN
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError('');
                      setNotice('');
                      setAuthMode('link');
                    }}
                    className="text-xs font-semibold text-[#D61F26] underline underline-offset-2"
                  >
                    Use a one-time email link
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setNotice('');
                    setAuthMode('login');
                    setAuthPassword('');
                    setAuthPin('');
                    setAuthPasswordConfirm('');
                  }}
                  className="text-xs font-semibold text-[#D61F26] underline underline-offset-2"
                >
                  Return to sign in
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6 dark:border-slate-800">
        <div>
          <p className="text-xs font-semibold tracking-wider text-[#D61F26]">CUSTOMER PROFILE &amp; HELP DESK</p>
          <h1 className="mt-1 text-2xl font-bold text-[#081E3E] dark:text-white">
            {profile.name} · {profile.location || 'Site Profile'}
          </h1>
          <p className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
            {profile.email} {profile.refCode ? `· Ref ${profile.refCode}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await api.customerLogout();
              const notified = notifyCustomerLogoutAcrossTabs();
              clearCustomerSession(notified ? '' : 'You are signed out here, but other tabs could not be notified. Refresh them before continuing.');
            } catch (err) {
              setError((err as Error).message);
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:border-[#D61F26] dark:border-slate-700 dark:text-slate-200"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </button>
      </div>

      {notice && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          {notice}
        </div>
      )}
      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/80 dark:text-rose-100">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-12">
        {/* Left column: Profile Details + Installed Equipment Registry */}
        <div className="min-w-0 space-y-6 lg:col-span-5">
          <form
            onSubmit={handleSaveProfile}
            className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">Profile &amp; Site Information</h2>
            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Customer Name *</span>
                <input
                  type="text"
                  required
                  value={profName}
                  onChange={(e) => setProfName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">WhatsApp Number</span>
                  <input
                    type="tel"
                    value={profPhone}
                    onChange={(e) => setProfPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">HISO Reference</span>
                  <input
                    type="text"
                    value={profRef}
                    onChange={(e) => setProfRef(e.target.value)}
                    placeholder="e.g. HISO-1024"
                    className="font-mono-num mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Company / Household</span>
                <input
                  type="text"
                  value={profCompany}
                  onChange={(e) => setProfCompany(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Site Address</span>
                <input
                  type="text"
                  value={profLocation}
                  onChange={(e) => setProfLocation(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="mt-4 w-full rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26]"
            >
              Update Profile Information
            </button>
          </form>

          <form onSubmit={handleSaveConsents}
            className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">Optional marketing preferences</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              These choices are optional and separate. You can withdraw consent at any time.
            </p>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={emailMarketingConsent}
                onChange={(event) => setEmailMarketingConsent(event.target.checked)} className="mt-0.5" />
              <span>I explicitly agree to receive HI-SOTECH newsletters and promotional emails at {profile.email}.</span>
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={whatsappMarketingConsent}
                onChange={(event) => setWhatsappMarketingConsent(event.target.checked)} className="mt-0.5" />
              <span>I explicitly agree to receive HI-SOTECH marketing messages on WhatsApp at {profile.phone || 'my saved phone number'}.</span>
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={whatsappUpdatesConsent}
                onChange={(event) => setWhatsappUpdatesConsent(event.target.checked)} className="mt-0.5" />
              <span>I separately agree to receive service updates about my enquiries, quotations, invoices, tickets, and installations on WhatsApp.</span>
            </label>
            <button type="submit" disabled={busy}
              className="mt-4 rounded-lg border border-[#081E3E] px-4 py-2 text-xs font-semibold text-[#081E3E] hover:bg-[#081E3E] hover:text-white dark:border-slate-600 dark:text-white disabled:opacity-60">
              Save marketing preferences
            </button>
          </form>

          <PushSubscriptionControl />

          {/* Registered Solar Equipment */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-[#D61F26]" />
              <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">Installed Equipment Registry</h2>
            </div>

            <div className="mt-4 space-y-2.5">
              {equipment.length === 0 ? (
                <p className="text-xs text-slate-500">No solar equipment logged yet. Add your inverter or battery below.</p>
              ) : (
                equipment.map((eq) => (
                  <div
                    key={eq.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-[#061327]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#081E3E] dark:text-white">{eq.brandModel}</span>
                      <span className="font-mono-num text-[#D61F26]">{eq.capacityKw || eq.equipmentType}</span>
                    </div>
                    <div className="font-mono-num mt-1 text-slate-500 dark:text-slate-400">
                      {eq.equipmentType} · SN: {eq.serialNumber || 'Unrecorded'} · Installed {eq.installDate}
                    </div>
                    {eq.notes && <p className="mt-1 text-slate-600 dark:text-slate-300">{eq.notes}</p>}
                    {eq.photos?.length > 0 && (
                      <div className="mt-2 grid grid-cols-4 gap-2">
                        {eq.photos.map((photo) => (
                          <a
                            key={photo.id}
                            href={photo.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block aspect-square overflow-hidden rounded border border-slate-200 bg-slate-100 dark:border-slate-700"
                            title={photo.originalName}
                          >
                            <img src={photo.fileUrl} alt={photo.originalName} className="h-full w-full object-cover" loading="lazy" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleAddEquipment} className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
              <div className="font-semibold text-[#081E3E] dark:text-white">Register New Equipment</div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <select
                  value={eqType}
                  onChange={(e) => setEqType(e.target.value)}
                  className="w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  <option>Hybrid Inverter</option>
                  <option>Lithium Battery Bank</option>
                  <option>Solar PV Array</option>
                  <option>Charge Controller / MPPT</option>
                  <option>Surge / BOS Panel</option>
                </select>
                <input
                  type="text"
                  required
                  value={eqBrand}
                  onChange={(e) => setEqBrand(e.target.value)}
                  placeholder="Brand & Model *"
                  className="w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
                <input
                  type="text"
                  value={eqSerial}
                  onChange={(e) => setEqSerial(e.target.value)}
                  placeholder="Serial Number"
                  className="font-mono-num w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
                <input
                  type="text"
                  value={eqKw}
                  onChange={(e) => setEqKw(e.target.value)}
                  placeholder="Capacity (e.g. 5kW)"
                  className="font-mono-num w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </div>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-slate-600 hover:border-[#D61F26] hover:text-[#D61F26] dark:border-slate-700 dark:text-slate-300">
                <Camera className="h-4 w-4" />
                <span>{eqPhotos.length ? `${eqPhotos.length} equipment photo(s) ready` : 'Add equipment photos (JPEG, PNG, or WebP)'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  onChange={async (event) => {
                    const files = Array.from(event.target.files || []).slice(0, 4);
                    setError('');
                    try {
                      const selected = await Promise.all(files.map(async (file) => {
                        const compressed = await compressImageFile(file);
                        return { name: compressed.name, dataUrl: await imageBlobToDataUrl(compressed.blob) };
                      }));
                      setEqPhotos(selected);
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                />
              </label>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <input
                  type="date"
                  value={eqDate}
                  onChange={(e) => setEqDate(e.target.value)}
                  className="w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
                <input
                  type="text"
                  value={eqNotes}
                  onChange={(e) => setEqNotes(e.target.value)}
                  placeholder="Site bay / notes"
                  className="w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#081E3E] px-3 py-2 font-semibold text-[#081E3E] hover:bg-[#081E3E] hover:text-white dark:border-slate-600 dark:text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Equipment to Profile
              </button>
            </form>
          </div>
        </div>

        {/* Right column: Submit Service Request / Complaint + Active Ticket History */}
        <div className="min-w-0 space-y-6 lg:col-span-7">
          <form
            onSubmit={handleSubmitTicket}
            className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-[#D61F26]" />
              <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">
                Request Service or Lodge Complaint (Direct to Help Desk / Admin)
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Every ticket notifies HI-SOTECH Admin &amp; Help Desk staff immediately for technician assignment.
            </p>

            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Request Type</span>
                <select
                  value={tktCategory}
                  onChange={(e) => setTktCategory(e.target.value as TicketCategory)}
                  className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  <option value="Complaint">Complaint</option>
                  <option value="Service Request">Service Request</option>
                  <option value="Warranty Claim">Warranty Claim</option>
                  <option value="Preventive Maintenance">Preventive Maintenance</option>
                </select>
              </label>

              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Priority</span>
                <select
                  value={tktPriority}
                  onChange={(e) => setTktPriority(e.target.value as 'Normal' | 'Urgent')}
                  className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  <option value="Normal">Normal</option>
                  <option value="Urgent">Urgent (Power Down)</option>
                </select>
              </label>

              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Affected Equipment</span>
                <select
                  value={tktEqId}
                  onChange={(e) => setTktEqId(e.target.value)}
                  className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  <option value="">General System / Unspecified</option>
                  {equipment.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.brandModel} ({eq.serialNumber || eq.equipmentType})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Subject *</span>
                <input
                  type="text"
                  required
                  value={tktSubject}
                  onChange={(e) => setTktSubject(e.target.value)}
                  placeholder="e.g. Inverter fault code or annual battery checkup"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Issue Details *</span>
                <textarea
                  rows={3}
                  required
                  value={tktDesc}
                  onChange={(e) => setTktDesc(e.target.value)}
                  placeholder="Describe symptoms, error codes, or preferred technician visit dates..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-[#D61F26] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#B0171D] disabled:opacity-60"
              >
                {busy ? 'Sending...' : 'Send to Help Desk / Admin'}
              </button>
            </div>
          </form>

          {/* Ticket History */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">
              Your Service Requests &amp; Complaint Tickets ({tickets.length})
            </h2>
            <div className="mt-4 space-y-3">
              {tickets.length === 0 ? (
                <p className="text-sm text-slate-500">No service requests or complaints logged yet.</p>
              ) : (
                tickets.map((tkt) => (
                  <div
                    key={tkt.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-[#061327]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono-num font-bold text-[#D61F26]">{tkt.ticketCode}</span>
                        <span>·</span>
                        <span>{tkt.category}</span>
                        <span>·</span>
                        <span className={tkt.priority === 'Urgent' ? 'font-bold text-[#D61F26]' : ''}>
                          {tkt.priority} Priority
                        </span>
                      </div>
                      <span className="font-semibold text-[#081E3E] dark:text-white">{tkt.status}</span>
                    </div>
                    <h3 className="mt-1.5 font-bold text-[#081E3E] dark:text-white">{tkt.subject}</h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{tkt.description}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <span>Equipment: {tkt.equipmentSummary || 'General System'}</span>
                      <span>
                        Assigned Tech: <strong>{tkt.assignedTechName || 'Help Desk Queue'}</strong>
                      </span>
                    </div>
                    {tkt.resolutionNote && (
                      <div className="mt-2 rounded-md bg-emerald-50 p-2.5 text-xs text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
                        <strong>Help Desk / Technician Update:</strong> {tkt.resolutionNote}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
