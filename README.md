# Fibery → QuickBooks Online Invoice Integration

One-click invoice creation from Fibery's Agreement Management workspace into QuickBooks Online.

## What This Does

When a Revenue Milestone (Revenue Item) in Fibery is ready to be invoiced, a user clicks a button and an invoice is automatically created in QuickBooks Online — no manual data re-entry required. The integration pulls customer, amount, and milestone details directly from Fibery, creates the invoice in QBO via a Make.com webhook, and writes the invoice number and status back to Fibery.

## How It Works

1. **Fibery Button** on a Revenue Item triggers a JavaScript automation
2. **JS Automation** validates data, collects fields from the Revenue Item, Agreement, and Company, then POSTs to a Make.com webhook
3. **Make.com Scenario** handles QBO OAuth and calls the QuickBooks Online API to create the invoice
4. **Response flows back** — QBO Invoice ID, number, and URL are stored on the Revenue Item, and an Invoice Request entity is created in Fibery to track status

## Key Components

| Component | Role |
|---|---|
| **Fibery** (Agreement Management) | Source of truth for agreements, milestones, and customers |
| **Make.com** | Middleware — manages QBO OAuth, executes invoice creation, returns results |
| **QuickBooks Online** | Accounting system where invoices are created |

## Documentation

- [Product Requirements Document (PRD)](FiberyQBOIntegration-PRD.md) — architecture, data mapping, decisions, sequence diagrams, and implementation plan
