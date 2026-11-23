import {
  Bell,
  ClipboardList,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Globe2,
  HardHat,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MessageSquareText,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Settings2,
  ShoppingBag,
  Trash2,
  Users,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, compressImageFile, imageBlobToDataUrl } from '../lib/api';
import { listenForStaffLogout, notifyStaffLogoutAcrossTabs } from '../lib/auth-sync';
import { createWhatsAppLink } from '../lib/communications';
import { notifyUser } from '../lib/notifications';
import {
  ALL_PERMISSIONS,
  buildQuoteLinesFromEstimate,
  calculateDocumentTotals,
  formatNgn,
  hasPermission,
  syncLineItemsWithCatalog,
} from '../lib/solar';
import type {
  CatalogItem,
  CatalogItemType,
  EnquiryRecord,
  LineItem,
  PermissionKey,
  QuotationRecord,
  RoleDefinition,
  ServiceTicket,
  StaffStatus,
  StoreOrderRecord,
  StoreOrderStatus,
  TicketStatus,
  UserRole,
  WorkspaceBootstrap,
  PlatformSettings,
} from '../lib/types';
import type { HomepageContent } from '../lib/homepage';
import { PWAInstallButton } from './PWAInstallButton';
import { WorkspaceFinance } from './WorkspaceFinance';
import { WorkspaceInstallations } from './WorkspaceInstallations';
import { WebsiteEditorView } from './WebsiteEditorView';
import { WorkspaceCommunications } from './WorkspaceCommunications';
import { WorkspaceStaffProfile } from './WorkspaceStaffProfile';
import { WorkspaceSettings } from './WorkspaceSettings';

type WorkspaceTab =
  | 'overview'
  | 'enquiries'
  | 'tickets'
  | 'catalog'
  | 'orders'
  | 'quotes'
  | 'invoices'
  | 'finance'
  | 'installations'
  | 'staff'
  | 'profile'
  | 'notifications'
  | 'communications'
  | 'audit'
  | 'settings'
  | 'website';

interface WorkspaceViewProps {
  onOpenDocument: (type: 'quote' | 'invoice', id: string) => void;
  onCatalogChange?: (catalog: CatalogItem[]) => void;
  onHomepageChange?: (content: HomepageContent) => void;
  onSettingsChange?: (settings: PlatformSettings) => void;
}

const WORKSPACE_TABS: WorkspaceTab[] = [
  'overview', 'enquiries', 'tickets', 'catalog', 'orders', 'quotes',
  'invoices', 'finance', 'installations', 'staff', 'profile', 'notifications', 'communications',
  'audit', 'settings', 'website',
];

function readWorkspaceTabFromHash(): WorkspaceTab | null {
  const query = window.location.hash.split('?').slice(1).join('?');
  const tab = new URLSearchParams(query).get('tab');
  return WORKSPACE_TABS.find((candidate) => candidate === tab) ?? null;
}

