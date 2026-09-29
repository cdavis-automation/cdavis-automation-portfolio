/**
 * Project-intake rules for the CKA Consulting portfolio demo.
 * One messy request becomes one ticket. The customer rewrite is a single
 * pure function used by one n8n Code node. No LLM and no network calls.
 */

export const RULES_VERSION = '2026-09-29.1';
export const ACCEPTANCE_FALLBACK = 'Requester confirms the original request is complete.';

export const TICKET_COLUMNS = [
  'ticket_id',
  'received_at',
  'requester_name',
  'requester_email',
  'title',
  'priority',
  'category',
  'due_window',
  'acceptance_criteria',
  'summary_owner',
  'summary_customer',
  'raw_text',
  'status',
  'source',
  'error',
  'rules_version',
];

export const TICKET_STATUS = {
  logged: 'logged',
  invalid: 'invalid',
  logFailed: 'log_failed',
};

const P1_TERMS = [
  'urgent',
  'asap',
  'outage',
  'is down',
  'system down',
  'production down',
  'blocked',
  'cant log',
  'cannot log',
  'sev 1',
  'p1',
];

const P2_TERMS = ['this week', 'soon', 'important', 'deadline', 'by friday'];

const CATEGORY_RULES = [
  ['access', ['login', 'log in', 'password', 'sso', 'permission', 'permissions', 'locked out', 'cant log', 'cannot log', 'access']],
  ['billing', ['invoice', 'billing', 'payment', 'refund', 'charge']],
  ['onboarding', ['onboard', 'onboarding', 'kickoff', 'implementation', 'new hire']],
  ['reporting', ['report', 'dashboard', 'metric', 'pipeline', 'forecast']],
  ['bug', ['bug', 'error', 'broken', 'not working', 'fix']],
];

export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasTerm(normalized, term) {
  const needle = normalizeText(term);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(normalized);
}

function simpleHash(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function parseLooseEmail(text) {
  const source = String(text || '');
  const fromLine = source.match(/^from:\s*(.+)$/im);
  let name = '';
  let email = '';
  if (fromLine) {
    const named = fromLine[1].match(/^(.*?)\s*<([^>]+)>/);
    if (named) {
      name = named[1].replace(/["']/g, '').trim();
      email = named[2].trim().toLowerCase();
    } else {
      const loose = fromLine[1].match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
      email = loose ? loose[0].toLowerCase() : '';
    }
  }
  if (!email) {
    const anywhere = source.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    email = anywhere ? anywhere[0].toLowerCase() : '';
  }
  const subjectLine = source.match(/^subject:\s*(.+)$/im);
  const subject = subjectLine ? subjectLine[1].trim() : '';
  const remainder = source
    .replace(/^from:.*$/gim, '')
    .replace(/^subject:.*$/gim, '')
    .trim();
  return { name, email, subject, remainder };
}

export function priorityFor(normalized) {
  if (P1_TERMS.some((term) => hasTerm(normalized, term))) return 'P1';
  if (P2_TERMS.some((term) => hasTerm(normalized, term))) return 'P2';
  return 'P3';
}

export function categoryFor(normalized) {
  for (const [category, terms] of CATEGORY_RULES) {
    if (terms.some((term) => hasTerm(normalized, term))) return category;
  }
  return 'other';
}

export function dueWindowFor(normalized, priority) {
  if (['today', 'eod', 'end of day', 'asap'].some((term) => hasTerm(normalized, term))) {
    return 'today';
  }
  if (['this week', 'by friday', 'next few days'].some((term) => hasTerm(normalized, term))) {
    return 'this_week';
  }
  if (['this month', 'end of month', 'eom'].some((term) => hasTerm(normalized, term))) {
    return 'this_month';
  }
  if (priority === 'P1') return 'today';
  return 'unspecified';
}

export function acceptanceCriteria(text) {
  const parts = String(text || '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const hits = parts.filter((part) =>
    /\b(must|should|need|needs|needed|done when|acceptance|so that)\b/i.test(part),
  );
  const joined = hits.join(' ').replace(/\s+/g, ' ').trim();
  if (!joined) return ACCEPTANCE_FALLBACK;
  return joined.slice(0, 500);
}

function clipTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 90).trim();
}

export function extractTicket(payload, options = {}) {
  let fromName = String(payload.from_name || payload.name || '').trim();
  let fromEmail = String(payload.from_email || payload.email || '').trim().toLowerCase();
  let subject = String(payload.subject || '').trim();
  let body = String(payload.body || payload.message || payload.text || '').trim();

  if (!fromEmail || !subject) {
    const parsed = parseLooseEmail(body);
    fromName = fromName || parsed.name;
    fromEmail = fromEmail || parsed.email;
    subject = subject || parsed.subject;
    if (parsed.subject || parsed.name) body = parsed.remainder || body;
  }

  const content = [subject, body].filter(Boolean).join('\n').slice(0, 5000);
  const normalized = normalizeText(content);
  const priority = priorityFor(normalized);
  const category = categoryFor(normalized);
  const dueWindow = dueWindowFor(normalized, priority);
  const title = clipTitle(subject || body.split(/(?<=[.!?])\s+/)[0] || '');
  const criteria = acceptanceCriteria(content);
  const now = options.now ? new Date(options.now) : new Date();
  const validationErrors = [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
    validationErrors.push('requester email is required');
  }
  if (!content) validationErrors.push('request text is required');

  const ticketId = `tkt_${simpleHash(`${fromEmail}|${title}|${now.toISOString()}`)}`;
  const summaryOwner = title
    ? `[${priority} | ${category} | ${dueWindow}] ${title} — ${fromEmail || 'unknown'}`
    : '';

  return {
    ok: validationErrors.length === 0,
    validation_errors: validationErrors,
    ticket_id: ticketId,
    received_at: now.toISOString(),
    requester_name: fromName,
    requester_email: fromEmail,
    title,
    priority,
    category,
    due_window: dueWindow,
    acceptance_criteria: criteria,
    summary_owner: summaryOwner,
    raw_text: content,
    rules_version: RULES_VERSION,
    status: validationErrors.length ? TICKET_STATUS.invalid : 'extracted',
  };
}

/** One rewrite step: owner bracket summary stays put; this adds the customer paragraph. */
export function rewriteForCustomer(ticket) {
  const duePlain = {
    today: 'today',
    this_week: 'this week',
    this_month: 'this month',
    unspecified: 'the next scheduled review',
  }[ticket.due_window] || 'the next scheduled review';
  const categoryPlain = ticket.category === 'other' ? 'general' : ticket.category;
  const article = /^[aeiou]/i.test(categoryPlain) ? 'an' : 'a';
  const name = ticket.requester_name || 'there';
  const summaryCustomer = [
    `Hi ${name} — we logged "${ticket.title}" as ${article} ${categoryPlain} request.`,
    `We are aiming for ${duePlain}.`,
    `We will treat it as done when: ${ticket.acceptance_criteria}`,
    'This summary is sample copy from a portfolio demo.',
  ].join(' ');

  return {
    ...ticket,
    summary_customer: summaryCustomer,
  };
}
