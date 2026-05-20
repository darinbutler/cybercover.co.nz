import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';

const WORKER_URL    = process.env.WORKER_URL!;
const WORKER_SECRET = process.env.WORKER_SECRET!;
const SITE_ID       = process.env.SITE_ID!;
const REDIRECT_URL  = process.env.REDIRECT_URL ?? '/thank-you';

function redirectPath() {
  try { return new URL(REDIRECT_URL).pathname || '/thank-you/'; }
  catch { return REDIRECT_URL; }
}

const CORE_FIELDS = new Set([
  'name', 'firstName', 'first_name', 'lastName', 'last_name',
  'email', 'phone', 'tel',
]);
const META_FIELDS = new Set([
  '_subject', '_honey', '_honeypot', '_next',
  'cfTurnstileToken', 'cf-turnstile-response',
]);
const RESERVED_FIELDS = new Set([...CORE_FIELDS, ...META_FIELDS]);

function parseName(raw: Record<string, string>) {
  const first    = (raw['firstName'] || raw['first_name'] || '').trim();
  const last     = (raw['lastName']  || raw['last_name']  || '').trim();
  const combined = (raw['name']      || '').trim();

  if (first || last) {
    return { firstName: first, lastName: last, fullName: `${first} ${last}`.trim() };
  }
  if (combined) {
    const parts = combined.split(/\s+/);
    return { firstName: parts[0], lastName: parts.slice(1).join(' '), fullName: combined };
  }
  return { firstName: '', lastName: '', fullName: '' };
}

function parseExtraFields(raw: Record<string, string>) {
  return Object.entries(raw)
    .filter(([key, value]) => !RESERVED_FIELDS.has(key) && value.trim())
    .map(([key, value]) => ({
      key,
      label: key
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, c => c.toUpperCase()),
      value: value.trim(),
    }));
}

function validate(raw: Record<string, string>): string | null {
  if (!raw.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email)) {
    return 'Invalid email address';
  }
  const name = raw.name || raw.firstName || raw.first_name || '';
  if (!name.trim()) return 'Name is required';
  return null;
}

export async function POST(request: NextRequest) {
  let raw: Record<string, string> = {};

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    raw = await request.json();
  } else {
    const formData = await request.formData();
    formData.forEach((value, key) => {
      if (typeof value === 'string') raw[key] = value;
    });
  }

  const wantsJson = contentType.includes('application/json');

  if (raw['_honey'] || raw['_honeypot']) {
    return wantsJson
      ? NextResponse.json({ ok: true, redirect: redirectPath() })
      : NextResponse.redirect(new URL(redirectPath(), request.url), 302);
  }

  const error = validate(raw);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const payload = {
    siteId:  SITE_ID,
    name:    parseName(raw),
    email:   (raw['email'] || '').trim(),
    phone:   (raw['phone'] || raw['tel'] || '').trim(),
    subject: (raw['_subject'] || 'New Insurance Lead').trim(),
    extra:   parseExtraFields(raw),
    cfTurnstileToken: (raw['cfTurnstileToken'] || raw['cf-turnstile-response'] || '').trim(),
  };

  const body      = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', WORKER_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  try {
    const res = await fetch(WORKER_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature':  signature,
        'X-Timestamp':  timestamp,
      },
      body,
    });

    if (!res.ok) {
      console.error('Worker error:', res.status, await res.text());
      return NextResponse.json({ error: 'Submission failed' }, { status: 502 });
    }
  } catch (err) {
    console.error('Worker unreachable:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  return wantsJson
    ? NextResponse.json({ ok: true, redirect: redirectPath() })
    : NextResponse.redirect(new URL(redirectPath(), request.url), 302);
}
