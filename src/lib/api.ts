import type {
  ApplianceItem,
  CatalogItemType,
  CustomerEquipment,
  CustomerProfile,
  LineItem,
  OrderDeliveryMethod,
  OrderPaymentMethod,
  PermissionKey,
  ServiceTicket,
  SolarEstimateResult,
  StaffMember,
  StaffStatus,
  StoreOrderItem,
  StoreOrderRecord,
  StoreOrderStatus,
  TicketCategory,
  TicketStatus,
  UserRole,
  WorkspaceBootstrap,
} from './types';
import type { HomepageContent } from './homepage';
import type { NewsletterAttachment } from './communications';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const headers = new Headers(options?.headers);
  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getPublicBootstrap: () =>
    request<{ catalog: WorkspaceBootstrap['catalog'] }>('/api/public/bootstrap'),

  getHomepageContent: () =>
    request<{ homepage: Partial<HomepageContent> }>('/api/website/content'),

  saveHomepageContent: (homepage: HomepageContent) =>
    request<{ homepage: Partial<HomepageContent> }>('/api/website/content', {
      method: 'POST',
      body: JSON.stringify({ homepage }),
    }),

  submitPublicEnquiry: (payload: {
    customerName: string;
    email: string;
    phone: string;
    location: string;
    needSummary: string;
    appliances: ApplianceItem[];
    estimate: SolarEstimateResult;
    whatsappUpdatesConsent?: boolean;
    whatsappMarketingConsent?: boolean;
  }) =>
    request<{ id: string; refCode: string }>('/api/public/enquiries', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  trackRequest: (ref: string) =>
    request<{
      enquiry: {
        refCode: string;
        customerName: string;
        location: string;
        status: string;
        createdAt: string;
        estimate: SolarEstimateResult | null;
      };
      quotation: {
        id: string;
        quoteCode: string;
        status: string;
        revisionNo: number;
        validUntil: string;
      } | null;
      invoice: {
        id: string;
        invoiceCode: string;
        totalNgn: number;
        confirmedPaidNgn: number;
        balanceNgn: number;
        customerAccepted: boolean;
        dueDate: string;
      } | null;
      installation: {
        jobCode: string;
        systemSummary: string;
        currentStage: number;
        targetDate: string;
        updates: {
          id: string;
          stageNumber: number;
          activityTitle: string;
          reportText: string;
          createdAt: string;
          photos: { id: string; fileUrl: string; originalName: string }[];
        }[];
      } | null;
      order?: StoreOrderRecord | null;
    }>(`/api/public/track?ref=${encodeURIComponent(ref)}`),

  submitStoreOrder: (payload: {
    customerName: string;
    email: string;
    phone: string;
    location: string;
    deliveryAddress: string;
    deliveryMethod: OrderDeliveryMethod;
    paymentMethod: OrderPaymentMethod;
    notes: string;
    items: Pick<StoreOrderItem, 'sku' | 'qty'>[];
  }) =>
    request<{ id: string; orderCode: string; refCode: string; totalNgn: number; order: StoreOrderRecord }>(
      '/api/public/orders',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  acceptInvoice: (invoiceId: string) =>
    request<{ accepted: boolean }>('/api/public/accept-invoice', {
      method: 'POST',
      body: JSON.stringify({ invoiceId }),
    }),

  getDocument: (type: 'quote' | 'invoice', id: string) =>
    request<Record<string, unknown>>(
      `/api/public/documents?type=${type}&id=${encodeURIComponent(id)}`
    ),

  // --- Customer Portal & Service Desk ---
  requestCustomerLoginLink: (payload: {
    name?: string;
    email: string;
    phone?: string;
    location?: string;
    company?: string;
    refCode?: string;
  }) => request<{ ok: boolean; message: string }>('/api/customer/login-link', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verifyCustomerLoginLink: (token: string) =>
    request<{
      profile: CustomerProfile;
      equipment: CustomerEquipment[];
      tickets: ServiceTicket[];
    }>('/api/customer/verify', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  customerSession: () =>
    request<{
      authenticated: boolean;
      profile: CustomerProfile | null;
      equipment: CustomerEquipment[];
      tickets: ServiceTicket[];
    }>('/api/customer/session'),

  customerLogout: () => request<{ ok: boolean }>('/api/customer/logout', { method: 'POST' }),

  saveCustomerMarketingConsent: (payload: { email: boolean; whatsapp: boolean; whatsappUpdates: boolean }) =>
    request<{ ok: boolean; emailMarketingConsent: boolean; whatsappMarketingConsent: boolean; whatsappUpdatesConsent: boolean }>('/api/customer/communications/consent', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getCommunicationContacts: () =>
    request<{
      email: { id: string; name: string; email: string; phone: string }[];
      whatsapp: { id: string; name: string; email: string; phone: string; recipientType: 'customer' | 'staff' | 'enquiry' }[];
      pushCustomers: { id: string; name: string }[];
      myWhatsappConsents: { operational: boolean; marketing: boolean; phone: string };
    }>('/api/communications/contacts'),

  getMyWhatsAppConsent: () =>
    request<{ operational: boolean; marketing: boolean; phone: string }>('/api/communications/my-whatsapp-consent'),

  saveMyWhatsAppConsent: (payload: { operational: boolean; marketing: boolean }) =>
    request<{ operational: boolean; marketing: boolean }>('/api/communications/my-whatsapp-consent', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sendWhatsAppMarketing: (recipientType: 'customer' | 'staff' | 'enquiry', recipientId: string, message: string, attachments: NewsletterAttachment[] = []) =>
    request<{ ok: boolean }>('/api/communications/whatsapp', {
      method: 'POST',
      body: JSON.stringify({ recipientType, recipientId, message, attachments }),
    }),

  sendWhatsAppNewsletter: (payload: { message: string; recipients: { recipientType: 'customer' | 'staff' | 'enquiry'; recipientId: string }[]; attachments: NewsletterAttachment[] }) =>
    request<{ ok: boolean; delivered: number }>('/api/communications/whatsapp-newsletter', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sendNewsletter: (payload: { subject: string; message: string; attachments: NewsletterAttachment[] }) =>
    request<{ ok: boolean; delivered: number }>('/api/communications/newsletter', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sendPushNotification: (payload: { title: string; body: string; userIds: string[]; customerIds: string[] }) =>
    request<{ ok: boolean; delivered: number; failed: number }>('/api/communications/push', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getPushConfig: () => request<{ publicKey: string }>('/api/push/config'),

  savePushSubscription: (subscription: PushSubscriptionJSON) =>
    request<{ ok: boolean }>('/api/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    }),

  deletePushSubscription: (endpoint: string) =>
    request<{ ok: boolean }>('/api/push/subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),

  saveCustomerProfile: (payload: {
    name: string;
    phone: string;
    location: string;
    company: string;
    refCode: string;
  }) =>
    request<{ profile: CustomerProfile }>('/api/customer/profile', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveCustomerEquipment: (payload: {
    id?: string;
    equipmentType: string;
    brandModel: string;
    serialNumber: string;
    capacityKw: string;
    installDate: string;
    notes: string;
  }) =>
    request<{ equipment: CustomerEquipment[] }>('/api/customer/equipment', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  submitCustomerTicket: (payload: {
    equipmentId?: string | null;
    category: TicketCategory;
    priority: 'Normal' | 'Urgent';
    subject: string;
    description: string;
  }) =>
    request<{ ticketCode: string; tickets: ServiceTicket[] }>('/api/customer/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // --- Staff Authentication & Workspace ---
  login: (identifier: string, password: string) =>
    request<{ user: StaffMember }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),

  getFirstAdminSetupStatus: () =>
    request<{ available: boolean }>('/api/setup/status'),

  createFirstAdmin: (payload: {
    setupSecret: string;
    name: string;
    username: string;
    email: string;
    phone: string;
    password: string;
  }) =>
    request<{ user: StaffMember }>('/api/setup/first-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  session: () => request<{ authenticated: boolean; user: StaffMember | null }>('/api/auth/session'),

  me: () => request<{ user: StaffMember }>('/api/auth/me'),

  getWorkspace: () => request<WorkspaceBootstrap>('/api/workspace/bootstrap'),

  createStaffEnquiry: (payload: {
    customerName: string;
    email: string;
    phone: string;
    location: string;
    channel: string;
    needSummary: string;
  }) =>
    request<{ id: string; refCode: string }>('/api/enquiries', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  upsertCatalog: (payload: {
    sku: string;
    name: string;
    itemType: CatalogItemType;
    category: string;
    grade: string;
    unit: string;
    priceNgn: number;
    stockQty: number;
    capacityKw: number | null;
    watts: number | null;
    description: string;
    imagePath?: string;
    imageDataUrl?: string;
    imageName?: string;
  }) =>
    request<{ ok: boolean; imagePath: string }>('/api/catalog', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteCatalogItem: (sku: string) =>
    request<{ ok: boolean }>('/api/catalog/delete', {
      method: 'POST',
      body: JSON.stringify({ sku }),
    }),

  saveQuote: (payload: {
    quoteId?: string;
    enquiryId: string;
    customerName: string;
    scope: string;
    terms: string;
    note: string;
    discountNgn: number;
    taxPercent: number;
    validUntil: string;
    items: LineItem[];
    submitForApproval: boolean;
  }) =>
    request<{ quoteCode: string }>('/api/quotes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  decideQuote: (quoteId: string, decision: 'Approved' | 'Rejected') =>
    request<{ status: string }>('/api/quotes/approve', {
      method: 'POST',
      body: JSON.stringify({ quoteId, decision }),
    }),

  issueInvoice: (quotationId: string) =>
    request<{ id: string; invoiceCode: string }>('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ quotationId }),
    }),

  logPayment: (payload: {
    invoiceId: string;
    amountNgn: number;
    paymentDate: string;
    method: string;
    reference: string;
    evidenceNote: string;
  }) =>
    request<{ id: string; paymentCode: string }>('/api/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verifyPayment: (paymentId: string, decision: 'Confirmed' | 'Rejected', reason?: string) =>
    request<{ status: string }>('/api/payments/verify', {
      method: 'POST',
      body: JSON.stringify({ paymentId, decision, reason }),
    }),

  releaseInstallation: (payload: {
    invoiceId: string;
    releaseType: 'Full Payment' | 'MD Exception';
    releaseNote: string;
    assignedEngineerId: string | null;
    targetDate: string;
    systemSummary: string;
  }) =>
    request<{ id: string; jobCode: string }>('/api/installations/release', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  assignInstallation: (installationId: string, engineerId: string) =>
    request<{ ok: boolean }>('/api/installations/assign', {
      method: 'POST',
      body: JSON.stringify({ installationId, engineerId }),
    }),

  acknowledgeInstallation: (installationId: string) =>
    request<{ ok: boolean }>('/api/installations/ack', {
      method: 'POST',
      body: JSON.stringify({ installationId }),
    }),

  submitFieldReport: (payload: {
    installationId: string;
    stageNumber: number;
    activityTitle: string;
    reportText: string;
    isCustomerVisible: boolean;
    advanceStage: boolean;
    photos: { blob: Blob; name: string }[];
  }) => {
    const formData = new FormData();
    const { photos, ...report } = payload;
    formData.append('report', JSON.stringify(report));
    photos.forEach((photo) => formData.append('photos[]', photo.blob, photo.name));
    return request<{ updateId: string }>('/api/installations/report', {
      method: 'POST',
      body: formData,
    });
  },

  updateTicket: (payload: {
    ticketId: string;
    status: TicketStatus;
    assignedTechId?: string | null;
    resolutionNote?: string;
  }) =>
    request<{ ok: boolean }>('/api/tickets/update', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateStoreOrder: (payload: { orderId: string; status: StoreOrderStatus; notes?: string }) =>
    request<{ ok: boolean }>('/api/orders/update', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveStaff: (payload: {
    id?: string;
    name: string;
    username: string;
    email: string;
    phone: string;
    role: UserRole;
    title: string;
    skills: string;
    status: StaffStatus;
    password?: string;
  }) =>
    request<{ id: string }>('/api/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  saveRole: (payload: {
    id?: string;
    name: string;
    description: string;
    permissions: PermissionKey[];
  }) =>
    request<{ id: string }>('/api/roles', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  markNotificationsRead: () => request<{ ok: boolean }>('/api/notifications/read', { method: 'POST' }),
};

export async function compressImageFile(file: File): Promise<{ blob: Blob; name: string }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Selected image is too large. Choose an image under 20MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode selected image.'));
      el.src = url;
    });
    const maxDim = 1440;
    const scale = Math.min(1, maxDim / img.naturalWidth, maxDim / img.naturalHeight);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas compression unavailable.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error('Could not compress selected image.')),
        'image/jpeg',
        0.72
      );
    });
    if (blob.size > 4 * 1024 * 1024) {
      throw new Error('Compressed image is still too large. Choose a smaller image.');
    }
    return { blob, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imageBlobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Could not preview selected image.'));
    reader.onerror = () => reject(new Error('Could not preview selected image.'));
    reader.readAsDataURL(blob);
  });
}