export function WorkspaceView({
  onOpenDocument,
  onCatalogChange,
  onHomepageChange,
  onSettingsChange,
}: WorkspaceViewProps) {
  const [data, setData] = useState<WorkspaceBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<WorkspaceTab>(() => readWorkspaceTabFromHash() ?? 'overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement>(null);
  const authEpochRef = useRef(0);
  const [errorMsg, setErrorMsg] = useState('');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [staffSetupMode, setStaffSetupMode] = useState(false);
  const [staffSetupPin, setStaffSetupPin] = useState('');
  const [staffSetupPassword, setStaffSetupPassword] = useState('');
  const [staffSetupPasswordConfirm, setStaffSetupPasswordConfirm] = useState('');
  const [setupAvailable, setSetupAvailable] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  const [setupOpen, setSetupOpen] = useState(
    () => new URLSearchParams(window.location.hash.split('?')[1] || '').get('setup') === 'superuser'
  );
  const [setupSecret, setSetupSecret] = useState('');
  const [setupName, setSetupName] = useState('');
  const [setupUsername, setSetupUsername] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPhone, setSetupPhone] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState('');
  const [showSetupPassword, setShowSetupPassword] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [newQuotePickerOpen, setNewQuotePickerOpen] = useState(false);
  const [invoicePickerOpen, setInvoicePickerOpen] = useState(false);
  const [invoiceCreatingId, setInvoiceCreatingId] = useState<string | null>(null);

  // Manual enquiry modal
  const [enqModal, setEnqModal] = useState(false);
  const [enqName, setEnqName] = useState('');
  const [enqPhone, setEnqPhone] = useState('');
  const [enqEmail, setEnqEmail] = useState('');
  const [enqLocation, setEnqLocation] = useState('');
  const [enqChannel, setEnqChannel] = useState('WhatsApp · Manual Intake');
  const [enqNeed, setEnqNeed] = useState('');
  const [followUpEnquiry, setFollowUpEnquiry] = useState<EnquiryRecord | null>(null);
  const [followUpMessage, setFollowUpMessage] = useState('');
  const [followUpBusy, setFollowUpBusy] = useState(false);

  // Store catalogue modal and view.
  const [catalogView, setCatalogView] = useState<'cards' | 'list'>('cards');
  const [catModal, setCatModal] = useState(false);
  const [catSku, setCatSku] = useState('');
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState<CatalogItemType>('equipment');
  const [catCategory, setCatCategory] = useState('Accessories');
  const [catGrade, setCatGrade] = useState('Standard');
  const [catUnit, setCatUnit] = useState('unit');
  const [catPrice, setCatPrice] = useState('45000');
  const [catStock, setCatStock] = useState('10');
  const [catCapacity, setCatCapacity] = useState('');
  const [catWatts, setCatWatts] = useState('');
  const [catDescription, setCatDescription] = useState('');
  const [catImagePath, setCatImagePath] = useState('/src/assets/images/store_inverter_ac_1794824379632.jpg');
  const [catImageDataUrl, setCatImageDataUrl] = useState('');
  const [catImageName, setCatImageName] = useState('');

  // Quotation builder modal
  const [quoteModal, setQuoteModal] = useState(false);
  const [editQuoteId, setEditQuoteId] = useState<string | undefined>(undefined);
  const [quoteEnqId, setQuoteEnqId] = useState('');
  const [quoteCustomer, setQuoteCustomer] = useState('');
  const [quoteScope, setQuoteScope] = useState('');
  const [quoteTerms, setQuoteTerms] = useState('50% deposit on acceptance, 50% prior to commissioning.');
  const [quoteNote, setQuoteNote] = useState('Valid 7 days. Installation warranty: 2 years on installation work only; excludes theft, natural disasters, and end-user error.');
  const [quoteDiscount, setQuoteDiscount] = useState('0');
  const [quoteTax, setQuoteTax] = useState('7.5');
  const [quoteValid, setQuoteValid] = useState(
    new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  );
  const [quoteItems, setQuoteItems] = useState<LineItem[]>([]);
  const [quoteWhatsAppModal, setQuoteWhatsAppModal] = useState(false);
  const [quoteWhatsAppPhone, setQuoteWhatsAppPhone] = useState('');
  const [quoteWhatsAppMessage, setQuoteWhatsAppMessage] = useState('');

  // Help Desk Ticket resolution modal
  const [editTicket, setEditTicket] = useState<ServiceTicket | null>(null);
  const [tktStatus, setTktStatus] = useState<TicketStatus>('Open');
  const [tktTechId, setTktTechId] = useState('');
  const [tktResolution, setTktResolution] = useState('');

  // Staff modal
  const [staffModal, setStaffModal] = useState(false);
  const [editStaffId, setEditStaffId] = useState<string | undefined>(undefined);
  const [staffName, setStaffName] = useState('');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [staffRole, setStaffRole] = useState<UserRole>('technician');
  const [staffTitle, setStaffTitle] = useState('Solar Field Technician');
  const [staffSkills, setStaffSkills] = useState('');
  const [staffStatus, setStaffStatus] = useState<StaffStatus>('Active');
  const [customerAccountCreatingId, setCustomerAccountCreatingId] = useState<string | null>(null);
  const [customerAccountProvisionedQuoteIds, setCustomerAccountProvisionedQuoteIds] = useState<string[]>([]);

  // Custom Role modal (Super Admin)
  const [roleModal, setRoleModal] = useState(false);
  const [editRoleId, setEditRoleId] = useState<string | undefined>(undefined);
  const [roleName, setRoleName] = useState('');
  const [roleDesc, setRoleDesc] = useState('');
  const [rolePerms, setRolePerms] = useState<PermissionKey[]>(['manage_enquiries', 'manage_tickets']);

  // Store order inline status edits.
  const [orderDraftStatus, setOrderDraftStatus] = useState<Record<string, StoreOrderStatus>>({});
  const [orderSavingId, setOrderSavingId] = useState<string | null>(null);

  function selectTab(nextTab: WorkspaceTab, replaceHistory = false) {
    setTab(nextTab);
    setMobileNavOpen(false);
    const nextHash = `#workspace?tab=${nextTab}`;
    if (window.location.hash !== nextHash) {
      if (replaceHistory) {
        window.history.replaceState({ workspaceTab: nextTab }, '', nextHash);
      } else {
        window.history.pushState({ workspaceTab: nextTab }, '', nextHash);
      }
    }
    mainContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showToast(msg: string) {
    notifyUser(msg);
  }

  function openEnquiryFollowUp(enquiry: EnquiryRecord) {
    setErrorMsg('');
    setFollowUpEnquiry(enquiry);
    setFollowUpMessage(
      `Hello ${enquiry.customerName},\n\nThank you for your enquiry ${enquiry.refCode}. A representative will review your request and get back to you shortly.\n\nHI-SOTECH Solar Solutions`
    );
  }

  async function forwardEnquiryToDirector() {
    if (!followUpEnquiry) return;
    setErrorMsg('');
    setFollowUpBusy(true);
    try {
      await api.forwardEnquiryToDirector(followUpEnquiry.id, followUpMessage);
      setFollowUpEnquiry(null);
      showToast(`Enquiry ${followUpEnquiry.refCode} forwarded to the Director.`);
      await loadWorkspace();
    } catch (error) {
      setErrorMsg((error as Error).message);
    } finally {
      setFollowUpBusy(false);
    }
  }

  async function archiveDeskEnquiry() {
    if (!followUpEnquiry) return;
    setErrorMsg('');
    setFollowUpBusy(true);
    try {
      await api.archiveEnquiry(followUpEnquiry.id);
      const refCode = followUpEnquiry.refCode;
      setFollowUpEnquiry(null);
      showToast(`Enquiry ${refCode} archived from the active desk.`);
      await loadWorkspace();
    } catch (error) {
      setErrorMsg((error as Error).message);
    } finally {
      setFollowUpBusy(false);
    }
  }

  async function loadWorkspace() {
    const authEpoch = authEpochRef.current;
    setLoading(true);
    try {
      const sess = await api.session();
      if (authEpoch !== authEpochRef.current) return;
      if (!sess.authenticated) {
        setData(null);
        return;
      }
      const ws = await api.getWorkspace();
      if (authEpoch !== authEpochRef.current) return;
      setData(ws);
      onCatalogChange?.(ws.catalog);

      // Route staff into an accessible initial tab if current tab isn't allowed
      const isFieldOnly =
        ws.user.role === 'technician' &&
        !hasPermission(ws.user, 'manage_enquiries') &&
        !hasPermission(ws.user, 'manage_storefront');
      if (isFieldOnly && !['installations', 'tickets', 'notifications'].includes(tab)) {
        selectTab('installations', true);
      }
      onSettingsChange?.(ws.settings);
    } catch {
      if (authEpoch === authEpochRef.current) setData(null);
    } finally {
      if (authEpoch === authEpochRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => listenForStaffLogout(() => {
    authEpochRef.current += 1;
    setData(null);
    setLoading(false);
    setMobileNavOpen(false);
    setErrorMsg('Your staff session was signed out in another tab.');
  }), []);

  useEffect(() => {
    const onPopState = () => {
      setTab(readWorkspaceTabFromHash() ?? 'overview');
      setMobileNavOpen(false);
      mainContentRef.current?.scrollTo({ top: 0 });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    api.getFirstAdminSetupStatus()
      .then(({ available }) => setSetupAvailable(available))
      .catch(() => setSetupAvailable(false))
      .finally(() => setSetupChecked(true));
  }, []);

  async function handleLogin(email: string, password: string) {
    setErrorMsg('');
    setLoginBusy(true);
    try {
      await api.login(email, password);
      selectTab('overview', true);
      await loadWorkspace();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleStaffPasswordSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMsg('');
    if (staffSetupPassword !== staffSetupPasswordConfirm) {
      setErrorMsg('The passwords do not match.');
      return;
    }
    setLoginBusy(true);
    try {
      await api.setupStaffPassword(loginEmail, staffSetupPin, staffSetupPassword);
      setStaffSetupMode(false);
      setStaffSetupPin('');
      setStaffSetupPassword('');
      setStaffSetupPasswordConfirm('');
      setLoginPassword('');
      setErrorMsg('');
      showToast('Password set. Sign in with your new password.');
    } catch (error) {
      setErrorMsg((error as Error).message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    setErrorMsg('');
    try {
      await api.logout();
    } catch (error) {
      setErrorMsg(`Could not sign out: ${(error as Error).message}`);
      return;
    }

    authEpochRef.current += 1;
    setMobileNavOpen(false);
    setData(null);
    setErrorMsg(
      notifyStaffLogoutAcrossTabs()
        ? ''
        : 'You are signed out here, but other tabs could not be notified. Refresh them before continuing.'
    );
  }

  async function handleFirstAdminSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMsg('');
    if (setupPassword !== setupPasswordConfirm) {
      setErrorMsg('The passwords do not match.');
      return;
    }
    if (setupPassword.length < 14) {
      setErrorMsg('Choose a password with at least 14 characters.');
      return;
    }
    setSetupBusy(true);
    try {
      await api.createFirstAdmin({
        setupSecret,
        name: setupName,
        username: setupUsername,
        email: setupEmail,
        phone: setupPhone,
        password: setupPassword,
      });
      setSetupAvailable(false);
      setSetupOpen(false);
      setSetupSecret('');
      setSetupPassword('');
      setSetupPasswordConfirm('');
      selectTab('overview', true);
      await loadWorkspace();
    } catch (error) {
      setErrorMsg((error as Error).message);
    } finally {
      setSetupBusy(false);
    }
  }

  function openQuoteBuilder(enq?: EnquiryRecord, existing?: QuotationRecord, storeOrder?: StoreOrderRecord) {
    if (!data) return;
    setErrorMsg('');
    if (existing) {
      setEditQuoteId(existing.id);
      setQuoteEnqId(existing.enquiryId);
      setQuoteCustomer(existing.customerName);
      setQuoteScope(existing.scope);
      setQuoteTerms(existing.terms);
      setQuoteNote(existing.note);
      setQuoteDiscount(String(existing.discountNgn));
      setQuoteTax(String(existing.taxPercent));
      setQuoteValid(existing.validUntil);
      setQuoteItems(existing.items);
    } else if (enq) {
      if (!storeOrder && !enq.estimate) {
        setErrorMsg('Only load-estimator enquiries and Store orders can have quotations.');
        return;
      }
      setEditQuoteId(undefined);
      setQuoteEnqId(enq.id);
      setQuoteCustomer(enq.customerName);
      if (storeOrder) {
        setQuoteScope(`Supply of items in purchase order ${storeOrder.orderCode} for ${storeOrder.location}.`);
        setQuoteNote(`Prepared from customer purchase order ${storeOrder.orderCode}. Logistics / delivery remains TBD until priced.`);
        setQuoteItems([
          ...storeOrder.items.map((item) => ({
            sku: item.sku,
            description: item.name,
            unit: item.unit,
            qty: item.qty,
            unitPriceNgn: item.unitPriceNgn,
          })),
          {
            sku: `TBD-LOG-${storeOrder.orderCode}`.slice(0, 80),
            description: 'Logistics / Delivery — To Be Determined',
            unit: 'lot',
            qty: 1,
            unitPriceNgn: 0,
            isTbd: true,
          },
        ]);
      } else {
        setQuoteScope(`Turnkey hybrid solar engineering supply and installation for ${enq.location}.`);
        setQuoteItems(buildQuoteLinesFromEstimate(enq.estimate, data.catalog, data.settings.estimator));
      }
    } else {
      setEditQuoteId(undefined);
      setQuoteEnqId('');
      setQuoteCustomer('');
      setQuoteScope('');
      setQuoteTerms('50% deposit on acceptance, 50% prior to commissioning.');
      setQuoteNote('Valid 7 days. Installation warranty: 2 years on installation work only; excludes theft, natural disasters, and end-user error.');
      setQuoteDiscount('0');
      setQuoteTax('7.5');
      setQuoteValid(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
      setQuoteItems([]);
    }
    setQuoteModal(true);
  }

  async function issueInvoiceFromQuote(quote: QuotationRecord) {
    setErrorMsg('');
    setInvoiceCreatingId(quote.id);
    try {
      const invoice = await api.issueInvoice(quote.id);
      setInvoicePickerOpen(false);
      await loadWorkspace();
      showToast(`Issued invoice ${invoice.invoiceCode}.`);
    } catch (error) {
      setErrorMsg((error as Error).message);
    } finally {
      setInvoiceCreatingId(null);
    }
  }

  function openRoleEditor(roleDef?: RoleDefinition) {
    if (roleDef) {
      setEditRoleId(roleDef.id);
      setRoleName(roleDef.name);
      setRoleDesc(roleDef.description);
      setRolePerms(roleDef.permissions);
    } else {
      setEditRoleId(undefined);
      setRoleName('');
      setRoleDesc('');
      setRolePerms(['manage_enquiries', 'manage_tickets']);
    }
    setRoleModal(true);
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-sm text-slate-500">
        Loading Operations Command Centre...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-[#0B1D39]">
          <div className="flex items-center gap-3">
            <img src="/assets/hisotech-logo-mark.png" alt="HI-SOTECH" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="text-xl font-bold text-[#081E3E] dark:text-white">HI-SOTECH Staff Workspace</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sign In · Super Admin, Director, Admin, Technician &amp; Custom Roles
              </p>
            </div>
          </div>

          {errorMsg && (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
              {errorMsg}
            </p>
          )}

          <form
            onSubmit={staffSetupMode
              ? handleStaffPasswordSetup
              : (event) => {
                event.preventDefault();
                handleLogin(loginEmail, loginPassword);
              }}
            className="mt-6 space-y-4 text-sm"
          >
            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Username or Email</span>
              <input
                type="text"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                autoComplete="username"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-[#061327]"
              />
            </label>
            {staffSetupMode ? (
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
                    value={staffSetupPin}
                    onChange={(e) => setStaffSetupPin(e.target.value)}
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
                    value={staffSetupPassword}
                    onChange={(e) => setStaffSetupPassword(e.target.value)}
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
                    value={staffSetupPasswordConfirm}
                    onChange={(e) => setStaffSetupPasswordConfirm(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
              </>
            ) : (
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Password</span>
                <span className="relative mt-1 block">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 pr-11 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#061327] dark:text-slate-100"
                  />
                  <button
                    type="button"
                    aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showLoginPassword}
                    onClick={() => setShowLoginPassword((visible) => !visible)}
                    className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-slate-500 hover:text-[#D61F26]"
                  >
                    {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </label>
            )}
            <button
              type="submit"
              disabled={loginBusy}
              className="w-full rounded-lg bg-[#081E3E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#D61F26] dark:bg-[#D61F26]"
            >
              {loginBusy ? 'Please wait...' : staffSetupMode ? 'Set Password' : 'Sign In to Staff Workspace'}
            </button>
            <button
              type="button"
              onClick={() => {
                setErrorMsg('');
                setStaffSetupMode((mode) => !mode);
                setLoginPassword('');
              }}
              className="w-full text-center text-xs font-semibold text-[#D61F26] underline underline-offset-2"
            >
              {staffSetupMode ? 'Return to staff sign in' : 'First time here? Set up password with PIN'}
            </button>
          </form>

          {setupOpen && (
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-[#061327]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-[#081E3E] dark:text-white">Initial Super Admin setup</h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    This one-time form is available only while the staff database is empty. The setup secret must be configured privately on the server.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close first Super Admin setup"
                  onClick={() => {
                    setSetupOpen(false);
                    window.history.replaceState(null, '', '#workspace');
                  }}
                  className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
              {setupChecked && !setupAvailable ? (
                <p role="status" className="mt-4 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  Initial setup is not available. Ask the server administrator to set a strong private <code>SETUP_SECRET</code> and confirm that the staff database has no accounts yet.
                </p>
              ) : (
                <form onSubmit={handleFirstAdminSetup} className="mt-4 space-y-3">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Private setup secret
                    <input
                      type="password"
                      required
                      autoComplete="off"
                      value={setupSecret}
                      onChange={(event) => setSetupSecret(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Full name
                    <input
                      type="text"
                      required
                      maxLength={120}
                      value={setupName}
                      onChange={(event) => setSetupName(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Username
                    <input
                      type="text"
                      required
                      minLength={3}
                      maxLength={50}
                      pattern="[a-zA-Z0-9._-]{3,50}"
                      autoComplete="username"
                      value={setupUsername}
                      onChange={(event) => setSetupUsername(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Email address
                    <input
                      type="email"
                      required
                      maxLength={190}
                      autoComplete="email"
                      value={setupEmail}
                      onChange={(event) => setSetupEmail(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    WhatsApp number
                    <input
                      type="tel"
                      maxLength={40}
                      autoComplete="tel"
                      value={setupPhone}
                      onChange={(event) => setSetupPhone(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                    />
                  </label>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Password (at least 14 characters)
                    <span className="relative mt-1 block">
                      <input
                        type={showSetupPassword ? 'text' : 'password'}
                        required
                        minLength={14}
                        maxLength={128}
                        autoComplete="new-password"
                        value={setupPassword}
                        onChange={(event) => setSetupPassword(event.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-11 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                      />
                      <button
                        type="button"
                        aria-label={showSetupPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showSetupPassword}
                        onClick={() => setShowSetupPassword((visible) => !visible)}
                        className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-slate-500 hover:text-[#D61F26]"
                      >
                        {showSetupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </span>
                  </label>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Confirm password
                    <input
                      type={showSetupPassword ? 'text' : 'password'}
                      required
                      minLength={14}
                      maxLength={128}
                      autoComplete="new-password"
                      value={setupPasswordConfirm}
                      onChange={(event) => setSetupPasswordConfirm(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-[#0B1D39] dark:text-white"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={setupBusy || !setupChecked || !setupAvailable}
                    className="w-full rounded-lg bg-[#D61F26] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#B0171D] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {setupBusy ? 'Creating Super Admin…' : 'Create Super Admin account'}
                  </button>
                </form>
              )}
            </div>
          )}

        </div>
      </div>
    );
  }

  const user = data.user;
  const canManagePlatformSettings = user.role === 'superadmin' || user.role === 'admin'
    || (hasPermission(user, 'manage_storefront') && hasPermission(user, 'manage_invoices'));
  const unreadCount = data.notifications.filter((n) => !n.isRead).length;
  const openTicketsCount = data.tickets.filter((t) => t.status !== 'Resolved').length;
  const pendingOrders = data.orders.filter((o) => o.status === 'Pending' || o.status === 'Confirmed').length;
  const pendingQuotes = data.quotes.filter((q) => q.status === 'Pending MD').length;
  const pendingPayments = data.payments.filter((p) => p.status === 'Pending').length;
  const technicians = data.staff.filter(
    (s) => (s.role === 'technician' || hasPermission(s, 'update_installations')) && s.status === 'Active'
  );
  const enquiriesAvailableForQuote = data.enquiries.filter(
    (enquiry) => Boolean(enquiry.estimate)
      && !data.quotes.some((quote) => quote.enquiryId === enquiry.id && quote.status !== 'Rejected')
  );
  const approvedQuotesAvailableForInvoice = data.quotes.filter((quote) => quote.status === 'Approved');

  const navLinks: { id: WorkspaceTab; label: string; icon: typeof LayoutDashboard; allowed: boolean }[] = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, allowed: true },
    { id: 'enquiries', label: 'Enquiries', icon: ClipboardList, allowed: hasPermission(user, 'manage_enquiries') },
    {
      id: 'tickets',
      label: `Help Desk (${openTicketsCount})`,
      icon: LifeBuoy,
      allowed: hasPermission(user, 'manage_tickets'),
    },
    { id: 'catalog', label: 'Store Items & Prices', icon: Layers, allowed: hasPermission(user, 'manage_storefront') },
    {
      id: 'orders',
      label: `Store Orders (${pendingOrders})`,
      icon: ShoppingBag,
      allowed:
        hasPermission(user, 'manage_storefront') ||
        hasPermission(user, 'manage_enquiries') ||
        hasPermission(user, 'manage_invoices'),
    },
    {
      id: 'quotes',
      label: 'Quotations',
      icon: FileText,
      allowed: hasPermission(user, 'draft_quotes') || hasPermission(user, 'approve_quotes'),
    },
    {
      id: 'invoices',
      label: 'Invoices',
      icon: Receipt,
      allowed: hasPermission(user, 'manage_invoices') || hasPermission(user, 'release_installations'),
    },
    {
      id: 'finance',
      label: 'Payments & Finance',
      icon: Wallet,
      allowed: hasPermission(user, 'verify_payments') || hasPermission(user, 'manage_invoices'),
    },
    {
      id: 'installations',
      label: 'Installations',
      icon: HardHat,
      allowed: hasPermission(user, 'update_installations') || hasPermission(user, 'release_installations'),
    },
    {
      id: 'staff',
      label: 'Staff & Roles',
      icon: Users,
      allowed: hasPermission(user, 'manage_staff') || hasPermission(user, 'manage_roles'),
    },
    { id: 'profile', label: 'My Profile', icon: UserRound, allowed: true },
    { id: 'notifications', label: `Notifications (${unreadCount})`, icon: Bell, allowed: true },
    { id: 'communications', label: 'Communications', icon: MessageSquareText, allowed: hasPermission(user, 'manage_communications') },
    { id: 'audit', label: 'Audit Trail', icon: ShieldCheck, allowed: hasPermission(user, 'view_audit') },
    { id: 'settings', label: 'Platform Settings', icon: Settings2, allowed: canManagePlatformSettings },
    { id: 'website', label: 'Website Builder', icon: Globe2, allowed: user.role === 'superadmin' },
  ];

  const quoteTotals = calculateDocumentTotals(
    quoteItems,
    Number(quoteDiscount) || 0,
    Number(quoteTax) || 0
  );

  const renderNavigationContents = (mobile = false) => (
    <>
      <div className="rounded-lg bg-white/10 p-3.5">
        <div className="flex items-center justify-between gap-2">
          {(!sidebarCollapsed || mobile) && (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-red-300">
              {user.roleName || user.role}
            </span>
          )}
          {mobile ? (
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close workspace navigation"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-200 hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              aria-label={sidebarCollapsed ? 'Expand workspace navigation' : 'Collapse workspace navigation'}
              aria-expanded={!sidebarCollapsed}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-200 hover:bg-white/10"
            >
              {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          )}
        </div>
        {(!sidebarCollapsed || mobile) && (
          <>
            <div className="mt-0.5 text-base font-bold text-white">{user.name}</div>
            <div className="text-[11px] text-slate-300">{user.title}</div>
            {!mobile && <div className="mt-3"><PWAInstallButton variant="workspace" /></div>}
          </>
        )}
      </div>

      <nav className="mt-4 space-y-1" aria-label="Workspace sections">
        {navLinks
          .filter((item) => item.allowed)
          .map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                title={!mobile && sidebarCollapsed ? item.label : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${!mobile && sidebarCollapsed ? 'justify-center' : ''} ${
                  active ? 'bg-[#D61F26] text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={!mobile && sidebarCollapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
              </button>
            );
          })}
      </nav>

      <div className="mt-6 border-t border-white/15 pt-4">
        <button
          type="button"
          onClick={() => void handleLogout()}
          aria-label="Sign Out"
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white ${!mobile && sidebarCollapsed ? 'justify-center' : ''}`}
        >
          <LogOut className="h-4 w-4" />
          {(!sidebarCollapsed || mobile) && 'Sign Out'}
        </button>
      </div>
    </>
  );

  return (
    <div className="mx-auto grid min-h-[calc(100dvh-65px)] max-w-7xl grid-cols-12 grid-rows-1 overflow-visible lg:h-[calc(100dvh-65px)] lg:overflow-hidden">
      {/* Sidebar */}
      <aside className={`hidden min-h-0 overflow-y-auto border-r border-slate-200 bg-[#081E3E] p-3 text-slate-200 dark:border-slate-800 lg:block ${sidebarCollapsed ? 'lg:col-span-1' : 'lg:col-span-3'}`}>
        {renderNavigationContents()}
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            aria-label="Close workspace navigation"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 h-full w-full bg-slate-950/5 backdrop-blur-[20px]"
          />
          <aside
            id="workspace-mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
            className="absolute inset-y-0 left-0 z-10 w-[min(21rem,85vw)] overflow-y-auto border-r border-slate-700 bg-[#081E3E] p-3 text-slate-200 shadow-2xl"
          >
            {renderNavigationContents(true)}
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main ref={mainContentRef} className={`col-span-12 min-h-0 min-w-0 overflow-visible p-4 sm:p-6 lg:overflow-y-auto lg:overscroll-contain lg:p-8 ${sidebarCollapsed ? 'lg:col-span-11' : 'lg:col-span-9'}`}>

        {errorMsg && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-wider text-[#D61F26]">COMMAND CENTRE</p>
                <h1 className="text-2xl font-bold text-[#081E3E] dark:text-white">Operations Overview</h1>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: 'Enquiries', val: data.enquiries.length, target: 'enquiries' as WorkspaceTab, ok: hasPermission(user, 'manage_enquiries') },
                { label: 'Store Orders', val: pendingOrders, target: 'orders' as WorkspaceTab, ok: hasPermission(user, 'manage_storefront') || hasPermission(user, 'manage_enquiries') || hasPermission(user, 'manage_invoices') },
                { label: 'Open Help Desk Tickets', val: openTicketsCount, target: 'tickets' as WorkspaceTab, ok: hasPermission(user, 'manage_tickets') },
                { label: 'Quotes Pending Director', val: pendingQuotes, target: 'quotes' as WorkspaceTab, ok: hasPermission(user, 'draft_quotes') || hasPermission(user, 'approve_quotes') },
                { label: 'Receipts Pending Review', val: pendingPayments, target: 'finance' as WorkspaceTab, ok: hasPermission(user, 'verify_payments') || hasPermission(user, 'manage_invoices') },
                { label: 'Active Installations', val: data.installations.length, target: 'installations' as WorkspaceTab, ok: hasPermission(user, 'update_installations') || hasPermission(user, 'release_installations') },
                { label: 'Store Items', val: data.catalog.length, target: 'catalog' as WorkspaceTab, ok: hasPermission(user, 'manage_storefront') },
                { label: 'Staff & Custom Roles', val: data.roles.length, target: 'staff' as WorkspaceTab, ok: hasPermission(user, 'manage_staff') || hasPermission(user, 'manage_roles') },
                { label: 'Unread Alerts', val: unreadCount, target: 'notifications' as WorkspaceTab, ok: true },
              ]
                .filter((k) => k.ok)
                .map((kpi) => (
                  <button
                    key={kpi.label}
                    type="button"
                    onClick={() => selectTab(kpi.target)}
                    className="rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-[#D61F26] dark:border-slate-800 dark:bg-[#0B1D39]"
                  >
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{kpi.label}</div>
                    <div className="font-mono-num mt-1 text-2xl font-bold text-[#081E3E] dark:text-white">
                      {kpi.val}
                    </div>
                  </button>
                ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {hasPermission(user, 'manage_tickets') && (
                <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-[#081E3E] dark:text-white">Customer Service &amp; Complaints</h2>
                    <button
                      type="button"
                      onClick={() => selectTab('tickets')}
                      className="text-xs font-semibold text-[#D61F26] hover:underline"
                    >
                      Open Help Desk →
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {data.tickets.slice(0, 4).map((t) => (
                      <div key={t.id} className="flex items-center justify-between border-b border-slate-100 pb-2.5 text-sm dark:border-slate-800">
                        <div>
                          <span className="font-mono-num font-bold text-[#D61F26]">{t.ticketCode}</span>{' '}
                          <span className="font-semibold">{t.subject}</span>
                          <div className="text-xs text-slate-500">
                            {t.customerName} · {t.category} · {t.priority}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-[#081E3E] dark:text-slate-200">{t.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {hasPermission(user, 'manage_enquiries') && (
                <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-[#081E3E] dark:text-white">Enquiries Pipeline</h2>
                    <button
                      type="button"
                      onClick={() => selectTab('enquiries')}
                      className="text-xs font-semibold text-[#D61F26] hover:underline"
                    >
                      View All →
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {data.enquiries.slice(0, 4).map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center justify-between border-b border-slate-100 pb-2.5 text-sm dark:border-slate-800"
                      >
                        <div>
                          <span className="font-mono-num font-bold text-[#D61F26]">{e.refCode}</span>{' '}
                          <span className="font-semibold">{e.customerName}</span>
                          <div className="text-xs text-slate-500">{e.location} · {e.channel}</div>
                        </div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{e.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* HELP DESK / CUSTOMER SERVICE & COMPLAINTS */}
        {tab === 'tickets' && (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold text-[#081E3E] dark:text-white">
                Help Desk · Customer Service &amp; Complaints
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tickets submitted from customer profiles appear here for Admin triage, Technician assignment, and resolution.
              </p>
            </div>

            <div className="space-y-3">
              {data.tickets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-[#0B1D39]">
                  No customer service requests or complaints logged yet.
                </div>
              ) : (
                data.tickets.map((tkt) => (
                  <div
                    key={tkt.id}
                    className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-mono-num font-bold text-[#D61F26]">{tkt.ticketCode}</span>
                          <span>·</span>
                          <span>{tkt.category}</span>
                          <span>·</span>
                          <span className={tkt.priority === 'Urgent' ? 'font-bold text-[#D61F26]' : ''}>
                            {tkt.priority} Priority
                          </span>
                          <span>·</span>
                          <span className="font-semibold text-[#081E3E] dark:text-white">{tkt.status}</span>
                        </div>
                        <h3 className="mt-1 text-lg font-bold text-[#081E3E] dark:text-white">{tkt.subject}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Customer: {tkt.customerName} ({tkt.customerPhone}) · {tkt.location}
                        </p>
                        <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{tkt.description}</p>
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Equipment: <strong>{tkt.equipmentSummary || 'General System'}</strong> · Technician:{' '}
                          <strong>{tkt.assignedTechName || 'Unassigned'}</strong>
                        </div>
                        {tkt.resolutionNote && (
                          <div className="mt-2 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
                            Resolution Note: {tkt.resolutionNote}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setEditTicket(tkt);
                          setTktStatus(tkt.status);
                          setTktTechId(tkt.assignedTechId || '');
                          setTktResolution(tkt.resolutionNote);
                        }}
                        className="rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26]"
                      >
                        Manage Ticket
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ENQUIRIES */}
        {tab === 'enquiries' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-bold text-[#081E3E] dark:text-white">Enquiries Intake</h1>
              <button
                type="button"
                onClick={() => setEnqModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white"
              >
                <Plus className="h-4 w-4" /> Log Phone / WhatsApp Enquiry
              </button>
            </div>

            <div className="space-y-3">
              {data.enquiries.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                  No active enquiries. Archived enquiries remain in the system records.
                </p>
              )}
              {data.enquiries.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]"
                >
                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono-num font-bold text-[#D61F26]">{e.refCode}</span>
                      <span>·</span>
                      <span>{e.channel}</span>
                      <span>·</span>
                      <span>{e.status}</span>
                    </div>
                    <h3 className="mt-1 text-lg font-bold text-[#081E3E] dark:text-white">{e.customerName}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {e.location} · {e.phone} {e.email ? `· ${e.email}` : ''}
                    </p>
                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{e.needSummary}</p>
                  </div>
                  {hasPermission(user, 'manage_enquiries') && (
                    <button
                      type="button"
                      onClick={() => openEnquiryFollowUp(e)}
                      className="rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26]"
                    >
                      Follow up
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STORE ITEMS & CATALOGUE */}
        {tab === 'catalog' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-[#081E3E] dark:text-white">
                  Store Pricing, Images &amp; Appliances
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Price and specification changes here automatically update the public Store, Load Estimator, and Quotation Builder.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCatalogView(catalogView === 'cards' ? 'list' : 'cards')}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700"
                >
                  {catalogView === 'cards' ? 'Switch to List' : 'Switch to Cards'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCatSku('');
                    setCatName('');
                    setCatType('equipment');
                    setCatCategory('Accessories');
                    setCatGrade('Standard');
                    setCatUnit('unit');
                    setCatPrice('45000');
                    setCatStock('10');
                    setCatCapacity('');
                    setCatWatts('');
                    setCatDescription('');
                    setCatImagePath('/src/assets/images/store_inverter_ac_1794824379632.jpg');
                    setCatImageDataUrl('');
                    setCatImageName('');
                    setCatModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white"
                >
                  <Plus className="h-4 w-4" /> Add Store Item
                </button>
              </div>
            </div>

            {catalogView === 'cards' ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.catalog.map((c) => (
                  <div
                    key={c.sku}
                    className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0B1D39]"
                  >
                    <div>
                      <div className="aspect-[16/10] bg-slate-100 dark:bg-slate-800">
                        <img src={c.imagePath} alt={c.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      </div>
                      <div className="p-4">
                        <div className="font-mono-num text-xs text-slate-500">
                          {c.sku} · <span className="capitalize">{c.itemType}</span> · {c.category} · {c.grade || 'Standard'}
                        </div>
                        <h3 className="mt-1 font-bold text-[#081E3E] dark:text-white">{c.name}</h3>
                        {c.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                            {c.description}
                          </p>
                        )}
                        <div className="mt-3 flex items-center justify-between">
                          <span className="font-mono-num text-base font-bold text-[#D61F26]">
                            {formatNgn(c.priceNgn)}
                          </span>
                          <span className="font-mono-num text-xs text-slate-500">
                            {c.stockQty === 999 ? 'Service' : `${c.stockQty} ${c.unit}`}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 border-t border-slate-100 p-3 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          setCatSku(c.sku);
                          setCatName(c.name);
                          setCatType(c.itemType);
                          setCatCategory(c.category);
                          setCatGrade(c.grade || 'Standard');
                          setCatUnit(c.unit);
                          setCatPrice(String(c.priceNgn));
                          setCatStock(String(c.stockQty));
                          setCatCapacity(c.capacityKw !== null ? String(c.capacityKw) : '');
                          setCatWatts(c.watts !== null ? String(c.watts) : '');
                          setCatDescription(c.description);
                          setCatImagePath(c.imagePath);
                          setCatImageDataUrl('');
                          setCatImageName('');
                          setCatModal(true);
                        }}
                        className="flex-1 rounded-lg border border-slate-300 py-1.5 text-xs font-semibold hover:border-[#081E3E] dark:border-slate-700"
                      >
                        Edit Price / Image
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${c.sku}`}
                        onClick={async () => {
                          await api.deleteCatalogItem(c.sku);
                          await loadWorkspace();
                          showToast(`Removed ${c.sku} from Store.`);
                        }}
                        className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-2.5 text-slate-500 hover:border-red-300 hover:text-[#D61F26] dark:border-slate-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0B1D39]">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700">
                    <tr>
                      <th className="py-2 pr-3">SKU</th>
                      <th className="py-2 pr-3">Item</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3 text-right">Stock</th>
                      <th className="py-2 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.catalog.map((c) => (
                      <tr key={c.sku}>
                        <td className="font-mono-num py-2.5 pr-3 text-xs font-bold">{c.sku}</td>
                        <td className="py-2.5 pr-3 font-medium">{c.name}</td>
                        <td className="py-2.5 pr-3 capitalize text-xs text-slate-500">{c.itemType}</td>
                        <td className="font-mono-num py-2.5 pr-3 text-right">{c.stockQty}</td>
                        <td className="font-mono-num py-2.5 text-right font-bold">{formatNgn(c.priceNgn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* STORE ORDERS */}
        {tab === 'orders' && (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold text-[#081E3E] dark:text-white">Store Customer Orders</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage equipment and appliance checkout orders, update dispatch status, or draft an itemized quote from a linked reference.
              </p>
            </div>

            <div className="space-y-4">
              {data.orders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-[#0B1D39]">
                  No Store orders placed yet.
                </div>
              ) : (
                data.orders.map((ord) => {
                  const currentStatus = orderDraftStatus[ord.id] ?? ord.status;
                  const linkedEnquiry = data.enquiries.find((e) => e.id === ord.enquiryId);
                  return (
                    <div
                      key={ord.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-mono-num font-bold text-[#D61F26]">{ord.orderCode}</span>
                            <span>·</span>
                            <span className="font-mono-num font-semibold text-[#081E3E] dark:text-slate-200">
                              {ord.refCode}
                            </span>
                            <span>·</span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold text-[#081E3E] dark:bg-slate-800 dark:text-white">
                              {ord.status}
                            </span>
                            <span>·</span>
                            <span>{ord.createdAt.slice(0, 10)}</span>
                          </div>
                          <h3 className="mt-1.5 text-lg font-bold text-[#081E3E] dark:text-white">
                            {ord.customerName}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {ord.phone} {ord.email ? `· ${ord.email}` : ''} · {ord.location}
                          </p>
                          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                            <strong>{ord.deliveryMethod}</strong> · {ord.deliveryAddress} ·{' '}
                            <strong>{ord.paymentMethod}</strong>
                          </p>
                          {ord.notes && (
                            <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                              Note: {ord.notes}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <label className="sr-only" htmlFor={`order-status-${ord.id}`}>
                            Status for {ord.orderCode}
                          </label>
                          <select
                            id={`order-status-${ord.id}`}
                            value={currentStatus}
                            onChange={(e) =>
                              setOrderDraftStatus((prev) => ({
                                ...prev,
                                [ord.id]: e.target.value as StoreOrderStatus,
                              }))
                            }
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-[#061327]"
                          >
                            <option value="Pending">Pending</option>
                            <option value="Confirmed">Confirmed</option>
                            <option value="Dispatched">Dispatched</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Completed" disabled>Completed</option>
                            <option value="Cancelled">Cancelled</option>
                          </select>
                          <button
                            type="button"
                            disabled={orderSavingId === ord.id}
                            onClick={async () => {
                              setErrorMsg('');
                              setOrderSavingId(ord.id);
                              try {
                                await api.updateStoreOrder({ orderId: ord.id, status: currentStatus });
                                await loadWorkspace();
                                showToast(`Order ${ord.orderCode} updated to ${currentStatus}.`);
                              } catch (err) {
                                setErrorMsg((err as Error).message);
                              } finally {
                                setOrderSavingId(null);
                              }
                            }}
                            className="rounded-lg bg-[#D61F26] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#B0171D] disabled:opacity-60"
                          >
                            {orderSavingId === ord.id ? 'Saving...' : 'Update Status'}
                          </button>
                          {linkedEnquiry && hasPermission(user, 'draft_quotes')
                            && !data.quotes.some((quote) => quote.enquiryId === ord.enquiryId)
                            && (
                            <button
                              type="button"
                              onClick={() => openQuoteBuilder(linkedEnquiry, undefined, ord)}
                              className="rounded-lg border border-[#081E3E] px-3 py-2 text-xs font-semibold text-[#081E3E] hover:bg-[#081E3E] hover:text-white dark:border-slate-600 dark:text-white"
                            >
                              Prepare &amp; Submit Purchase Quote
                            </button>
                          )}
                          {data.quotes.some((quote) => quote.enquiryId === ord.enquiryId) && (
                            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              Quote: {data.quotes.find((quote) => quote.enquiryId === ord.enquiryId)?.status}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-500 dark:bg-[#061327] dark:text-slate-400">
                            <tr>
                              <th className="px-3 py-2">SKU</th>
                              <th className="px-3 py-2">Item</th>
                              <th className="px-3 py-2 text-right">Qty</th>
                              <th className="px-3 py-2 text-right">Unit Price</th>
                              <th className="px-3 py-2 text-right">Line Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {ord.items.map((it) => (
                              <tr key={`${ord.id}-${it.sku}`}>
                                <td className="font-mono-num px-3 py-2 font-bold text-[#081E3E] dark:text-slate-200">
                                  {it.sku}
                                </td>
                                <td className="px-3 py-2">{it.name}</td>
                                <td className="font-mono-num px-3 py-2 text-right">
                                  {it.qty} {it.unit}
                                </td>
                                <td className="font-mono-num px-3 py-2 text-right">{formatNgn(it.unitPriceNgn)}</td>
                                <td className="font-mono-num px-3 py-2 text-right font-semibold">
                                  {formatNgn(it.qty * it.unitPriceNgn)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="font-mono-num mt-3 flex flex-wrap items-center justify-end gap-4 text-xs text-slate-600 dark:text-slate-300">
                        <span>Subtotal: {formatNgn(ord.subtotalNgn)}</span>
                        <span>Logistics / Delivery: TBD</span>
                        <span>VAT (7.5%): {formatNgn(ord.taxNgn)}</span>
                        <span className="text-sm font-bold text-[#D61F26]">Total: {formatNgn(ord.totalNgn)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* QUOTATIONS */}
        {tab === 'quotes' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-bold text-[#081E3E] dark:text-white">Quotations &amp; Director Approvals</h1>
              {hasPermission(user, 'draft_quotes') && (
                <button
                  type="button"
                  onClick={() => setNewQuotePickerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#D61F26] px-4 py-2 text-sm font-semibold text-white hover:bg-[#B0171D]"
                >
                  <Plus className="h-4 w-4" /> New Quotation
                </button>
              )}
            </div>
            {data.quotes.map((q) => {
              const tot = calculateDocumentTotals(q.items, q.discountNgn, q.taxPercent);
              return (
                <div
                  key={q.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono-num font-bold text-[#D61F26]">
                          {q.quoteCode} · R{q.revisionNo}
                        </span>
                        <span>·</span>
                        <span className="font-semibold text-[#081E3E] dark:text-white">{q.status}</span>
                        <span>·</span>
                        <span>Valid until {q.validUntil}</span>
                      </div>
                      <h3 className="mt-1 text-lg font-bold text-[#081E3E] dark:text-white">{q.customerName}</h3>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{q.scope}</p>
                      <div className="font-mono-num mt-2 text-base font-bold text-[#081E3E] dark:text-white">
                        {formatNgn(tot.total)}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenDocument('quote', q.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-700"
                      >
                        Print PDF <ExternalLink className="h-3 w-3" />
                      </button>
                      {hasPermission(user, 'draft_quotes') && q.status !== 'Invoiced' && (
                        <button
                          type="button"
                          onClick={() => openQuoteBuilder(undefined, q)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-700"
                        >
                          Edit / Revise
                        </button>
                      )}
                      {hasPermission(user, 'approve_quotes') && q.status === 'Pending MD' && (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              await api.decideQuote(q.id, 'Approved');
                              await loadWorkspace();
                              const staffRecipient = data.staff.find((member) =>
                                member.role === 'admin' || member.role === 'superadmin'
                              );
                              setQuoteWhatsAppPhone(staffRecipient?.phone || '');
                              setQuoteWhatsAppMessage(`HI-SOTECH quotation ${q.quoteCode} was APPROVED by the Director.\n\nCustomer: ${q.customerName}\nPlease continue with invoice and customer notification.\n\nOpen: ${window.location.origin}/#workspace?tab=quotes`);
                              setQuoteWhatsAppModal(true);
                              showToast(`${q.quoteCode} approved.`);
                            }}
                            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Approve Quote
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await api.decideQuote(q.id, 'Rejected');
                              await loadWorkspace();
                              const staffRecipient = data.staff.find((member) =>
                                member.role === 'admin' || member.role === 'superadmin'
                              );
                              setQuoteWhatsAppPhone(staffRecipient?.phone || '');
                              setQuoteWhatsAppMessage(`HI-SOTECH quotation ${q.quoteCode} was REJECTED by the Director.\n\nCustomer: ${q.customerName}\nPlease revise and resubmit.\n\nOpen: ${window.location.origin}/#workspace?tab=quotes`);
                              setQuoteWhatsAppModal(true);
                              showToast(`${q.quoteCode} returned for revision.`);
                            }}
                            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {['admin', 'superadmin'].includes(user.role)
                        && q.status === 'Approved'
                        && data.enquiries.some((enquiry) => enquiry.id === q.enquiryId && enquiry.estimate)
                        && (
                          <>
                          <button
                            type="button"
                            disabled={customerAccountCreatingId === q.id || customerAccountProvisionedQuoteIds.includes(q.id)}
                            onClick={async () => {
                              setErrorMsg('');
                              setCustomerAccountCreatingId(q.id);
                              try {
                                const result = await api.createCustomerAccount(q.id);
                                setCustomerAccountProvisionedQuoteIds((current) => [...current, q.id]);
                                showToast(`Customer profile approved. Setup PIN emailed to ${result.email}.`);
                              } catch (error) {
                                setErrorMsg((error as Error).message);
                              } finally {
                                setCustomerAccountCreatingId(null);
                              }
                            }}
                            className="rounded-lg border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-60 dark:border-emerald-500 dark:text-emerald-300"
                          >
                            {customerAccountCreatingId === q.id
                              ? 'Sending PIN...'
                              : customerAccountProvisionedQuoteIds.includes(q.id)
                                ? 'Setup PIN Emailed'
                                : 'Approve Profile & Email PIN'}
                          </button>
                          <button
                            type="button"
                            disabled={customerAccountCreatingId === q.id}
                            onClick={async () => {
                              if (!window.confirm(`Send a password reset PIN to the existing customer account at ${q.customerName}'s enquiry email? This will sign out all active customer sessions.`)) return;
                              setCustomerAccountCreatingId(q.id);
                              try {
                                const result = await api.resetCustomerPassword(q.id);
                                showToast(`Password reset PIN emailed to ${result.email}.`);
                              } catch (error) {
                                setErrorMsg((error as Error).message);
                              } finally {
                                setCustomerAccountCreatingId(null);
                              }
                            }}
                            className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-800 disabled:opacity-60 dark:border-amber-400 dark:text-amber-300"
                          >
                            Reset Customer Password
                          </button>
                          </>
                        )}
                      {hasPermission(user, 'manage_invoices') && q.status === 'Approved' && (
                        <button
                          type="button"
                          onClick={() => void issueInvoiceFromQuote(q)}
                          className="rounded-lg bg-[#D61F26] px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Issue Invoice
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(tab === 'invoices' || tab === 'finance') && (
          <div className="space-y-4">
            {tab === 'invoices' && hasPermission(user, 'manage_invoices') && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setInvoicePickerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#D61F26] px-4 py-2 text-sm font-semibold text-white hover:bg-[#B0171D]"
                >
                  <Plus className="h-4 w-4" /> New Invoice
                </button>
              </div>
            )}
            <WorkspaceFinance
              mode={tab}
              user={user}
              invoices={data.invoices}
              payments={data.payments}
              staff={data.staff}
              onRefresh={loadWorkspace}
              onOpenDocument={onOpenDocument}
              onNotify={showToast}
            />
          </div>
        )}

        {tab === 'installations' && (
          <WorkspaceInstallations
            user={user}
            installations={data.installations}
            staff={data.staff}
            onRefresh={loadWorkspace}
            onNotify={showToast}
          />
        )}

        {/* STAFF & DYNAMIC CUSTOM ROLES */}
        {tab === 'staff' && (
          <div className="space-y-8">
            {/* Roles Governance Section */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-bold text-[#081E3E] dark:text-white">Role Access Governance</h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Super Admin controls all modules and can create custom staff roles with exact permissions.
                  </p>
                </div>
                {hasPermission(user, 'manage_roles') && (
                  <button
                    type="button"
                    onClick={() => openRoleEditor()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#081E3E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D61F26]"
                  >
                    <Plus className="h-4 w-4" /> Create Custom Role
                  </button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {data.roles.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono-num text-xs font-semibold text-[#D61F26]">
                          {r.id} · {r.isSystem ? 'Built-in Role' : 'Custom Role'}
                        </div>
                        <h2 className="mt-1 text-base font-bold text-[#081E3E] dark:text-white">{r.name}</h2>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{r.description}</p>
                        <p className="font-mono-num mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                          {r.permissions.length} permission(s): {r.permissions.slice(0, 4).join(', ')}
                          {r.permissions.length > 4 ? ` +${r.permissions.length - 4} more` : ''}
                        </p>
                      </div>
                      {hasPermission(user, 'manage_roles') && r.id !== 'superadmin' && (
                        <button
                          type="button"
                          onClick={() => openRoleEditor(r)}
                          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-slate-700"
                        >
                          Configure
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Staff Directory */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-[#081E3E] dark:text-white">Staff Accounts</h2>
                {user.role === 'superadmin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditStaffId(undefined);
                      setStaffName('');
                      setStaffUsername('');
                      setStaffEmail('');
                      setStaffPhone('');
                      setStaffRole('technician');
                      setStaffTitle(data.roles.find((role) => role.id === 'technician')?.description || 'Solar Field Technician');
                      setStaffSkills('');
                      setStaffStatus('Active');
                      setStaffModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white"
                  >
                    <Plus className="h-4 w-4" /> Add Staff Member
                  </button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {data.staff.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#0B1D39]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase text-[#D61F26]">
                          {s.roleName || s.role} · {s.status}
                        </div>
                        <h3 className="mt-1 text-lg font-bold text-[#081E3E] dark:text-white">{s.name}</h3>
                        <p className="text-xs text-slate-500">{s.title}</p>
                        <p className="font-mono-num mt-2 text-xs text-slate-600 dark:text-slate-300">
                          {s.email} · {s.phone}
                        </p>
                      </div>
                      {hasPermission(user, 'manage_staff') && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditStaffId(s.id);
                            setStaffName(s.name);
                            setStaffUsername(s.username || '');
                            setStaffEmail(s.email);
                            setStaffPhone(s.phone);
                            setStaffRole(s.role);
                            setStaffTitle(s.title);
                            setStaffSkills(s.skills);
                            setStaffStatus(s.status);
                            setStaffModal(true);
                          }}
                          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold dark:border-slate-700"
                        >
                          Edit
                        </button>
                      )}
                      {['admin', 'superadmin'].includes(user.role) && (
                        <button
                          type="button"
                          onClick={async () => {
                            setErrorMsg('');
                            try {
                              await api.resendStaffSetupPin(s.id);
                              showToast(`Setup PIN emailed to ${s.email}.`);
                            } catch (error) {
                              setErrorMsg((error as Error).message);
                            }
                          }}
                          className="rounded-lg border border-[#D61F26] px-3 py-1 text-xs font-semibold text-[#D61F26]"
                        >
                          Reset Password / Resend PIN
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* NOTIFICATIONS */}
        {tab === 'notifications' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-[#081E3E] dark:text-white">Notifications</h1>
              <button
                type="button"
                onClick={async () => {
                  await api.markNotificationsRead();
                  await loadWorkspace();
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-700"
              >
                Mark All Read
              </button>
            </div>
            <div className="space-y-2.5">
              {data.notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-xl border p-4 text-sm ${
                    n.isRead
                      ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0B1D39]'
                      : 'border-[#D61F26]/50 bg-red-50/50 dark:bg-red-950/20'
                  }`}
                >
                  <div className="font-bold text-[#081E3E] dark:text-white">{n.title}</div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{n.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AUDIT LOG */}
        {tab === 'audit' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-[#081E3E] dark:text-white">Audit Trail</h1>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0B1D39]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-700">
                  <tr>
                    <th className="py-2 pr-3">Timestamp</th>
                    <th className="py-2 pr-3">Actor</th>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.auditLogs.map((a) => (
                    <tr key={a.id}>
                      <td className="font-mono-num py-2.5 pr-3 text-slate-500">
                        {a.createdAt.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="py-2.5 pr-3 font-semibold">
                        {a.actorName} ({a.actorRole})
                      </td>
                      <td className="font-mono-num py-2.5 pr-3 text-[#D61F26]">{a.actionType}</td>
                      <td className="py-2.5">{a.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'website' && (
          <WebsiteEditorView onSaved={onHomepageChange} />
        )}

        {tab === 'communications' && hasPermission(user, 'manage_communications') && (
          <WorkspaceCommunications staff={data.staff} />
        )}

        {tab === 'profile' && (
          <WorkspaceStaffProfile
            user={data.user}
            onSaved={(updatedUser) => setData((current) => current ? {
              ...current,
              user: { ...current.user, ...updatedUser },
              staff: current.staff.map((member) => member.id === updatedUser.id
                ? { ...member, ...updatedUser }
                : member),
            } : current)}
          />
        )}

        {tab === 'settings' && canManagePlatformSettings && (
          <WorkspaceSettings
            catalog={data.catalog}
            settings={data.settings}
            onSaved={(settings) => {
              setData((current) => current ? { ...current, settings } : current);
              onSettingsChange?.(settings);
            }}
            onOpenDocument={onOpenDocument}
          />
        )}
      </main>

      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open workspace navigation"
        aria-expanded={mobileNavOpen}
        aria-controls="workspace-mobile-navigation"
        className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#D61F26] text-white shadow-xl ring-2 ring-white/70 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#081E3E] lg:hidden"
      >
        <Menu className="h-6 w-6" />
      </button>

      {/* Manual Enquiry Modal */}
      {enqModal && (
        <div role="dialog" aria-modal="true" aria-label="Log Offline or WhatsApp Enquiry" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await api.createStaffEnquiry({
                customerName: enqName,
                phone: enqPhone,
                email: enqEmail,
                location: enqLocation,
                channel: enqChannel,
                needSummary: enqNeed,
              });
              setEnqModal(false);
              setEnqName('');
              setEnqPhone('');
              setEnqLocation('');
              setEnqNeed('');
              await loadWorkspace();
              showToast('Enquiry logged into pipeline.');
            }}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">Log Offline / WhatsApp Enquiry</h3>
            <div className="mt-4 space-y-3 text-sm">
              <input
                type="text"
                required={!editStaffId}
                placeholder="Customer / Organization Name *"
                value={enqName}
                onChange={(e) => setEnqName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="tel"
                  required
                  placeholder="Phone *"
                  value={enqPhone}
                  onChange={(e) => setEnqPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={enqEmail}
                  onChange={(e) => setEnqEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Site Location *"
                  value={enqLocation}
                  onChange={(e) => setEnqLocation(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
                <select
                  value={enqChannel}
                  onChange={(e) => setEnqChannel(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  <option>WhatsApp · Manual Intake</option>
                  <option>Phone Call</option>
                  <option>Email (Yahoo/Corporate)</option>
                  <option>Referral / Walk-in</option>
                </select>
              </div>
              <textarea
                rows={3}
                required
                placeholder="Requirement summary..."
                value={enqNeed}
                onChange={(e) => setEnqNeed(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEnqModal(false)} className="rounded-lg border px-4 py-2 text-xs">
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white">
                Save Enquiry
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Store / Catalogue Modal */}
      {catModal && (
        <div role="dialog" aria-modal="true" aria-label="Store Item and Pricing" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setErrorMsg('');
              await api.upsertCatalog({
                sku: catSku,
                name: catName,
                itemType: catType,
                category: catCategory,
                grade: catGrade,
                unit: catUnit,
                priceNgn: Number(catPrice),
                stockQty: Number(catStock),
                capacityKw: catCapacity ? Number(catCapacity) : null,
                watts: catWatts ? Number(catWatts) : null,
                description: catDescription,
                imagePath: catImagePath,
                imageDataUrl: catImageDataUrl || undefined,
                imageName: catImageName || undefined,
              });
              setCatModal(false);
              await loadWorkspace();
              showToast(`Store item ${catSku} updated & synced to Load Estimator.`);
            }}
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">Store Item &amp; Pricing</h3>
            <div className="mt-4 space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <input
                  type="text"
                  required
                  placeholder="SKU (e.g. SPD-DC)"
                  value={catSku}
                  onChange={(e) => setCatSku(e.target.value)}
                  className="font-mono-num rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
                <select
                  value={catType}
                  onChange={(e) => setCatType(e.target.value as CatalogItemType)}
                  className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  <option value="equipment">Solar Equipment</option>
                  <option value="appliance">Appliance</option>
                  <option value="service">Service</option>
                </select>
                <input
                  type="text"
                  required
                  placeholder="Category"
                  value={catCategory}
                  onChange={(e) => setCatCategory(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
                <input
                  type="text"
                  required
                  maxLength={60}
                  placeholder="Grade"
                  value={catGrade}
                  onChange={(e) => setCatGrade(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </div>
              <input
                type="text"
                required
                placeholder="Item Name *"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
              />
              <textarea
                rows={2}
                placeholder="Technical description shown in the public Store..."
                value={catDescription}
                onChange={(e) => setCatDescription(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
              />
              <div className="grid grid-cols-4 gap-2">
                <label className="block text-xs">
                  <span className="text-slate-500">Price (₦) *</span>
                  <input
                    type="number"
                    required
                    value={catPrice}
                    onChange={(e) => setCatPrice(e.target.value)}
                    className="font-mono-num mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-slate-500">Unit</span>
                  <input
                    type="text"
                    required
                    value={catUnit}
                    onChange={(e) => setCatUnit(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-slate-500">Stock</span>
                  <input
                    type="number"
                    required
                    value={catStock}
                    onChange={(e) => setCatStock(e.target.value)}
                    className="font-mono-num mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
                {catType === 'appliance' || catCategory === 'Solar Panels' ? (
                  <label className="block text-xs">
                    <span className="text-slate-500">Watts</span>
                    <input
                      type="number"
                      value={catWatts}
                      onChange={(e) => setCatWatts(e.target.value)}
                      placeholder="150"
                      className="font-mono-num mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                    />
                  </label>
                ) : (
                  <label className="block text-xs">
                    <span className="text-slate-500">{catCategory === 'Battery Storage' ? 'kWh capacity' : 'kW capacity'}</span>
                    <input
                      type="number"
                      step="0.5"
                      value={catCapacity}
                      onChange={(e) => setCatCapacity(e.target.value)}
                      className="font-mono-num mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 dark:border-slate-700 dark:bg-[#061327]"
                    />
                  </label>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-[#061327]">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Product / Appliance Photo (Upload image or keep existing URL)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const compressed = await compressImageFile(file);
                    setCatImageDataUrl(await imageBlobToDataUrl(compressed.blob));
                    setCatImageName(compressed.name);
                  }}
                  className="mt-1.5 block w-full text-xs"
                />
                <input
                  type="text"
                  value={catImagePath}
                  onChange={(e) => setCatImagePath(e.target.value)}
                  placeholder="Image path"
                  className="font-mono-num mt-2 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-[#0B1D39]"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setCatModal(false)} className="rounded-lg border px-4 py-2 text-xs">
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white">
                Save &amp; Sync Store
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Quotation Builder Modal */}
      {quoteModal && (
        <div role="dialog" aria-modal="true" aria-label="Quotation Builder" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">
                {editQuoteId ? 'Revise Quotation' : 'New Itemised Quotation'} · {quoteCustomer}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setQuoteItems((prev) => syncLineItemsWithCatalog(prev, data.catalog));
                  showToast('Synced quote line items with latest Store prices.');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-[#081E3E] hover:border-[#D61F26] dark:border-slate-600 dark:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Sync Store Prices
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium">Technical Scope</span>
                <textarea
                  rows={2}
                  value={quoteScope}
                  onChange={(e) => setQuoteScope(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>

              <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                {quoteItems.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 items-center gap-2 text-xs">
                    <input
                      type="text"
                      value={it.description}
                      onChange={(e) =>
                        setQuoteItems((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x))
                        )
                      }
                      className="col-span-6 rounded border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-[#061327]"
                    />
                    <input
                      type="number"
                      min={1}
                      value={it.qty}
                      onChange={(e) =>
                        setQuoteItems((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) } : x))
                        )
                      }
                      className="font-mono-num col-span-2 rounded border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-[#061327]"
                    />
                    <input
                      type="number"
                      min={0}
                      value={it.unitPriceNgn}
                      onChange={(e) =>
                        setQuoteItems((prev) =>
                          prev.map((x, i) => (i === idx
                            ? { ...x, unitPriceNgn: Number(e.target.value), isTbd: Number(e.target.value) === 0 }
                            : x))
                        )
                      }
                      placeholder={it.isTbd ? 'TBD' : 'Unit price'}
                      className="font-mono-num col-span-3 rounded border border-slate-300 px-2 py-1.5 dark:border-slate-700 dark:bg-[#061327]"
                    />
                    <button
                      type="button"
                      onClick={() => setQuoteItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="col-span-1 text-red-600"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setQuoteItems((prev) => [
                      ...prev,
                      { sku: 'CUSTOM', description: 'Additional Component', unit: 'unit', qty: 1, unitPriceNgn: 50000 },
                    ])
                  }
                  className="text-xs font-semibold text-[#D61F26]"
                >
                  + Add Line Item
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <label className="block text-xs">
                  <span>Discount (₦)</span>
                  <input
                    type="number"
                    value={quoteDiscount}
                    onChange={(e) => setQuoteDiscount(e.target.value)}
                    className="font-mono-num mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
                <label className="block text-xs">
                  <span>Tax / VAT (%)</span>
                  <input
                    type="number"
                    step="0.5"
                    value={quoteTax}
                    onChange={(e) => setQuoteTax(e.target.value)}
                    className="font-mono-num mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
                <label className="block text-xs">
                  <span>Valid Until</span>
                  <input
                    type="date"
                    value={quoteValid}
                    onChange={(e) => setQuoteValid(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 dark:border-slate-700 dark:bg-[#061327]"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-slate-100 p-3 text-sm font-bold dark:bg-[#061327]">
                <span>Computed Quotation Total</span>
                <span className="font-mono-num text-[#D61F26]">{formatNgn(quoteTotals.total)}</span>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setQuoteModal(false)} className="rounded-lg border px-4 py-2 text-xs">
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const res = await api.saveQuote({
                    quoteId: editQuoteId,
                    enquiryId: quoteEnqId,
                    customerName: quoteCustomer,
                    scope: quoteScope,
                    terms: quoteTerms,
                    note: quoteNote,
                    discountNgn: Number(quoteDiscount) || 0,
                    taxPercent: Number(quoteTax) || 0,
                    validUntil: quoteValid,
                    items: quoteItems,
                    submitForApproval: false,
                  });
                  setQuoteModal(false);
                  await loadWorkspace();
                  selectTab('quotes');
                  showToast(`Saved draft ${res.quoteCode}.`);
                }}
                className="rounded-lg border border-[#081E3E] px-4 py-2 text-xs font-semibold text-[#081E3E] dark:border-slate-500 dark:text-white"
              >
                Save Draft
              </button>
              <button
                type="button"
                onClick={async () => {
                  const res = await api.saveQuote({
                    quoteId: editQuoteId,
                    enquiryId: quoteEnqId,
                    customerName: quoteCustomer,
                    scope: quoteScope,
                    terms: quoteTerms,
                    note: quoteNote,
                    discountNgn: Number(quoteDiscount) || 0,
                    taxPercent: Number(quoteTax) || 0,
                    validUntil: quoteValid,
                    items: quoteItems,
                    submitForApproval: true,
                  });
                  setQuoteModal(false);
                  await loadWorkspace();
                  selectTab('quotes');
                  const director = data.staff.find((member) => member.role === 'director' || member.role === 'superadmin');
                  setQuoteWhatsAppPhone(director?.phone || '');
                  setQuoteWhatsAppMessage(
                    `HI-SOTECH quotation ${res.quoteCode} is ready for your approval.\n\nCustomer: ${quoteCustomer}\nScope: ${quoteScope}\nTotal: ${formatNgn(quoteTotals.total)}\n\nOpen: ${window.location.origin}/#document?type=quote&id=${encodeURIComponent(res.id || editQuoteId || '')}\n\nPlease review and approve in the Staff Workspace.`
                  );
                  setQuoteWhatsAppModal(true);
                  showToast(`Submitted ${res.quoteCode} for Director approval.`);
                }}
                className="rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white"
              >
                Submit for Director Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {quoteWhatsAppModal && (
        <div role="dialog" aria-modal="true" aria-label="Preview director WhatsApp message" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">Preview Director WhatsApp Message</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Review the draft, then open WhatsApp and press Send. HI-SOTECH does not send automatically.
            </p>
            <label className="mt-4 block text-xs">
              <span className="font-semibold">Director phone</span>
              <input
                type="tel"
                value={quoteWhatsAppPhone}
                onChange={(event) => setQuoteWhatsAppPhone(event.target.value)}
                placeholder="0801 234 5678"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
              />
            </label>
            <label className="mt-3 block text-xs">
              <span className="font-semibold">Message</span>
              <textarea
                value={quoteWhatsAppMessage}
                onChange={(event) => setQuoteWhatsAppMessage(event.target.value)}
                rows={8}
                className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setQuoteWhatsAppModal(false)} className="rounded-lg border px-4 py-2 text-xs">
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const link = createWhatsAppLink(quoteWhatsAppPhone, quoteWhatsAppMessage);
                  if (!link) {
                    setErrorMsg('Enter a valid director phone number before opening WhatsApp.');
                    return;
                  }
                  window.open(link, '_blank', 'noopener,noreferrer');
                }}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white"
              >
                Open / Send in WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help Desk Ticket Modal */}
      {editTicket && (
        <div role="dialog" aria-modal="true" aria-label="Manage Help Desk Ticket" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await api.updateTicket({
                ticketId: editTicket.id,
                status: tktStatus,
                assignedTechId: tktTechId || null,
                resolutionNote: tktResolution,
              });
              setEditTicket(null);
              await loadWorkspace();
              showToast(`Updated Help Desk ticket ${editTicket.ticketCode}.`);
            }}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">
              Manage Ticket · {editTicket.ticketCode}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {editTicket.customerName} · {editTicket.subject}
            </p>
            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium">Ticket Status</span>
                <select
                  value={tktStatus}
                  onChange={(e) => setTktStatus(e.target.value as TicketStatus)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  <option value="Open">Open</option>
                  <option value="Assigned">Assigned</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Resolved">Resolved</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Assign Technician</span>
                <select
                  value={tktTechId}
                  onChange={(e) => setTktTechId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  <option value="">Unassigned (Help Desk Queue)</option>
                  {technicians.map((tech) => (
                    <option key={tech.id} value={tech.id}>
                      {tech.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium">Help Desk / Technician Resolution Note</span>
                <textarea
                  rows={3}
                  value={tktResolution}
                  onChange={(e) => setTktResolution(e.target.value)}
                  placeholder="Visit scheduled, diagnosis summary, or customer resolution..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditTicket(null)} className="rounded-lg border px-4 py-2 text-xs">
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white">
                Save Ticket Update
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Custom Role Builder Modal (Super Admin) */}
      {roleModal && (
        <div role="dialog" aria-modal="true" aria-label="Custom Staff Role Builder" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await api.saveRole({
                id: editRoleId,
                name: roleName,
                description: roleDesc,
                permissions: rolePerms,
              });
              setRoleModal(false);
              await loadWorkspace();
              showToast(`Saved role ${roleName}.`);
            }}
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">
              {editRoleId ? `Configure Role: ${roleName}` : 'Create Custom Staff Role'}
            </h3>
            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs font-medium">Role Display Name *</span>
                <input
                  type="text"
                  required
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="e.g. Sales Supervisor, Inventory Manager"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium">Role Description</span>
                <input
                  type="text"
                  value={roleDesc}
                  onChange={(e) => setRoleDesc(e.target.value)}
                  placeholder="Summary of responsibilities..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                />
              </label>

              <div>
                <span className="text-xs font-semibold text-[#081E3E] dark:text-white">
                  Granular Module Permissions
                </span>
                <div className="mt-2 grid max-h-56 grid-cols-1 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-700">
                  {ALL_PERMISSIONS.map((perm) => {
                    const checked = rolePerms.includes(perm.key);
                    return (
                      <label key={perm.key} className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setRolePerms((prev) => [...prev, perm.key]);
                            } else {
                              setRolePerms((prev) => prev.filter((p) => p !== perm.key));
                            }
                          }}
                        />
                        <span>
                          <strong className="block text-[#081E3E] dark:text-white">{perm.label}</strong>
                          <span className="text-[11px] text-slate-500">{perm.group}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setRoleModal(false)} className="rounded-lg border px-4 py-2 text-xs">
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white">
                Save Role Permissions
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Staff Modal */}
      {staffModal && (
        <div role="dialog" aria-modal="true" aria-label="Staff Account Editor" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setErrorMsg('');
              try {
                await api.saveStaff({
                  id: editStaffId,
                  name: staffName,
                  username: staffUsername,
                  email: staffEmail,
                  phone: staffPhone,
                  role: staffRole,
                  title: staffTitle,
                  skills: staffSkills,
                  status: staffStatus,
                });
                setStaffModal(false);
                await loadWorkspace();
                showToast(`Staff record saved for ${staffName}.`);
              } catch (err) {
                setErrorMsg((err as Error).message);
                setStaffModal(false);
              }
            }}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]"
          >
            <h3 className="text-lg font-bold text-[#081E3E] dark:text-white">
              {editStaffId ? 'Edit Staff Account' : 'Add Staff Account'}
            </h3>
            <div className="mt-4 space-y-3 text-sm">
              <input
                type="text"
                required
                placeholder="Full Name"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
              />
              <input
                type="email"
                required
                disabled={Boolean(editStaffId)}
                placeholder="Corporate Email"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-60 dark:border-slate-700 dark:bg-[#061327]"
              />
              <input
                type="text"
                required
                maxLength={50}
                pattern="[A-Za-z0-9._-]{3,50}"
                placeholder="Username (3–50 characters)"
                value={staffUsername}
                onChange={(e) => setStaffUsername(e.target.value)}
                autoComplete="username"
                disabled={Boolean(editStaffId && user.role !== 'superadmin')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
              />
              <input
                type="tel"
                required
                placeholder="Phone"
                value={staffPhone}
                onChange={(e) => setStaffPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={staffRole}
                  onChange={(e) => {
                    const selectedRole = data.roles.find((role) => role.id === e.target.value);
                    setStaffRole(e.target.value as UserRole);
                    setStaffTitle(selectedRole?.description || selectedRole?.name || '');
                  }}
                  disabled={user.role !== 'superadmin'}
                  className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  {data.roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <select
                  value={staffStatus}
                  onChange={(e) => setStaffStatus(e.target.value as StaffStatus)}
                  className="rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <input
                type="text"
                required
                placeholder="Job Title"
                value={staffTitle}
                onChange={(e) => setStaffTitle(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-[#061327]"
              />
              {!editStaffId && (
                <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-[#061327] dark:text-slate-300">
                  A one-time four-digit PIN and first-time password setup instructions will be emailed to this staff member.
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setStaffModal(false)} className="rounded-lg border px-4 py-2 text-xs">
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-[#D61F26] px-4 py-2 text-xs font-semibold text-white">
                Save Account
              </button>
            </div>
          </form>
        </div>
      )}

      {followUpEnquiry && (
        <div role="dialog" aria-modal="true" aria-label={`Follow up enquiry ${followUpEnquiry.refCode}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">Follow up enquiry</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {followUpEnquiry.refCode} · {followUpEnquiry.customerName} · {followUpEnquiry.phone}
                </p>
              </div>
              <button type="button" onClick={() => setFollowUpEnquiry(null)} aria-label="Close enquiry follow-up" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mt-4 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Customer message
              <textarea
                value={followUpMessage}
                onChange={(event) => setFollowUpMessage(event.target.value)}
                maxLength={4096}
                rows={7}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-800 dark:border-slate-700 dark:bg-[#061327] dark:text-white"
              />
            </label>
            {errorMsg && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{errorMsg}</p>}
            {data?.orders.some((order) => order.enquiryId === followUpEnquiry.id && order.status !== 'Completed' && order.status !== 'Cancelled') && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                This enquiry is linked to an active Store order and must stay available until the order is completed or cancelled.
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {followUpEnquiry.email && (
                <a
                  href={`mailto:${encodeURIComponent(followUpEnquiry.email)}?subject=${encodeURIComponent(`HI-SOTECH enquiry ${followUpEnquiry.refCode}`)}&body=${encodeURIComponent(followUpMessage)}`}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700"
                >
                  Draft email
                </a>
              )}
              {createWhatsAppLink(followUpEnquiry.phone, followUpMessage) ? (
                <a
                  href={createWhatsAppLink(followUpEnquiry.phone, followUpMessage) || undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700"
                >
                  Open WhatsApp
                </a>
              ) : (
                <button type="button" disabled className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-400 dark:border-slate-700">
                  WhatsApp unavailable
                </button>
              )}
              <button
                type="button"
                onClick={forwardEnquiryToDirector}
                disabled={followUpBusy || !followUpMessage.trim()}
                className="rounded-lg bg-[#081E3E] px-3 py-2 text-xs font-semibold text-white hover:bg-[#D61F26] disabled:opacity-50"
              >
                {followUpBusy ? 'Working…' : 'Forward to Director'}
              </button>
              <button
                type="button"
                onClick={archiveDeskEnquiry}
                disabled={followUpBusy || Boolean(data?.orders.some((order) => order.enquiryId === followUpEnquiry.id && order.status !== 'Completed' && order.status !== 'Cancelled'))}
                className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 dark:border-red-900 dark:text-red-300"
              >
                Archive enquiry
              </button>
            </div>
          </div>
        </div>
      )}

      {newQuotePickerOpen && (
        <div role="dialog" aria-modal="true" aria-label="Choose an enquiry for a new quotation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">New Quotation</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose an enquiry to populate the customer and system estimate.</p>
              </div>
              <button type="button" onClick={() => setNewQuotePickerOpen(false)} aria-label="Close enquiry selector" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto">
              {enquiriesAvailableForQuote.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-[#061327] dark:text-slate-300">
                  Only load-estimator enquiries can be quoted here. Store orders have their own quote action; revise an existing quotation from the Quotes workspace.
                </p>
              ) : enquiriesAvailableForQuote.map((enquiry) => (
                <button
                  key={enquiry.id}
                  type="button"
                  onClick={() => {
                    setNewQuotePickerOpen(false);
                    openQuoteBuilder(enquiry);
                  }}
                  className="w-full rounded-lg border border-slate-200 p-3 text-left hover:border-[#D61F26] dark:border-slate-700"
                >
                  <span className="font-mono-num text-xs font-bold text-[#D61F26]">{enquiry.refCode}</span>
                  <span className="ml-2 text-xs text-slate-500">{enquiry.status}</span>
                  <span className="mt-1 block font-semibold text-[#081E3E] dark:text-white">{enquiry.customerName}</span>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{enquiry.location}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {invoicePickerOpen && (
        <div role="dialog" aria-modal="true" aria-label="Choose an approved quotation for a new invoice" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#0B1D39]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[#081E3E] dark:text-white">New Invoice</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Invoices are issued from approved quotations.</p>
              </div>
              <button type="button" onClick={() => setInvoicePickerOpen(false)} aria-label="Close invoice selector" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto">
              {approvedQuotesAvailableForInvoice.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-[#061327] dark:text-slate-300">
                  No approved quotations are available. Approve a quotation before creating its invoice.
                </p>
              ) : approvedQuotesAvailableForInvoice.map((quote) => (
                <div key={quote.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div>
                    <span className="font-mono-num text-xs font-bold text-[#D61F26]">{quote.quoteCode}</span>
                    <span className="ml-2 text-xs text-slate-500">R{quote.revisionNo}</span>
                    <span className="mt-1 block font-semibold text-[#081E3E] dark:text-white">{quote.customerName}</span>
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{quote.scope}</span>
                  </div>
                  <button
                    type="button"
                    disabled={invoiceCreatingId === quote.id}
                    onClick={() => void issueInvoiceFromQuote(quote)}
                    className="rounded-lg bg-[#D61F26] px-3 py-2 text-xs font-semibold text-white hover:bg-[#B0171D] disabled:opacity-60"
                  >
                    {invoiceCreatingId === quote.id ? 'Issuing…' : 'Create Invoice'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
