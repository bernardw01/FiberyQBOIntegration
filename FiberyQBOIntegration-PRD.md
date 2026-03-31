# Fibery → QuickBooks Online Invoice Integration — PRD

## Change Log

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-03-31 | Bernard + Claude | Initial draft — architecture, data mapping, schema changes, user flow, phased implementation plan, open questions |

---

## 1. Overview

Enable users to create a QuickBooks Online (QBO) invoice directly from a **Revenue Item** (Revenue Milestone) in Fibery's Agreement Management space by clicking a Button. The button triggers a JavaScript automation that sends the relevant data to QBO via a Make.com webhook, which handles OAuth and invoice creation.

## 2. Problem Statement

Currently, when a Revenue Milestone is ready to be invoiced, users must manually re-enter invoice details into QuickBooks Online. This is error-prone, time-consuming, and creates a disconnect between the agreement management system (Fibery) and the accounting system (QBO).

## 3. Goals

- **One-click invoicing**: User clicks a button on a Revenue Item → invoice appears in QBO
- **Data accuracy**: Invoice fields populated directly from Fibery data — no manual re-entry
- **Status tracking**: Revenue Item workflow state updates to reflect invoicing status
- **Simplicity**: Minimal moving parts; leverage existing Make.com integration for QBO auth

## 4. Architecture

```
┌─────────────────────┐     HTTP POST      ┌─────────────┐    QBO API     ┌─────────┐
│  Fibery Button      │ ──────────────────► │  Make.com   │ ────────────► │  QBO    │
│  (JS Automation)    │   (webhook + JSON)  │  Scenario   │               │ Invoice │
│  on Revenue Item    │ ◄────────────────── │             │               │         │
└─────────────────────┘    response/status  └─────────────┘               └─────────┘
```

### Why Make.com as middleware?
- **OAuth 2.0 management**: QBO requires OAuth with token refresh — Make.com handles this natively via its QBO connector
- **Already in use**: Make.com is already connected to this workspace
- **Error handling & logging**: Make.com provides execution history, retry, and error notifications
- **No infrastructure to manage**: No servers, no deployments

### Alternative considered: Direct QBO API from Fibery JS
- Rejected: Fibery's JS automation environment cannot securely store/refresh OAuth tokens, and has limited HTTP capabilities for the full QBO auth flow

## 5. Data Mapping — Fibery → QBO Invoice

### Source: Revenue Item (and related entities)

| Fibery Field | Source | QBO Invoice Field | Notes |
|---|---|---|---|
| `Agreement.Customer.Name` | Company name via Agreement | `CustomerRef` | Must match an existing QBO Customer (or create) |
| `Milestone Title` | Revenue Item | `Line[0].Description` | Invoice line item description |
| `Target Amount` | Revenue Item | `Line[0].Amount` | Invoice line item amount |
| `Target Date` | Revenue Item | `TxnDate` | Invoice date |
| `Agreement.Name` | Agreement | `CustomField` or `PrivateNote` | Reference back to the agreement |
| `Revenue Item.Name` | Revenue Item (formula) | `Line[0].Description` prefix | Full context: "Agreement - Milestone" |
| `Agreement.Contact.Email` | Contact via Agreement | `BillEmail` | Invoice delivery email |

### Open Questions — Data Mapping
- [ ] **QBO Customer matching**: How should we match Fibery `Companies` to QBO Customers? By exact name? Should we store a `QBO Customer ID` on the Company entity?
- [ ] **QBO Item/Service**: Does a specific QBO Item/Service need to be referenced on the line item, or is a generic "Consulting Services" line acceptable?
- [ ] **Tax handling**: Should the invoice include tax? If so, which QBO tax code?
- [ ] **Payment terms**: What Net terms (Net 30, Net 60, etc.) should be set? Per-agreement or global default?
- [ ] **Invoice numbering**: Let QBO auto-number, or derive from Fibery public-id?
- [ ] **Multiple line items**: Should one invoice support multiple Revenue Items, or is it always 1:1?

## 6. User Flow

### Happy Path
1. User navigates to a Revenue Item in Fibery
2. User clicks **"Create QBO Invoice"** button
3. Fibery JS automation:
   a. Validates required fields are populated (Customer, Target Amount, etc.)
   b. Collects data from Revenue Item + related Agreement + Company
   c. POSTs JSON payload to Make.com webhook URL
   d. Receives response (success + QBO Invoice ID)
   e. Updates Revenue Item workflow state → **"Invoiced"**
   f. Optionally stores QBO Invoice ID/URL on the Revenue Item or Invoice Request
4. User sees confirmation (state change + optional toast/notification)

### Error Scenarios
- **Missing required fields** → Button shows validation error before sending
- **QBO Customer not found** → Make.com returns error; Fibery shows message to user
- **Duplicate invoice** → Guard against double-click / re-invoicing already-invoiced items
- **Make.com / QBO down** → Graceful error message; user can retry

