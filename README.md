# CKA Consulting — automation portfolio

Public n8n demos for **Chris Davis / CKA Consulting**. These workflows are **portfolio pieces built on fake data**. They are not live client systems, and they are not connected to a real inbox, CRM, or spreadsheet.

I also ship production systems on Make.

## Resume bullets

Lead response:

> Built an n8n lead-response router that classifies inbound leads (emergency, quote, or spam), applies business-hours routing and 24-hour dedupe, logs every lead to Google Sheets, and marks a lead contacted only after a successful send.

Project intake:

> Built an n8n project-intake workflow that turns messy free-text requests into structured tickets (title, priority, requester, category, due window, acceptance criteria) and rewrites a customer-facing summary in one step.

## Demos

| Demo | Workflow name in n8n | Folder | Public URL placeholder |
| --- | --- | --- | --- |
| Lead response | `CKA Demo — Lead Response Router` | [`demo-lead-response/`](demo-lead-response/) | `https://YOUR_N8N_HOST/webhook/cka-demo-lead-response` |
| Project intake | `CKA Demo — Project Intake Ticket` | [`demo-project-intake/`](demo-project-intake/) | `https://YOUR_N8N_HOST/webhook/cka-demo-project-intake` |

Both workflow files ship **inactive** (`"active": false`). Import them, replace the placeholders, and execute a sample before you ever activate a webhook.

People, phone numbers, and the shop name in the sample copy (**Northwind Home Services**) are fictional. Every address is `@example.com`.

## What you can run without accounts

`npm test` rebuild-checks the workflow JSON and runs the classification, dedupe, routing, and ticket-extraction rules in Node. That does not need n8n, Google, or SMTP.

The n8n import adds the part a reviewer can click: webhooks, Google Sheets nodes, and SMTP nodes, all pointed at placeholder credential names.

## Layout

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

Edit a rule in `lib/`, then run `npm run build:workflows`. The Code nodes in the JSON are generated from those files.
