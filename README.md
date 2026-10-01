# Christopher Davis — GTM automation portfolio

Sales operator turned systems builder. Vancouver, WA.

**Lanes:** Revenue Operations · Sales Operations · Sales Enablement · GTM Systems

**Stack:** Make.com · n8n · Clay · HubSpot · Airtable · Claude · SQL · REST APIs · Webhooks

Public workflows in this repo use **fake data only**. They are not live client systems and are not connected to a real inbox, CRM, or spreadsheet.

---

## Projects (same names as the resume)

### 1. Clay → agent analysis → Airtable → HubSpot GTM loop

**Not in this repo** (production / private architecture — not exportable here).

| | |
|---|---|
| **Problem** | Enrichment, cleanup, scoring, and CRM landing lived in separate tools with handoff risk. |
| **What I built** | Enrich in Clay → agent analysis / dedupe / mapping → score / tier in Airtable → land in HubSpot (custom properties, lifecycle, deal pipeline, GTM dashboard). Own the architecture; audit every handoff. |
| **Status** | Production GTM loop. Case study on request. No workflow JSON in this repo. |

### 2. n8n Lead-Response Router

**In this repo:** [`demo-lead-response/`](demo-lead-response/)

| | |
|---|---|
| **Problem** | After-hours emergencies get lost; spam burns replies; a failed send must not look contacted. |
| **What I built** | Importable n8n workflow: classify emergency / quote / spam, business-hours routing, 24-hour dedupe, Google Sheets logging; mark contacted only after a successful send. Rule-based (no LLM node). |
| **Status** | Public **fake-data** demo. Workflow ships inactive. Import the JSON, wire your own sheet + SMTP credentials, then test — there is no hosted demo URL. |

Fictional shop in sample copy: **Northwind Home Services**. All addresses are `@example.com`.

### 3. Make + Claude lead response (production)

**Not in this repo** (production — not exportable here).

| | |
|---|---|
| **Problem** | Two inbound channels need fast classify/reply without double-sends or marking a lead contacted on send fail. |
| **What I built** | Production Make.com + Claude: EMERGENCY / QUOTE / SPAM, business-hours aware, Airtable logging, owner alerts; spam logged never replied. Hardened before go-live (dual-webhook race, reply-branch dedupe, fail-safe error handlers). |
| **Status** | Production. Case study on request. Scenarios stay private — no Make blueprint in this repo. |

---

## Also in this repo (fake-data demo; not a resume project line)

### n8n Project Intake Ticket

**Folder:** [`demo-project-intake/`](demo-project-intake/)

| | |
|---|---|
| **Problem** | Messy free-text requests need a structured ticket another person can work. |
| **What I built** | Importable n8n workflow: title, priority, requester, category, due window, acceptance criteria, plus a customer-facing summary rewrite. Rule-based (no LLM node). No email send. |
| **Status** | Public **fake-data** demo. Import the JSON — no hosted demo URL. |

---

## How to run the n8n demos

```bash
npm test
```

Rebuild-checks the workflow JSON and runs classification / dedupe / routing / ticket-extraction rules in Node. No n8n, Google, or SMTP required.

To try the clickable path: import the inactive `.workflow.json` from each demo folder into n8n, replace spreadsheet / credential placeholders, leave the workflow inactive until you are ready, then use Manual Trigger or a local webhook-test listen. Details live in each demo’s README.

```text
demo-lead-response/
  cka-lead-response.workflow.json
  README.md
  lib/lead-rules.js
  samples/
  sheets/leads-headers.csv
demo-project-intake/
  cka-project-intake.workflow.json
  README.md
  lib/ticket-rules.js
  samples/
  sheets/tickets-headers.csv
```

Edit a rule in `lib/`, then run `npm run build:workflows`.

---

## What this repo is not

- Not a marketing site
- Not live production credentials or client data
- Not Salesforce Admin proof
- Not hosted webhook URLs — import the JSON