## 7. Fibery Schema Changes Needed

| Change | Database | Field | Type | Purpose |
|---|---|---|---|---|
| Add | Companies | `QBO Customer ID` | Text | Store QBO Customer reference for matching |
| Add | Revenue Item | `QBO Invoice ID` | Text | Store created QBO Invoice ID |
| Add | Revenue Item | `QBO Invoice URL` | Text (URL) | Deep link to invoice in QBO |
| Add | Revenue Item | `Invoice Error` | Text | Store last error message if creation failed |
| Existing | Revenue Item | `workflow/state` | Workflow | Use existing "Invoiced" state |
| Button | Revenue Item | "Create QBO Invoice" | Button | Triggers the JS automation |

## 8. Make.com Scenario Design

### Webhook Trigger
- Custom webhook endpoint
- Receives JSON payload with all invoice data

### Scenario Steps
1. **Webhook** — receive payload
2. **Validate payload** — check required fields present
3. **Lookup QBO Customer** — by `QBO Customer ID` or by name
4. **(Optional) Create QBO Customer** — if not found and flag allows it
5. **Create QBO Invoice** — map fields from payload
6. **Return response** — QBO Invoice ID + URL back to Fibery webhook response

### Payload Schema (Fibery → Make.com)

```json
{
  "fiberyRevenueItemId": "uuid",
  "customerName": "Acme Corp",
  "qboCustomerId": "123",
  "milestoneTitle": "Phase 1 Delivery",
  "revenueItemName": "Acme Consulting - Phase 1 Delivery",
  "amount": 25000.00,
  "invoiceDate": "2026-03-31",
  "agreementName": "Acme Consulting",
  "contactEmail": "billing@acme.com",
  "memo": "Agreement: Acme Consulting | Milestone: Phase 1 Delivery"
}
```

## 9. Fibery JavaScript Automation (Button Script)

### Responsibilities
- Fetch Revenue Item + related Agreement + Company + Contact data via Fibery API
- Validate required fields
- POST to Make.com webhook
- Handle response (update state, store QBO ID, or show error)

### Technical Constraints
- Fibery JS automations run in a sandboxed environment
- `fetch()` / `http` available for outbound HTTP calls
- Can read/write entity fields via the Fibery API context
- Limited execution time (timeout ~30s)

## 10. Requirements Checklist

### Must Have (P0)
- [ ] Button on Revenue Item triggers invoice creation in QBO
- [ ] Invoice populated with: Customer, Amount, Description, Date
- [ ] Revenue Item state updated to "Invoiced" on success
- [ ] QBO Invoice ID stored on Revenue Item
- [ ] Validation prevents invoicing without required data
- [ ] Guard against duplicate invoice creation (don't re-invoice "Invoiced" items)

### Should Have (P1)
- [ ] QBO Customer ID stored on Fibery Company for reliable matching
- [ ] Error message displayed/stored when creation fails
- [ ] QBO Invoice URL stored for quick navigation
- [ ] Invoice Request entity created/linked automatically
- [ ] Contact email passed as BillEmail on the QBO invoice

### Nice to Have (P2)
- [ ] Batch invoicing: select multiple Revenue Items → create multiple invoices
- [ ] Auto-create QBO Customer if not found
- [ ] Invoice PDF attached back to Revenue Item in Fibery
- [ ] Slack notification on successful invoice creation
- [ ] Support for multiple line items per invoice (multiple Revenue Items → one invoice)

## 11. Open Questions & Decisions Needed

1. **QBO Customer Matching Strategy** — exact name match, stored ID, or both?
2. **QBO Item/Service for line items** — specific product/service, or generic?
3. **Tax & Payment Terms** — defaults vs. per-agreement configuration?
4. **Invoice Request workflow** — should clicking the button also create/update an Invoice Request entity, or is that a separate concern?
5. **Who can click the button?** — any Fibery user, or restricted to certain roles?
6. **QBO Sandbox vs. Production** — do we have a QBO sandbox for testing?
7. **Make.com plan limits** — any concerns about operations/month quota?

## 12. Implementation Phases

### Phase 1: Foundation
- Add new fields to Fibery schema (QBO Customer ID, QBO Invoice ID, etc.)
- Set up Make.com scenario with QBO connection
- Build & test webhook payload/response contract

### Phase 2: Core Integration
- Write Fibery JS automation (button script)
- Wire up Make.com scenario to create QBO invoice
- Test end-to-end with QBO sandbox

### Phase 3: Polish & Guardrails
- Add validation & error handling
- Duplicate prevention logic
- Store QBO Invoice URL, update workflow states
- User testing & feedback

### Phase 4: Enhancements (P1/P2 items)
- Batch invoicing
- Auto-create QBO customers
- Slack notifications
- Invoice PDF attachment
