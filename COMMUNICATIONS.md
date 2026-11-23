# HI-SOTECH communications and user workflows

This document catalogs the email compositions and triggers implemented by the PHP/MySQL production app and the Node/SQLite preview. Production email is sent through the private SMTP configuration. The Node preview uses `SMTP_URL` and `MAIL_FROM`; cPanel uses the corresponding private settings in `hiso_private/.env.php`. No mail password or provider token belongs in this document or the repository.

The production implementation is primarily in [`php-cpanel/hiso_private/communications.php`](php-cpanel/hiso_private/communications.php), [`php-cpanel/hiso_private/auth.php`](php-cpanel/hiso_private/auth.php), and [`api/index.php`](api/index.php). The Node preview equivalents are in [`server.ts`](server.ts) and [`src/server/db.ts`](src/server/db.ts).

## Email compositions and triggers

| Trigger | Recipient(s) | Subject | Composition and behavior |
|---|---|---|---|
| Public enquiry submitted from the home-page form, with or without the load estimator | Enquirer | `We received your HI-SOTECH enquiry {enquiryCode}` | Personalized greeting; confirms receipt, includes the enquiry code (and estimator quotation code when present), and says a representative will follow up using the submitted WhatsApp number. |
| Same public enquiry submission | Active Admin and Super Admin staff | `New enquiry {enquiryCode}: {name}` | Customer name, phone/WhatsApp, email, location, enquiry details, code, optional estimator quotation code, and a link to the enquiries workspace. |
| Admin forwards an enquiry to the Director | Director and Super Admin | `HI-SOTECH enquiry forwarded for follow-up: {enquiryCode}` | Enquiry and customer details, Admin's follow-up draft/note, and a link to the enquiries workspace. This forwards the enquiry internally; it does not send the draft to the customer. |
| Customer places a Store order | Customer | `HI-SOTECH purchase order {orderCode} received — pending confirmation` | Personalized purchase-order confirmation, ordered items, subtotal, VAT, delivery/logistics marked TBD, and the current total excluding delivery. States that Director confirmation and final delivery pricing are pending and that no payment is due from this message. |
| Same Store order submission | Admin, Super Admin, and Director | `Purchase order {orderCode} awaits Director confirmation` | Customer/contact and delivery details, order items and totals, TBD delivery, customer notes, and a workspace link. |
| Staff member submits a quotation for Director approval | Director and Super Admin | `HI-SOTECH quotation awaiting Director approval: {quoteCode}` | Quotation code, customer, scope, and a link to the quotations workspace. |
| Director decides a quotation | Admin and Super Admin | `HI-SOTECH quotation decision: {status}` | Decision, quotation ID, and a link to the quotations workspace. The customer is not automatically sent the quotation PDF; staff must use the document-email action. |
| Admin provisions a customer account from a Director-approved estimator quotation | Customer | `Your HI-SOTECH account setup instructions` | Personalized greeting, portal email/username, four-digit one-time setup PIN, 24-hour expiry, and instructions to create a password. The PIN is invalidated after ten incorrect attempts. Delivery failure is reported so the Admin can retry. |
| Admin resets a customer password from the approved estimator quotation | Customer | `Your HI-SOTECH password reset instructions` | Same four-digit one-time PIN setup flow. Resetting invalidates active customer sessions and existing sign-in links; the PIN is invalidated after ten incorrect attempts. |
| Super Admin creates a staff account or Admin/Super Admin resends its setup PIN | Staff member | `Your HI-SOTECH account setup instructions` | Personalized greeting, username, four-digit one-time PIN, 24-hour expiry, staff-workspace link, and password-creation instructions. The PIN is invalidated after ten incorrect attempts. |
| Staff member requests “Forgot Password?” | Staff member's verified email address | `Reset your HI-SOTECH staff password` | One-use reset link; expires after 30 minutes. Successful reset changes authentication back to password and revokes existing sessions. An unknown or unverified staff email currently receives an explicit error. |
| Existing customer requests a passwordless sign-in link | Customer account email | `Your HI-SOTECH customer sign-in link` | One-use customer portal link, expires after 15 minutes. The API returns a generic acceptance response whether or not an eligible customer account exists. |
| Admin issues an invoice | Customer | `HI-SOTECH invoice {invoiceCode}` | Personalized invoice notice with line items, amount due, customer portal link, and a pending-payment status. |
| Same invoice issuance | Admin and Super Admin | `Invoice issued: {invoiceCode}` | Confirms invoice creation, customer email, amount, and an invoice workspace link. |
| Staff logs a payment receipt | Director and Super Admin | `HI-SOTECH payment receipt awaiting verification: {paymentCode}` | Receipt code, amount, pending-verification status, and a finance workspace link. |
| Quote, invoice, ticket, or installation lifecycle event | Related eligible customer/enquiry/staff recipient | Production subject: `HI-SOTECH service update`; Node preview uses `HI-SOTECH update: {event}` unless a specific subject is supplied | Uses the event message supplied by the trigger. If enabled for the event and recipient, this same lifecycle message may also be sent as WhatsApp and browser push. Delivery is conditional on the recipient records, channel configuration, subscriptions, and (for WhatsApp) active operational consent. |
| Staff emails a quotation or invoice PDF from the workspace | Customer on the document's enquiry | `HI-SOTECH Quotation {documentCode}` or `HI-SOTECH Invoice {documentCode}` | Short message with the validated PDF attached. This is a staff action, not an automatic quotation-approval email. |
| Super Admin sends an SMTP test from Communications | Chosen address, or the signed-in Super Admin address | `HI-SOTECH email delivery test` | Fixed test message confirming outbound SMTP delivery. Rate-limited. |
| Staff sends an email newsletter | Customers with active email-marketing consent; optionally restricted to a selected contact group | Staff-entered subject | Staff-entered message and validated attachments, sent in BCC batches. Recipients are re-resolved server-side at send time; unconsented, invalid, or unavailable contacts are skipped. |

