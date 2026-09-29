/**
 * Lead-response rules for the CKA Consulting portfolio demo.
 * Transparent and local: no LLM and no network calls.
 * The n8n Code nodes are generated from this file. Keep status strings here
 * so the canvas and the tests cannot drift.
 *
 * Classification order (first match wins):
 * 1. SPAM terms → SPAM (logged, never replied to)
 * 2. EMERGENCY terms → EMERGENCY
 * 3. QUOTE terms → QUOTE
 * 4. Anything else that is a valid lead → QUOTE (polite ack, intent_rule default_quote_no_keyword)
 *
 * Business hours: Monday–Friday, 08:00 inclusive to 17:00 exclusive, America/Chicago.
 * Dedupe: same email + normalized message within DEDUPE_HOURS.
 * contacted=true only when a quote auto-reply send succeeds.
 */

export const RULES_VERSION = '2026-09-29.1';
export const ALLOW_DEMO_CLOCK = true;
export const BUSINESS_TZ = 'America/Chicago';
export const BUSINESS_START_HOUR = 8;
export const BUSINESS_END_HOUR = 17;
export const DEDUPE_HOURS = 24;
export const OWNER_ALERT_EMAIL = 'owner@example.com';
export const DISPATCH_FROM_EMAIL = 'dispatch@example.com';
export const DEMO_BRAND = 'Northwind Home Services';

export const LEAD_COLUMNS = [
  'lead_id',
  'received_at',
  'name',
  'email',
  'phone',
  'message',
  'message_normalized',
  'intent',
  'intent_rule',
  'business_hours',
  'dedupe_key',
  'dedupe_hours',
  'status',
  'contacted',
  'action_taken',
  'error',
  'duplicate_of',
  'source',
  'rules_version',
];

export const STATUS = {
  invalid: 'invalid',
  dedupeCheckFailed: 'dedupe_check_failed',
  duplicateSuppressed: 'duplicate_suppressed',
  received: 'received',
  queuedInHours: 'queued_in_hours',
  spamLogged: 'spam_logged',
  ownerAlerted: 'owner_alerted',
  ownerAlertFailed: 'owner_alert_failed',
  ownerAlertedSheetUpdateFailed: 'owner_alerted_sheet_update_failed',
  replySent: 'reply_sent',
  replyFailed: 'reply_failed',
  replySentSheetUpdateFailed: 'reply_sent_sheet_update_failed',
  logFailed: 'log_failed',
  unrouted: 'unrouted',
};

export const ACTION = {
  rejectInvalid: 'reject_invalid',
  failClosedNoSend: 'fail_closed_no_send',
  suppressDuplicate: 'suppress_duplicate',
  queueForOwner: 'queue_for_owner',
  logOnly: 'log_only',
  alertOwnerPending: 'alert_owner_pending',
  alertOwner: 'alert_owner',
  alertOwnerFailed: 'alert_owner_failed',
  quoteReplyPending: 'quote_reply_pending',
  quoteAutoReply: 'quote_auto_reply',
  quoteAutoReplyFailed: 'quote_auto_reply_failed',
  logFailedNoSend: 'log_failed_no_send',
  unroutedNoSend: 'unrouted_no_send',
};

export const EMERGENCY_TERMS = [
  'emergency',
  'urgent',
  'asap',
  'right now',
  'no heat',
  'no hot water',
  'no power',
  'power out',
  'flood',
  'flooding',
  'leak',
  'burst',
  'gas smell',
  'smell gas',
  'sewage',
  'sewer backup',
  'sparking',
  'locked out',
  'carbon monoxide',
  'smoke',
  'fire',
];

export const SPAM_TERMS = [
  'unsubscribe',
  'seo service',
  'search engine optimization',
  'backlink',
  'guest post',
  'crypto',
  'bitcoin',
  'viagra',
  'casino',
  'lottery',
  'you have won',
  'limited time offer',
  'click here',
  'buy now',
  'work from home',
  'increase your sales',
  'lead generation service',
];

export const QUOTE_TERMS = [
  'quote',
  'estimate',
  'pricing',
  'price',
  'how much',
  'bid',
  'schedule',
  'appointment',
  'install',
  'replace',
  'availability',
];

