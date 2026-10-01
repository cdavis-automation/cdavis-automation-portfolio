# Christopher Davis — GTM automation portfolio

Sales operator turned systems builder · Vancouver, WA

**Focus:** Revenue Operations · Sales Operations · Sales Enablement · GTM Systems

**Tools:** Make.com · n8n · Clay · HubSpot · Airtable · Claude · SQL · REST APIs · Webhooks

Workflows in this repo use fictional sample data only.

---

## Clay → agent analysis → Airtable → HubSpot GTM loop

Production system (not published as exportable JSON).

Built an end-to-end GTM handoff: enrich in Clay, clean and map with agent workflows, score and tier in Airtable, then land contacts in HubSpot with custom properties, lifecycle stages, a deal pipeline, and a GTM dashboard. Case study available on request.

## n8n Lead-Response Router

Folder: [`demo-lead-response/`](demo-lead-response/)

Classifies inbound leads as emergency, quote, or spam; routes by business hours; dedupes for 24 hours; logs to Google Sheets; marks a lead contacted only after a successful send. Rules-based demo (no LLM node). Sample shop in the fixtures: Northwind Home Services (`@example.com`).

Import the inactive workflow JSON into n8n to review or run locally. There is no public hosted demo URL.

## Make + Claude lead response

Production system (blueprint not published here).

Two-channel classify-and-reply with business-hours awareness, Airtable logging, and owner alerts. Spam is logged and never answered. Hardened before go-live for race conditions, reply-branch dedupe, and failed-send safety. Case study available on request.

## n8n Project Intake Ticket

Folder: [`demo-project-intake/`](demo-project-intake/)

Turns messy free-text requests into structured tickets (title, priority, requester, category, due window, acceptance criteria) plus a short customer-facing summary. Fake data; import the JSON to try it locally.

---

## Run the demos

```bash
npm test
```

Checks the workflow JSON and runs the classification / ticket rules in Node without n8n, Google, or SMTP.

To open the workflows in n8n: import the inactive `.workflow.json` from each demo folder and follow that folder’s README for sheet headers and credentials.