## Generated email copy

The following are the production PHP copy patterns. `{...}` denotes a value filled from the record at send time; optional lines are included only when their value exists.

### Public enquiry confirmation

**Subject:** `We received your HI-SOTECH enquiry {refCode}`

```text
Hello {customerName},

We have received your HI-SOTECH enquiry {refCode}{ optional: " (load estimate {quoteCode})"}.
A representative will review your request and get back to you shortly using the WhatsApp number you provided.

Thank you,
HI-SOTECH Solar Solutions
```

### Internal enquiry notification

**Subject:** `New enquiry {refCode}: {customerName}`

```text
A customer has submitted a HI-SOTECH enquiry.

Name: {customerName}
Phone / WhatsApp: {phone}
Email: {email or "Not provided"}
Location: {location}
Enquiry code: {refCode}
{ optional: "Estimator quotation: {quoteCode}" }
Details: {needSummary}

Open the enquiry workspace to follow up: {APP_URL}/#workspace?tab=enquiries
```

### Enquiry forwarded to the Director

**Subject:** `HI-SOTECH enquiry forwarded for follow-up: {refCode}`

The message includes the forwarding staff member, customer name/phone/email/location/channel, enquiry details, the staff-authored follow-up note, and the workspace link. It is an internal forward, not an email to the customer.

### Store purchase-order confirmation

**Subject:** `HI-SOTECH purchase order {orderCode} received — pending confirmation`

The personalized message lists each item and quantity, items subtotal, VAT, delivery/logistics as `TBD`, and current total excluding delivery. It says the order is pending Director confirmation, delivery/logistics and additional items must be confirmed before invoicing, and no payment is due from the purchase-order email.

The internal copy to Admin, Super Admin, and Director adds the customer phone/email/location, delivery method and address, enquiry reference, customer notes, and a link to the orders workspace.

### Account setup and customer PIN reset

**Subject:** `Your HI-SOTECH account setup instructions` (new account) or `Your HI-SOTECH password reset instructions` (customer reset)

```text
Hello {name},

Your HI-SOTECH {customer portal|staff workspace} account is ready.
Username: {username}
One-time setup PIN: {pin}
The PIN expires in 24 hours and can only be used once.
{staff: enter username/email and PIN in staff sign-in, then create a password}
{customer: enter email and PIN in customer portal, then create a password}
If you did not expect this account, contact HI-SOTECH support.
```

### Staff password reset link

**Subject:** `Reset your HI-SOTECH staff password`

```text
Hello {name},

Use this secure link to reset your staff workspace password. It expires in 30 minutes and can only be used once.
{APP_URL}/#workspace?reset={one-time-token}

If you did not request this reset, you can ignore this email.
```

### Customer passwordless sign-in

**Subject:** `Your HI-SOTECH customer sign-in link`

```text
Use this one-time link to access your HI-SOTECH customer portal:

{APP_URL}/#customer?token={one-time-token}

The link expires in 15 minutes and can only be used once. If you did not request it, you can ignore this message.
```

