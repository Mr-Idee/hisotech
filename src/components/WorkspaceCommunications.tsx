import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { NewsletterAttachment } from '../lib/communications';
import type { StaffMember } from '../lib/types';
import { PushSubscriptionControl } from './PushSubscriptionControl';

type Contact = { id: string; name: string; email: string; phone: string };
type WhatsAppContact = Contact & { recipientType: 'customer' | 'staff' | 'enquiry' };

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result.split(',')[1] : '';
      value ? resolve(value) : reject(new Error(`Could not read ${file.name}.`));
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export function WorkspaceCommunications({ staff }: { staff: StaffMember[] }) {
  const [emailContacts, setEmailContacts] = useState<Contact[]>([]);
  const [whatsappContacts, setWhatsappContacts] = useState<WhatsAppContact[]>([]);
  const [pushCustomers, setPushCustomers] = useState<{ id: string; name: string }[]>([]);
  const [whatsappRecipientKey, setWhatsappRecipientKey] = useState('');
  const [whatsappMessage, setWhatsappMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [newsletterMessage, setNewsletterMessage] = useState('');
  const [whatsappNewsletterMessage, setWhatsappNewsletterMessage] = useState('');
  const [attachments, setAttachments] = useState<NewsletterAttachment[]>([]);
  const [whatsappAttachments, setWhatsappAttachments] = useState<NewsletterAttachment[]>([]);
  const [whatsappNewsletterRecipients, setWhatsappNewsletterRecipients] = useState<string[]>([]);
  const [myWhatsappConsent, setMyWhatsappConsent] = useState({ operational: false, marketing: false, phone: '' });
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushRecipients, setPushRecipients] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getCommunicationContacts().then((contacts) => {
      setEmailContacts(contacts.email);
      setWhatsappContacts(contacts.whatsapp);
      setPushCustomers(contacts.pushCustomers);
      setMyWhatsappConsent(contacts.myWhatsappConsents);
    }).catch((err) => setError((err as Error).message));
  }, []);

  async function submit(action: () => Promise<string>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await action());
    } catch (err) {
      setError((err as Error).message || 'Communication could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  async function addAttachments(files: FileList | null) {
    if (!files) return;
    setError('');
    try {
      const additions = Array.from(files);
      if (attachments.length + additions.length > 3) throw new Error('Choose at most three attachments.');
      if (additions.some((file) => !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type))) {
        throw new Error('Only JPEG, PNG, WebP images and PDF files are accepted.');
      }
      if (additions.some((file) => file.size < 1 || file.size > 2 * 1024 * 1024)) {
        throw new Error('Each attachment must be 2MB or smaller.');
      }
      const total = [...attachments, ...additions].reduce((sum, file) => sum + file.size, 0);
      if (total > 4 * 1024 * 1024) throw new Error('Combined attachments may not exceed 4MB.');
      const encoded = await Promise.all(additions.map(async (file) => ({
        name: file.name,
        mimeType: file.type,
        size: file.size,
        data: await readFile(file),
      })));
      setAttachments((current) => [...current, ...encoded]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addWhatsAppAttachment(files: FileList | null) {
    if (!files) return;
    setError('');
    try {
      const file = files[0];
      if (files.length > 1) throw new Error('WhatsApp template media supports one image or PDF file.');
      if (file && !['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
        throw new Error('WhatsApp supports JPEG or PNG images and PDF files.');
      }
      if (file && (file.size < 1 || file.size > 2 * 1024 * 1024)) {
        throw new Error('WhatsApp media must be 2MB or smaller.');
      }
      if (file) setWhatsappAttachments([{
        name: file.name,
        mimeType: file.type,
        size: file.size,
        data: await readFile(file),
      }]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const activeStaff = staff.filter((member) => member.status === 'Active');
  const [pushCustomerRecipients, setPushCustomerRecipients] = useState<string[]>([]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold tracking-wider text-[#D61F26]">ADMIN / STAFF</p>
        <h1 className="mt-1 text-2xl font-bold text-[#081E3E] dark:text-white">Communications workspace</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Marketing is sent only to verified customers with current, recorded channel consent.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(async () => {
            await api.sendTestEmail();
            return 'SMTP accepted a test email for your signed-in staff address. Check that mailbox before enabling customer sign-in.';
          })}
          className="mt-3 rounded-lg border border-[#081E3E] px-4 py-2 text-xs font-semibold text-[#081E3E] disabled:opacity-60 dark:border-slate-600 dark:text-white"
        >
          {busy ? 'Sending test...' : 'Send test email to my staff address'}
        </button>
      </header>

      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">{error}</p>}

      <PushSubscriptionControl />

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
        <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">My WhatsApp preferences</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Your saved staff number: {myWhatsappConsent.phone || 'not set'}. Consent is self-managed and can be withdrawn.
        </p>
        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={myWhatsappConsent.operational}
              onChange={(event) => setMyWhatsappConsent((current) => ({ ...current, operational: event.target.checked }))} />
            <span>Allow WhatsApp notifications about assigned enquiries, quotes, invoices, tickets, and installations.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={myWhatsappConsent.marketing}
              onChange={(event) => setMyWhatsappConsent((current) => ({ ...current, marketing: event.target.checked }))} />
            <span>Separately allow WhatsApp marketing messages and newsletters.</span>
          </label>
        </div>
        <button type="button" disabled={busy} onClick={() => void submit(async () => {
          const result = await api.saveMyWhatsAppConsent({
            operational: myWhatsappConsent.operational,
            marketing: myWhatsappConsent.marketing,
          });
          setMyWhatsappConsent((current) => ({ ...current, ...result }));
          return 'Your WhatsApp preferences were saved.';
        })} className="mt-3 rounded-lg border border-[#081E3E] px-4 py-2 text-xs font-semibold text-[#081E3E] dark:border-slate-600 dark:text-white">
          Save my WhatsApp preferences
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
        <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">One-to-one WhatsApp message</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{whatsappContacts.length} opted-in customer(s)</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Uses approved proactive templates only. Recipients must have active WhatsApp marketing consent.
        </p>
        <form className="mt-4 space-y-3" onSubmit={(event) => {
          event.preventDefault();
          void submit(async () => {
            const recipient = whatsappContacts.find((contact) => `${contact.recipientType}:${contact.id}` === whatsappRecipientKey);
            if (!recipient) throw new Error('Select a recipient with active WhatsApp consent.');
            await api.sendWhatsAppMarketing(recipient.recipientType, recipient.id, whatsappMessage);
            setWhatsappMessage('');
            return 'WhatsApp message accepted by the provider.';
          });
        }}>
          <label className="block text-xs font-medium">
            Recipient with marketing consent
            <select required value={whatsappRecipientKey} onChange={(event) => setWhatsappRecipientKey(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]">
              <option value="">Select a customer</option>
              {whatsappContacts.map((contact) => <option key={`${contact.recipientType}-${contact.id}`} value={`${contact.recipientType}:${contact.id}`}>{contact.name} · {contact.phone} · {contact.recipientType}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium">
            Template body parameter (up to 1024 characters)
            <textarea required maxLength={1024} rows={4} value={whatsappMessage} onChange={(event) => setWhatsappMessage(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]" />
          </label>
          <button disabled={busy || !whatsappContacts.length} className="rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26] disabled:opacity-50">
            {busy ? 'Sending…' : 'Send WhatsApp message'}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
        <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">Newsletter email</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{emailContacts.length} opted-in customer(s) · SMTP</p>
        <form className="mt-4 space-y-3" onSubmit={(event) => {
          event.preventDefault();
          void submit(async () => {
            const result = await api.sendNewsletter({ subject, message: newsletterMessage, attachments });
            setSubject('');
            setNewsletterMessage('');
            setAttachments([]);
            return `Newsletter sent to ${result.delivered} consented recipient(s).`;
          });
        }}>
          <input required maxLength={180} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]" />
          <textarea required maxLength={10000} rows={6} value={newsletterMessage} onChange={(event) => setNewsletterMessage(event.target.value)}
            placeholder="Newsletter message"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]" />
          <label className="block text-xs font-medium">
            Attach images or PDF (maximum 3 files, 2MB each, 4MB combined)
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) => void addAttachments(event.target.files)} className="mt-1 block w-full text-xs" />
          </label>
          {attachments.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex items-center justify-between text-xs">
              <span>{file.name} · {(file.size / 1024).toFixed(0)} KB</span>
              <button type="button" onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                className="text-red-600 underline">Remove</button>
            </div>
          ))}
          <button disabled={busy || !emailContacts.length} className="rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26] disabled:opacity-50">
            {busy ? 'Sending…' : 'Send to opted-in customers'}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
        <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">WhatsApp newsletter</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Sends only through the privately configured approved newsletter template and to recipients with current marketing consent.
        </p>
        <form className="mt-4 space-y-3" onSubmit={(event) => {
          event.preventDefault();
          void submit(async () => {
            const recipients = whatsappNewsletterRecipients.map((key) => {
              const contact = whatsappContacts.find((candidate) => `${candidate.recipientType}:${candidate.id}` === key);
              return contact ? { recipientType: contact.recipientType, recipientId: contact.id } : null;
            }).filter((value): value is NonNullable<typeof value> => Boolean(value));
            const result = await api.sendWhatsAppNewsletter({
              message: whatsappNewsletterMessage,
              recipients,
              attachments: whatsappAttachments,
            });
            setWhatsappNewsletterRecipients([]);
            setWhatsappAttachments([]);
            return `WhatsApp newsletter accepted for ${result.delivered} consented recipient(s).`;
          });
        }}>
          <textarea required maxLength={1024} rows={4} value={whatsappNewsletterMessage}
            onChange={(event) => setWhatsappNewsletterMessage(event.target.value)} placeholder="Approved template body parameter"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]" />
          <label className="block text-xs font-medium">
            Optional image or PDF header media (maximum one file, 2MB)
            <input type="file" accept="image/jpeg,image/png,application/pdf"
              onChange={(event) => void addWhatsAppAttachment(event.target.files)} className="mt-1 block w-full text-xs" />
          </label>
          {whatsappAttachments.map((file) => (
            <div key={file.name} className="flex items-center justify-between text-xs">
              <span>{file.name} · {(file.size / 1024).toFixed(0)} KB</span>
              <button type="button" onClick={() => setWhatsappAttachments([])} className="text-red-600 underline">Remove</button>
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-2">
            {whatsappContacts.map((contact) => {
              const key = `${contact.recipientType}:${contact.id}`;
              return <label key={key} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={whatsappNewsletterRecipients.includes(key)}
                  onChange={(event) => setWhatsappNewsletterRecipients((current) => event.target.checked
                    ? [...current, key]
                    : current.filter((entry) => entry !== key))} />
                {contact.name} · {contact.phone} · {contact.recipientType}
              </label>;
            })}
          </div>
          <button disabled={busy || !whatsappNewsletterRecipients.length}
            className="rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? 'Sending…' : 'Send WhatsApp newsletter'}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]">
        <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">Web Push notifications</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Deliver a short update to staff or verified customers who subscribed on their device.</p>
        <form className="mt-4 space-y-3" onSubmit={(event) => {
          event.preventDefault();
          void submit(async () => {
            const result = await api.sendPushNotification({
              title: pushTitle,
              body: pushBody,
              userIds: pushRecipients,
              customerIds: pushCustomerRecipients,
            });
            setPushTitle('');
            setPushBody('');
            setPushCustomerRecipients([]);
            return `Push delivered to ${result.delivered} device(s); ${result.failed} failed.`;
          });
        }}>
          <input required maxLength={120} value={pushTitle} onChange={(event) => setPushTitle(event.target.value)} placeholder="Notification title"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]" />
          <textarea required maxLength={500} rows={3} value={pushBody} onChange={(event) => setPushBody(event.target.value)} placeholder="Notification body"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-[#061327]" />
          <div className="grid gap-2 sm:grid-cols-2">
            {activeStaff.map((member) => (
              <label key={member.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={pushRecipients.includes(member.id)}
                  onChange={(event) => setPushRecipients((current) => event.target.checked
                    ? [...current, member.id]
                    : current.filter((id) => id !== member.id))} />
                {member.name} · {member.roleName || member.role}
              </label>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {pushCustomers.map((customer) => (
              <label key={customer.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={pushCustomerRecipients.includes(customer.id)}
                  onChange={(event) => setPushCustomerRecipients((current) => event.target.checked
                    ? [...current, customer.id]
                    : current.filter((id) => id !== customer.id))} />
                {customer.name} · Customer portal subscriber
              </label>
            ))}
          </div>
          <button disabled={busy || (!pushRecipients.length && !pushCustomerRecipients.length)} className="rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26] disabled:opacity-50">
            {busy ? 'Sending…' : 'Send push notification'}
          </button>
        </form>
      </section>
    </div>
  );
}
