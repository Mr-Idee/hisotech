export type BuiltInRole = 'superadmin' | 'director' | 'admin' | 'technician';
export type UserRole = BuiltInRole | (string & {});
export type StaffStatus = 'Active' | 'Inactive';

export type PermissionKey =
  | 'manage_enquiries'
  | 'manage_tickets'
  | 'manage_storefront'
  | 'draft_quotes'
  | 'approve_quotes'
  | 'manage_invoices'
  | 'verify_payments'
  | 'release_installations'
  | 'update_installations'
  | 'manage_staff'
  | 'manage_roles'
  | 'view_audit'
  | 'manage_communications';

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  isSystem: boolean;
  createdAt: string;
}

export interface StaffMember {
  id: string;
  name: string;
  username?: string;
  email: string;
  phone: string;
  authType?: 'password' | 'pin';
  profilePhotoUrl?: string;
  role: UserRole;
  roleName?: string;
  permissions?: PermissionKey[];
  title: string;
  skills: string;
  status: StaffStatus;
  createdAt: string;
  mustSetPassword?: boolean;
}

export type PowerMode = 'Hybrid' | 'Off-grid' | 'Grid-backup';

export interface ApplianceItem {
  id: string;
  name: string;
  qty: number;
  watts: number;
  hours: number;
  catalogSku?: string;
}

export interface SolarEstimateOptions {
  peakSunHours?: number;
  backupShare?: number;
  autonomyHours?: number;
  usableDepthPercent?: number;
  equipmentGrade?: string;
  powerMode?: PowerMode;
}

export interface SolarEstimateResult {
  connectedLoadWatts: number;
  dailyEnergyKwh: number;
  inverterMinKw: number;
  batteryTargetKwh: number;
  recommendedPanels550w: number;
  recommendedBatteries5kwh: number;
  powerMode?: PowerMode;
  autonomyHours?: number;
  peakSunHours?: number;
  usableDepthPercent?: number;
  recommendedArrayWatts?: number;
  equipmentGrade?: string;
  estimatedTotalNgn?: number;
}

export type CatalogItemType = 'equipment' | 'service' | 'appliance';

export interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  itemType: CatalogItemType;
  category: string;
  grade?: string;
  unit: string;
  priceNgn: number;
  stockQty: number;
  capacityKw: number | null;
  watts: number | null;
  description: string;
  imagePath: string;
}

export interface EnquiryRecord {
  id: string;
  refCode: string;
  customerName: string;
  email: string;
  phone: string;
  location: string;
  channel: string;
  needSummary: string;
  appliances: ApplianceItem[];
  estimate: SolarEstimateResult | null;
  status: 'New' | 'Technical review';
  ownerUserId: string;
  createdAt: string;
}

export interface LineItem {
  sku: string;
  description: string;
  unit: string;
  qty: number;
  unitPriceNgn: number;
  isTbd?: boolean;
}

export interface QuotationRevision {
  revisionNo: number;
  changedBy: string;
  note: string;
  createdAt: string;
  totalNgn: number;
}

export interface QuotationRecord {
  id: string;
  quoteCode: string;
  enquiryId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  status: 'Draft' | 'Pending MD' | 'Approved' | 'Rejected' | 'Invoiced';
  isExpired: boolean;
  revisionNo: number;
  scope: string;
  terms: string;
  note: string;
  discountNgn: number;
  taxPercent: number;
  issuedDate: string;
  validUntil: string;
  approvedBy: string | null;
  approvedAt: string | null;
  items: LineItem[];
  revisions: QuotationRevision[];
}

export interface BankDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export interface EstimatorSettings {
  inverterCategory: string;
  parallelInverterSkus: string[];
  batteryCategory: string;
  panelCategory: string;
  accessorySkus: string[];
  installationSkus: string[];
  logisticsSkus: string[];
}

export interface PlatformSettings {
  bankDetails: BankDetails;
  estimator: EstimatorSettings;
}

export interface InvoiceRecord {
  id: string;
  invoiceCode: string;
  quotationId: string;
  enquiryId: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress: string;
  note: string;
  discountNgn: number;
  taxPercent: number;
  totalNgn: number;
  status: 'Pending' | 'Confirmed' | 'Completed';
  bankDetails: BankDetails;
  customerAccepted: boolean;
  acceptedAt: string | null;
  issuedDate: string;
  dueDate: string;
  items: LineItem[];
}