### Invoice issued

**Subject:** `HI-SOTECH invoice {invoiceCode}`

```text
Hello {customerName},

Your HI-SOTECH invoice {invoiceCode} has been issued and is pending payment.

Invoice items:
{quantity} × {description} — ₦{line amount}
...

Amount due: ₦{totalNgn}
View your account and invoice at: {APP_URL}/#customer

Please contact the HI-SOTECH front desk if you have any questions.
```

The internal invoice notice to Admin and Super Admin confirms the invoice code, customer, email, amount, and invoice workspace link.

### SMTP test and document email

- **SMTP test subject:** `HI-SOTECH email delivery test`. Body: `This is a test of HI-SOTECH email delivery. If you received it, outbound email is working.`
- **Document subject:** `HI-SOTECH {Quotation|Invoice} {documentCode}`. Body: `Please find the HI-SOTECH {quotation|invoice} attached as a PDF.` The validated PDF is attached.

### Variable lifecycle messages

Lifecycle mail uses subject `HI-SOTECH service update` in PHP production and the trigger-supplied message. The currently wired messages include:

- Staff-created enquiry: `New enquiry {refCode} received. Our team will follow up.`
- Invoice acknowledgement: `Your invoice was acknowledged.`
- Invoice issuance: personalized greeting, invoice code, item lines, amount due, and customer portal link (included in the invoice-specific email above).
- Invoice/payment update: `A payment receipt for your invoice was {confirmed|rejected}. Invoice status: {status}.`
- Payment awaiting verification: receipt code, amount, pending status, and finance workspace link; emailed to Director and Super Admin.
- Service ticket receipt: `Service ticket {ticketCode} was received.` Staff also receive the internal ticket-received notice.
- Service ticket update: `Service ticket {ticketCode} status changed to {status}.`
- Installation release: `Installation {jobCode} has been scheduled.`
- Installation assignment: `Your installation has been assigned to a field engineer.`
- Installation report: `Installation update: stage {stageNumber}, {activityTitle}.`

An email newsletter is not a fixed template: its subject, body, and optional attachments are entered by authorized staff. A one-to-one customer quotation/invoice email uses the fixed document message above; the app does not provide a general-purpose one-to-one email composer.

### Event-based service notifications

The lifecycle notifier is invoked for these operational events:

- **Enquiry:** staff logs an enquiry; a message goes to the enquiry contact and active operational staff recipients.
- **Quotation:** invoice creation notifies the customer that the approved quote was converted; quote submission and approval decisions also notify the relevant internal roles.
- **Invoice/payment:** invoice acknowledgement, invoice issuance, payment receipt logging, and payment verification/rejection. Payment logging emails Director and Super Admin for verification; verification also sends the resulting status to the customer when a valid recipient can be resolved.
- **Service ticket:** customer ticket submission and staff ticket status updates. Admin and Super Admin receive internal status email; assigned technicians may receive in-app assignment notifications.
- **Installation:** release/scheduling, engineer assignment, and field-report updates.

The PHP invoice-issuance path sends the invoice email through the invoice-specific composition and suppresses a duplicate lifecycle email. The Node preview currently emits the invoice-specific lifecycle message and a separate quotation-converted lifecycle message. Treat the production PHP behavior as authoritative for deployment.

## Other communication channels

- **WhatsApp:** public enquiry acknowledgement is sent only with valid operational consent recorded for the submitted number. Staff-composed single-recipient messages and WhatsApp newsletters require current marketing consent; service-update consent does not grant marketing consent. Customer/staff account setup WhatsApp notices are sent only when matching operational consent exists. Meta-approved templates and private provider credentials are required.
- **Browser push:** event-driven lifecycle notifications and staff-composed push notifications are sent only to registered subscriptions. Messages are truncated before delivery; expired subscriptions are removed when detected.
- **In-app notifications:** assignment and workflow events can create internal workspace notifications. They are separate from email and do not imply that an email was sent.
- **No automatic invoice/order-status email:** updating an order's dispatch/delivery status does not by itself compose an email. Invoice issuance and payment events have their own triggers above.

Consent and delivery outcomes are handled by the API at send time. An accepted API request does not guarantee delivery by SMTP, Meta, or a browser push provider. Communications delivery records track event, recipient, channel, status, and sanitized error category; they are not a mailbox and do not contain a copy of the message body.

## User onboarding and operational workflows

### Public enquiry and estimator quotation

