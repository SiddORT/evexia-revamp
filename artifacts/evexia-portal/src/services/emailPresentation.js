// Source-only email presentation mirror of backend email_presentation.py.
// Never substitute samples before choosing a layout or recognizing pristine
// defaults. This module performs no DOM parsing, requests or persistence.
const TITLES = {
  password_recovery: 'Reset your password',
  account_invitation: 'Welcome to the Admin workspace',
  mr_invitation: 'Welcome to the MR portal',
  mr_immunotherapy_placed: 'Immunotherapy order placed',
  order_placed: 'Order placed',
  order_confirmed: 'Order confirmed',
  order_rejected: 'Order rejected',
  order_resubmitted: 'Order resubmitted',
  order_shipped: 'Order shipped',
  order_delivered: 'Order delivered',
  order_returned: 'Order returned',
  order_transaction: 'MR transaction recorded',
};
const PHRASES = {
  order_placed: 'has been placed',
  order_confirmed: 'has been confirmed',
  order_rejected: 'has been rejected',
  order_resubmitted: 'has been resubmitted for review',
  order_shipped: 'has been shipped',
  order_delivered: 'has a recorded delivery',
  order_returned: 'has been returned',
  order_transaction: 'has a recorded MR transaction of INR {{transaction_amount}}',
};

export function orderEmailContent(html, text, eventKey) {
  const phrase = Object.hasOwn(PHRASES, eventKey) ? PHRASES[eventKey] : null;
  const original = '{{company_name}}: {{order_type}} order {{order_number}} ' + phrase +
    '. Placing MR: {{mr_name}}. Status: {{status}}. Recorded: {{timestamp}}.';
  if (!phrase || html !== `<p>${original}</p>` || text !== original) return { html, text };
  const fields = [['Order type', 'order_type'], ['Placing MR', 'mr_name'], ['Status', 'status'], ['Recorded', 'timestamp']];
  if (eventKey === 'order_transaction') fields.push(['MR transaction (INR)', 'transaction_amount']);
  return {
    html: '<h1 style="font-size:26px;line-height:1.3;color:#187368;margin:0 0 24px">{{event_name}}</h1>' +
      '<p style="font-size:13px;color:#5d506d;margin:0">Saved order number</p>' +
      '<p style="font-size:24px;font-weight:bold;line-height:1.4;margin:4px 0 24px;overflow-wrap:anywhere">{{order_number}}</p>' +
      fields.map(([label, name]) => `<p style="margin:0 0 18px"><span style="font-size:13px;color:#5d506d">${label}</span><br><strong>{{${name}}}</strong></p>`).join(''),
    text: '{{company_name}}\n{{event_name}}\nSaved order number: {{order_number}}\n\n' +
      fields.map(([label, name]) => `${label}: {{${name}}}\n`).join(''),
  };
}

// Accept ONLY the already sanitized, unsubstituted output of the preview
// tokenizer. Complete authored cards/logos retain their own design.
export function emailPresentation(content, eventKey) {
  if (/<img\b[^>]*\bsrc="\/images\/evexia-logo\.png"/i.test(content) ||
      /<table\b[^>]*\bstyle="/i.test(content)) return content;
  const title = Object.hasOwn(TITLES, eventKey) ? TITLES[eventKey] : '';
  const heading = title && !/<h1\b/i.test(content)
    ? `<h1 style="font-size:26px;line-height:1.3;color:#187368;margin:0 0 24px">${title}</h1>` : '';
  return '<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f5fa;border-collapse:separate">' +
    '<tr><td align="center" style="padding:24px 12px">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border:1px solid #ddd7e5;border-radius:16px;border-collapse:separate">' +
    '<tr><td style="padding:24px;background-color:#f0eaf5;text-align:center">' +
    '<img src="/images/evexia-logo.png" alt="EVEXIA Life Sciences" width="154" style="display:inline-block;max-width:100%;height:auto">' +
    '<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#5d506d;margin:12px 0 0">EVEXIA LIFE SCIENCES</p></td></tr>' +
    '<tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;color:#28263a;overflow-wrap:anywhere">' +
    heading + content +
    '</td></tr><tr><td style="padding:16px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#5d506d;border:0;background-color:#f7f5fa">' +
    'EVEXIA Life Sciences</td></tr></table></td></tr></table>';
}