export interface PaymentRecord {
  id: string;
  paymentCode: string;
  invoiceId: string;
  amountNgn: number;
  paymentDate: string;
  method: string;
  reference: string;
  evidenceNote: string;
  status: 'Pending' | 'Confirmed' | 'Rejected';
  recordedBy: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface InstallationPhoto {
  id: string;
  fileUrl: string;
  originalName: string;
  uploadedBy: string;
  createdAt: string;
}

export interface InstallationUpdate {
  id: string;
  stageNumber: number;
  activityTitle: string;
  reportText: string;
  isCustomerVisible: boolean;
  createdBy: string;
  createdAt: string;
  photos: InstallationPhoto[];
}

export interface InstallationRecord {
  id: string;
  jobCode: string;
  invoiceId: string;
  enquiryId: string;
  customerName: string;
  location: string;
  systemSummary: string;
  assignedEngineerId: string | null;
  engineerAcknowledged: boolean;
  currentStage: 1 | 2 | 3 | 4 | 5;
  targetDate: string;
  releaseType: 'Full Payment' | 'MD Exception';
  releaseNote: string;
  releasedBy: string;
  releasedAt: string;
  updates: InstallationUpdate[];
}

export interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  location: string;
  company: string;
  refCode: string;
  createdAt: string;
  emailMarketingConsent?: boolean;
  whatsappMarketingConsent?: boolean;
  whatsappUpdatesConsent?: boolean;
}

export interface CustomerEquipment {
  id: string;
  customerId: string;
  equipmentType: string;
  brandModel: string;
  serialNumber: string;
  capacityKw: string;
  installDate: string;
  notes: string;
  createdAt: string;
  photos: CustomerEquipmentPhoto[];
}

export interface CustomerEquipmentPhoto {
  id: string;
  fileUrl: string;
  originalName: string;
  createdAt: string;
}

export type TicketCategory =
  | 'Service Request'
  | 'Complaint'
  | 'Warranty Claim'
  | 'Preventive Maintenance';

export type TicketStatus = 'Open' | 'Assigned' | 'In Progress' | 'Resolved';

export interface ServiceTicket {
  id: string;
  ticketCode: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  location: string;
  equipmentId: string | null;
  equipmentSummary: string;
  category: TicketCategory;
  priority: 'Normal' | 'Urgent';
  subject: string;
  description: string;
  status: TicketStatus;
  assignedTechId: string | null;
  assignedTechName: string | null;
  resolutionNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  title: string;
  body: string;
  targetModule: string;
  targetRef: string;
  isRead: boolean;
  isArchived: boolean;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorName: string;
  actorRole: string;
  actionType: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export type OrderDeliveryMethod = 'Abuja Warehouse Pickup' | 'Nationwide Delivery';
export type OrderPaymentMethod = 'Bank Transfer on Invoice' | 'Pay on Delivery (Abuja)';
export type StoreOrderStatus = 'Pending' | 'Confirmed' | 'Dispatched' | 'Delivered' | 'Completed' | 'Cancelled';

export interface StoreOrderItem {
  sku: string;
  name: string;
  unit: string;
  qty: number;
  unitPriceNgn: number;
  imagePath?: string;
}

export interface StoreOrderRecord {
  id: string;
  orderCode: string;
  enquiryId: string;
  refCode: string;
  customerName: string;
  email: string;
  phone: string;
  location: string;
  deliveryAddress: string;
  deliveryMethod: OrderDeliveryMethod;
  paymentMethod: OrderPaymentMethod;
  notes: string;
  items: StoreOrderItem[];
  subtotalNgn: number;
  deliveryFeeNgn: number;
  taxNgn: number;
  totalNgn: number;
  status: StoreOrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceBootstrap {
  user: StaffMember;
  settings: PlatformSettings;
  roles: RoleDefinition[];
  staff: StaffMember[];
  catalog: CatalogItem[];
  orders: StoreOrderRecord[];
  enquiries: EnquiryRecord[];
  quotes: QuotationRecord[];
  invoices: InvoiceRecord[];
  payments: PaymentRecord[];
  installations: InstallationRecord[];
  tickets: ServiceTicket[];
  notifications: NotificationRecord[];
  auditLogs: AuditLogRecord[];
}