1. A visitor submits the home-page enquiry form. It creates an enquiry only; it does not create a quotation.
2. A load-estimator submission creates an enquiry with an estimate and quotation workflow data.
3. The customer receives the personalized enquiry acknowledgement; Admin and Super Admin receive an internal copy. Optional WhatsApp confirmation depends on operational consent.
4. Admin follows up with the customer, drafts a message if needed, and can forward the enquiry and note to the Director. Enquiries remain enquiries; they do not have quotation line items unless the enquiry is an estimator request or is linked to a Store order.
5. For estimator work, staff drafts a quotation and submits it for Director approval. The Director approves or rejects it; the decision is sent internally.
6. After approval, Admin can approve the customer profile and provision the customer portal account. The customer receives the setup PIN by email.

### Customer account and sign-in

1. Admin provisions an account only from an eligible Director-approved estimator quotation. The initial four-digit PIN is single-use, expires after 24 hours, and is invalidated after ten incorrect attempts.
2. The customer enters their email and PIN in the customer portal, then chooses a password (12–128 characters). Completing setup verifies the email and clears the initial PIN.
3. Customers can sign in with their password or request a one-use email sign-in link (15-minute expiry). Customer sessions are held in an HTTP-only cookie and expire after seven days.
4. A customer who cannot sign in must contact Admin for a reset PIN. Admin issues it from the approved estimator quotation; this invalidates prior sessions and sign-in links.
5. Signed-in customers can manage their profile, communications consent, equipment, service tickets, and their own invoices/orders. Access to records is scoped to the signed-in customer.

### Staff account and authentication

1. Super Admin creates a staff account and assigns a role/permissions. A setup email contains the staff username and four-digit PIN; the PIN expires after 24 hours and locks after ten incorrect attempts across both staff sign-in and password setup.
2. The staff member enters username/email and PIN on the staff workspace sign-in page. The application recognizes the onboarding PIN and immediately prompts for a new password; there is no public “first-time signup” link.
3. Once onboarded, staff can use a password or switch to a six-digit PIN in their profile after confirming their current credential. PIN entry is optimized for numeric keyboards. Email cannot be changed in the staff profile.
4. “Forgot Password?” emails a one-use reset link to the verified staff email. It expires in 30 minutes; using it sets password authentication and revokes staff sessions. Admin/Super Admin can alternatively resend a four-digit onboarding PIN.
5. Staff sessions use an HTTP-only cookie and expire after seven days. Workspace APIs must check the session and the required permission; hiding a UI control alone is not authorization.

### Store order, invoice, and payment

1. Store checkout creates a pending purchase order, not an invoice. Delivery/logistics is TBD.
2. Director confirms the order; Admin adds delivery/logistics or other agreed lines and issues the invoice.
3. Customer receives the invoice by email; staff can also send the invoice PDF from the workspace.
4. Admin records a payment receipt. It remains pending until Director/Super Admin verifies or rejects it.
5. Verified payments update the invoice to Confirmed or Completed according to the amount paid. The Store order is completed only after payment completion and delivery.

### Service delivery and customer support

1. Customer submits a service ticket from the authenticated portal.
2. Staff triages and assigns the ticket; assigned technical staff receive an internal notification.
3. Authorized technicians acknowledge installations and submit field reports with validated photos. Admin/Director manage release, assignment, and status.
4. Relevant customer and staff notifications are sent through the configured lifecycle channels, subject to recipient resolution and consent/configuration rules.

### Contact groups and batch communications

1. Staff with communications permission create named groups from verified customer accounts.
2. For each newsletter send, the API resolves the selected group and rechecks current channel-specific consent and contact details. Selection in the browser is not treated as consent.
3. Email newsletter messages use BCC batches. WhatsApp newsletters use the approved Meta template and can include one validated image/PDF. Push is sent only to subscribed devices.

## Production setup notes

- Keep SMTP, Meta, and VAPID secrets in the private server configuration outside the web root.
- Use the production migrations for existing databases; migration `011-staff-authentication.sql` adds staff auth type, verified staff email, and one-use reset-token storage. Migration `012-setup-pin-attempt-limit.sql` adds the lifetime failed-attempt counters for four-digit setup/reset PINs. Import each pending migration in phpMyAdmin before using the corresponding features.
- See [`php-cpanel/README_CPANEL_AND_LOCAL_SETUP.md`](php-cpanel/README_CPANEL_AND_LOCAL_SETUP.md) for private configuration, deployment, and integration setup.
