import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeXmlEntities, parseCsv, parseImportFile, parseLooseDate } from './import.js';
import { parseSms } from './index.js';

const FIX = join(import.meta.dirname, '../fixtures/sms');
const sms = (p: string) => readFileSync(join(FIX, p), 'utf8');

const xmlAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#10;');

describe('SMS Backup & Restore XML', () => {
  const tb = sms('telebirr/t11_transfer_out.txt');
  const cbe = sms('cbe/c05_transfer_out.txt');
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<!--File Created By SMS Backup & Restore v10.20.002-->
<smses count="4" backup_set="x" backup_date="1795564800000" type="full">
  <sms protocol="0" address="127" date="1795541480000" type="1" subject="null" body="${xmlAttr(tb)}" toa="null" sc_toa="null" service_center="null" read="1" status="-1" locked="0" date_sent="0" sub_id="1" readable_date="24 Nov 2026 20:31:20" contact_name="(Unknown)" />
  <sms protocol="0" address="CBE" date="1795500000000" type="1" subject="null" body="${xmlAttr(cbe)}" read="1" status="-1" />
  <sms protocol="0" address="+251911000000" date="1795500000001" type="2" body="Sent by me" read="1" status="-1" />
  <sms protocol="0" address="+251922000000" date="1795500000002" type="1" body="Selam! See you at 7 &gt; ok?" read="1" status="-1" />
</smses>`;

  it('extracts received messages with sender, exact body and timestamp', () => {
    const { format, entries } = parseImportFile('sms-20261124.xml', xml);
    expect(format).toBe('xml');
    expect(entries).toHaveLength(3); // the sent one is skipped
    expect(entries[0]).toEqual({ sender: '127', body: tb, receivedAt: 1795541480000 });
    expect(entries[1]!.sender).toBe('CBE');
    expect(entries[1]!.body).toBe(cbe);
    expect(entries[2]!.body).toBe('Selam! See you at 7 > ok?');
  });

  it('round-trips into the parser exactly like the original SMS', () => {
    const { entries } = parseImportFile('backup.xml', xml);
    const r = parseSms({ sender: entries[0]!.sender, body: entries[0]!.body });
    expect(r.ok && r.tx.amount).toBe(550000);
  });

  it('decodes numeric and named entities', () => {
    expect(decodeXmlEntities('a&#10;b &amp; &#x1F600; &quot;q&quot; &#4608;')).toBe('a\nb & 😀 "q" ሀ');
  });
});

describe('CSV exports', () => {
  it('reads an iMazing-style export with quoted multi-line bodies', () => {
    const body = sms('telebirr/t01_transfer_out.txt');
    const csv = [
      '"Chat Session","Message Date","Service","Type","Sender ID","Text"',
      `"127","2026-11-23 18:46:37","SMS","Incoming","127","${body.replace(/"/g, '""')}"`,
      '"Mom","2026-11-23 19:00:00","SMS","Incoming","+251911000000","Call me, ""please"""',
    ].join('\r\n');
    const { format, entries } = parseImportFile('messages.csv', csv);
    expect(format).toBe('csv');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ sender: '127', body, receivedAt: Date.parse('2026-11-23T18:46:37+03:00') });
    expect(entries[1]!.body).toBe('Call me, "please"');
  });

  it('handles semicolon separators and unix timestamps', () => {
    const csv = 'address;date;body\n127;1795541480000;Dear X hello telebirr\nCBE;1795541480;Dear Y CBE';
    const { entries } = parseImportFile('export.csv', csv);
    expect(entries.map((e) => e.receivedAt)).toEqual([1795541480000, 1795541480000]);
  });

  it('returns nothing when there is no recognisable body column', () => {
    expect(parseImportFile('x.csv', 'a,b\n1,2').entries).toEqual([]);
  });

  it('parseCsv keeps empty fields and embedded newlines', () => {
    expect(parseCsv('a,b,c\n1,,"x\ny"\n')).toEqual([['a', 'b', 'c'], ['1', '', 'x\ny']]);
  });
});

describe('TXT', () => {
  it('splits like a bot paste', () => {
    const txt = [sms('cbe/c01_transfer_in.txt'), sms('cbe/c02_transfer_out.txt'), sms('telebirr/t03_transfer_out.txt')].join('\n\n');
    const { format, entries } = parseImportFile('notes.txt', txt);
    expect(format).toBe('txt');
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.receivedAt === null && e.sender === null)).toBe(true);
  });
});

describe('parseLooseDate', () => {
  it.each([
    ['2026-11-23 18:46:37', Date.parse('2026-11-23T18:46:37+03:00')],
    ['2026-11-23T15:46:37Z', Date.parse('2026-11-23T15:46:37Z')],
    ['1795541480', 1795541480000],
    ['23/11/2026 18:46', Date.parse('2026-11-23T18:46:00+03:00')],
    ['', null],
    ['yesterday', null],
  ])('%s', (input, expected) => expect(parseLooseDate(input)).toBe(expected));
});
