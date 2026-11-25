/**
 * Reads SMS export files into { sender, body, receivedAt } entries for the ingest pipeline.
 *
 *  - XML: "SMS Backup & Restore" (Android) — <sms address=".." date="<unix ms>" body=".." type="1" />
 *  - CSV: any export with a header row; columns are recognised by name (body/text/message, sender/address/from,
 *         date/time). Covers iMazing-style exports from iPhone backups.
 *  - TXT: pasted/plain text; split on "Dear …" like a bot paste. No timestamps (telebirr SMS carry their own).
 *
 * Pure (no I/O); the caller filters to relevant senders with detectSource.
 */
import { parseSmsDate } from './date.js';
import { splitMessages } from './split.js';

export interface ImportEntry {
  sender: string | null;
  body: string;
  /** Unix ms, or null when the file has no timestamp for this message. */
  receivedAt: number | null;
}

export type ImportFormat = 'xml' | 'csv' | 'txt';

export function detectFormat(fileName: string, content: string): ImportFormat {
  const ext = fileName.toLowerCase().split('.').pop();
  const head = content.slice(0, 500).trimStart();
  if (ext === 'xml' || head.startsWith('<?xml') || head.startsWith('<smses')) return 'xml';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  return 'txt';
}

export function parseImportFile(fileName: string, content: string): { format: ImportFormat; entries: ImportEntry[] } {
  const text = content.replace(/^﻿/, ''); // BOM
  const format = detectFormat(fileName, text);
  const entries = format === 'xml' ? parseSmsBackupXml(text) : format === 'csv' ? parseCsvExport(text) : parseTxt(text);
  return { format, entries: entries.filter((e) => e.body.trim() !== '') };
}

// ---------------- XML (SMS Backup & Restore) ----------------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    out[m[1]!] = decodeXmlEntities(m[3] ?? m[4] ?? '');
  }
  return out;
}

export function parseSmsBackupXml(xml: string): ImportEntry[] {
  const entries: ImportEntry[] = [];
  // <sms .../> or <sms ...></sms>. Attribute values never contain a raw '>' after escaping, but
  // some exporters leave '>' unescaped inside quotes, so match quoted strings explicitly.
  for (const m of xml.matchAll(/<sms\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g)) {
    const a = attributes(m[1]!);
    // type 1 = received. Sent messages (2) and drafts are never bank/wallet notifications.
    if (a.type && a.type !== '1') continue;
    const date = Number(a.date);
    entries.push({
      sender: a.address?.trim() || null,
      body: a.body ?? '',
      receivedAt: Number.isFinite(date) && date > 0 ? date : null,
    });
  }
  return entries;
}

// ---------------- CSV ----------------

/** RFC 4180-ish CSV parser: quotes, escaped quotes, newlines inside quotes, , or ; or tab separators. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
  const sep = [',', ';', '\t'].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const BODY_COL = /^(body|text|message|message text|content|sms|msg)$/i;
const SENDER_COL = /^(address|sender|from|sender id|sender name|number|phone|contact|chat session|originator)$/i;
const DATE_COL = /(^date$|date ?time|received|message date|^time(stamp)?$|^sent$)/i;

/** Unix s/ms, ISO 8601, "YYYY-MM-DD HH:mm[:ss]" (local EAT), or dd/mm/yyyy formats. */
export function parseLooseDate(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  if (/^\d{13}$/.test(s)) return Number(s);
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (local) {
    const [, y, mo, d, h, mi, se = '00'] = local;
    return Date.parse(`${y}-${mo}-${d}T${h!.padStart(2, '0')}:${mi}:${se}+03:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  const sms = parseSmsDate(s.replace(/,/g, ''));
  return sms ? Date.parse(sms) : null;
}

export function parseCsvExport(text: string): ImportEntry[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim());
  const bodyIdx = header.findIndex((h) => BODY_COL.test(h));
  if (bodyIdx === -1) return [];
  const senderIdx = header.findIndex((h) => SENDER_COL.test(h));
  const dateIdx = header.findIndex((h) => DATE_COL.test(h));
  return rows.slice(1).map((r) => ({
    sender: senderIdx >= 0 ? r[senderIdx]?.trim() || null : null,
    body: r[bodyIdx] ?? '',
    receivedAt: dateIdx >= 0 ? parseLooseDate(r[dateIdx] ?? '') : null,
  }));
}

// ---------------- TXT ----------------

export function parseTxt(text: string): ImportEntry[] {
  return splitMessages(text).map((body) => ({ sender: null, body, receivedAt: null }));
}