export function normalizeMessage(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasTerm(normalized, term) {
  const needle = normalizeMessage(term);
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(normalized);
}

export function hasAnyTerm(normalized, terms) {
  return terms.some((term) => hasTerm(normalized, term));
}

export function simpleHash(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function businessHours(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  const inHours = !weekend && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
  return inHours ? 'in_hours' : 'after_hours';
}

function resolveNow(payload, options) {
  if (payload.demo_received_at && ALLOW_DEMO_CLOCK && options.allowDemoClock !== false) {
    const parsed = new Date(payload.demo_received_at);
    if (!Number.isNaN(parsed.getTime())) {
      return { now: parsed, demoClock: true };
    }
  }
  const now = options.now ? new Date(options.now) : new Date();
  return { now, demoClock: false };
}

export function classifyLead(payload, options = {}) {
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const phone = String(payload.phone || '').trim();
  const message = String(payload.message || '').trim();
  const messageNormalized = normalizeMessage(message);
  const validationErrors = [];

  if (!name) validationErrors.push('name is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) validationErrors.push('valid email is required');
  if (!message) validationErrors.push('message is required');

  let intent = 'QUOTE';
  let intentRule = 'default_quote_no_keyword';
  if (hasAnyTerm(messageNormalized, SPAM_TERMS)) {
    intent = 'SPAM';
    intentRule = 'spam_term';
  } else if (hasAnyTerm(messageNormalized, EMERGENCY_TERMS)) {
    intent = 'EMERGENCY';
    intentRule = 'emergency_term';
  } else if (hasAnyTerm(messageNormalized, QUOTE_TERMS)) {
    intent = 'QUOTE';
    intentRule = 'quote_term';
  }

  const { now, demoClock } = resolveNow(payload, options);
  const hours = businessHours(now);
  const leadId = `lead_${simpleHash(`${email}|${messageNormalized}|${now.toISOString()}`)}`;

  return {
    ok: validationErrors.length === 0,
    validation_errors: validationErrors,
    lead_id: leadId,
    received_at: now.toISOString(),
    name,
    email,
    phone,
    message,
    message_normalized: messageNormalized,
    intent,
    intent_rule: intentRule,
    business_tz: BUSINESS_TZ,
    business_hours: hours,
    dedupe_key: `${email}|${simpleHash(messageNormalized)}`,
    dedupe_hours: DEDUPE_HOURS,
    demo_clock: demoClock,
    rules_version: RULES_VERSION,
    contacted: false,
    status: validationErrors.length ? STATUS.invalid : STATUS.received,
  };
}

/**
 * Same email and the same normalized message inside the dedupe window.
 * A matching row with an unparseable received_at counts as a duplicate
 * so a clock-format glitch cannot double-send.
 * Returns the earlier lead_id, or '' when the lead is new.
 */
export function findDuplicate(lead, rows) {
  const windowMs = Number(lead.dedupe_hours || DEDUPE_HOURS) * 60 * 60 * 1000;
  const now = Date.parse(lead.received_at);
  for (const row of rows || []) {
    const email = String(row.email || '').trim().toLowerCase();
    const message = String(row.message_normalized || '');
    if (!email || email !== lead.email) continue;
    if (message !== lead.message_normalized) continue;
    const seenAt = Date.parse(row.received_at);
    if (Number.isNaN(seenAt) || Number.isNaN(now)) return String(row.lead_id || 'unknown');
    const age = now - seenAt;
    if (age >= 0 && age <= windowMs) return String(row.lead_id || 'unknown');
  }
  return '';
}

/**
 * Business decision for one lead. The n8n canvas implements this table.
 * sheetUpdate=failed covers a successful send whose sheet status write failed.
 * contacted stays false unless a quote reply send succeeded.
 */
export function routeLead({
  lead,
  sheetsAvailable = true,
  isDuplicate = false,
  sendResult = 'pending',
  sheetUpdate = 'ok',
}) {
  if (!lead.ok) {
    return {
      status: STATUS.invalid,
      contacted: false,
      action: ACTION.rejectInvalid,
      send: null,
      http: 400,
    };
  }
  if (!sheetsAvailable) {
    return {
      status: STATUS.dedupeCheckFailed,
      contacted: false,
      action: ACTION.failClosedNoSend,
      send: null,
      http: 503,
    };
  }
  if (isDuplicate) {
    return {
      status: STATUS.duplicateSuppressed,
      contacted: false,
      action: ACTION.suppressDuplicate,
      send: null,
      http: 200,
    };
  }
  if (lead.intent === 'SPAM') {
    return {
      status: STATUS.spamLogged,
      contacted: false,
      action: ACTION.logOnly,
      send: null,
      http: 200,
    };
  }
  if (lead.intent === 'EMERGENCY' && lead.business_hours === 'in_hours') {
    return {
      status: STATUS.queuedInHours,
      contacted: false,
      action: ACTION.queueForOwner,
      send: null,
      http: 200,
    };
  }
  if (lead.intent === 'EMERGENCY') {
    if (sendResult === 'success' && sheetUpdate === 'failed') {
      return {
        status: STATUS.ownerAlertedSheetUpdateFailed,
        contacted: false,
        action: ACTION.alertOwner,
        send: 'owner',
        http: 200,
      };
    }
    if (sendResult === 'success') {
      return {
        status: STATUS.ownerAlerted,
        contacted: false,
        action: ACTION.alertOwner,
        send: 'owner',
        http: 200,
      };
    }
    if (sendResult === 'error') {
      return {
        status: STATUS.ownerAlertFailed,
        contacted: false,
        action: ACTION.alertOwnerFailed,
        send: 'owner',
        http: 200,
      };
    }
    return {
      status: STATUS.received,
      contacted: false,
      action: ACTION.alertOwnerPending,
      send: 'owner',
      http: 200,
    };
  }
  if (lead.intent === 'QUOTE') {
    if (sendResult === 'success' && sheetUpdate === 'failed') {
      return {
        status: STATUS.replySentSheetUpdateFailed,
        contacted: true,
        action: ACTION.quoteAutoReply,
        send: 'customer',
        http: 200,
      };
    }
    if (sendResult === 'success') {
      return {
        status: STATUS.replySent,
        contacted: true,
        action: ACTION.quoteAutoReply,
        send: 'customer',
        http: 200,
      };
    }
    if (sendResult === 'error') {
      return {
        status: STATUS.replyFailed,
        contacted: false,
        action: ACTION.quoteAutoReplyFailed,
        send: 'customer',
        http: 200,
      };
    }
    return {
      status: STATUS.received,
      contacted: false,
      action: ACTION.quoteReplyPending,
      send: 'customer',
      http: 200,
    };
  }
  return {
    status: STATUS.unrouted,
    contacted: false,
    action: ACTION.unroutedNoSend,
    send: null,
    http: 200,
  };
}

export function logFailedOutcome() {
  return {
    status: STATUS.logFailed,
    contacted: false,
    action: ACTION.logFailedNoSend,
    send: null,
    http: 502,
  };
}

export function buildQuoteEmail(lead) {
  return {
    from: DISPATCH_FROM_EMAIL,
    to: lead.email,
    subject: `We received your request (${lead.lead_id})`,
    text: [
      `Hi ${lead.name},`,
      '',
      `Thanks for contacting ${DEMO_BRAND}. We logged your request and a person will follow up with a quote during business hours (Monday–Friday, 8:00–17:00 ${BUSINESS_TZ}).`,
      '',
      `Reference: ${lead.lead_id}`,
      '',
      'This message is sample copy from a portfolio demo. It is not a live customer-service system.',
      '',
      `— ${DEMO_BRAND} dispatch`,
    ].join('\n'),
  };
}

export function buildOwnerAlert(lead) {
  return {
    from: DISPATCH_FROM_EMAIL,
    to: OWNER_ALERT_EMAIL,
    subject: `[AFTER HOURS EMERGENCY] ${lead.name} (${lead.lead_id})`,
    text: [
      'After-hours emergency lead. The customer was not auto-replied.',
      '',
      `Lead: ${lead.lead_id}`,
      `Name: ${lead.name}`,
      `Email: ${lead.email}`,
      `Phone: ${lead.phone || '(none)'}`,
      `Received: ${lead.received_at}`,
      `Hours: ${lead.business_hours} (${BUSINESS_TZ})`,
      '',
      lead.message,
      '',
      `Portfolio demo alert. Placeholder recipient ${OWNER_ALERT_EMAIL}.`,
    ].join('\n'),
  };
}
