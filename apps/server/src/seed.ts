/**
 * Seeds ~3 months of realistic fake telebirr + CBE activity for local development.
 *
 *   pnpm seed            # into the local PGlite database (data/pglite)
 *   pnpm seed --reset    # wipe that user's data first
 *
 * SMS are generated in the exact formats of the real (redacted) fixtures and go through the real
 * ingest pipeline, so parsing, categorization rules, reconciliation and transfer linking all run.
 * Balances are consistent except for one deliberately missing SMS, to show a gap.
 * Refuses to run against a postgres:// database (production) — fake data must never reach Supabase.
 */
import { formatEtb } from '@birr/shared';
import { and, eq } from 'drizzle-orm';
import { openDb } from './db/client.js';
import { budgets, categories, rules, transactions, users } from './db/schema.js';
import { loadEnv } from './env.js';
import { ingestBatch, type IngestInput } from './services/ingest.js';
import { ensureUser } from './services/users.js';

const env = loadEnv();
if (env.DATABASE_URL?.startsWith('postgres')) {
  console.error('Refusing to seed a postgres:// database. Seed only the local PGlite dev database (unset DATABASE_URL).');
  process.exit(1);
}
const reset = process.argv.includes('--reset');
const telegramId = env.DEV_AUTH_TELEGRAM_ID ?? env.ALLOWED_TELEGRAM_IDS[0];
if (!telegramId) {
  console.error('Set ALLOWED_TELEGRAM_IDS (or DEV_AUTH_TELEGRAM_ID) in .env first.');
  process.exit(1);
}

// ---------- deterministic randomness ----------
let seed = 20261124;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const round = (cents: number, step: number) => Math.round(cents / step) * step;

// ---------- SMS formats (copied from the real fixtures) ----------
const etb = (c: number) => formatEtb(c).replace('ETB ', '');
const pad = (n: number) => String(n).padStart(2, '0');
const local = (ms: number) => {
  const d = new Date(ms + 3 * 3600_000); // Addis Ababa, UTC+3
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
let refN = 0;
const ref = () => `DK${'ABCDEFGHJKLMNOPQRSTUVWXYZ'[refN % 25]}${(100000 + refN++).toString(36).toUpperCase().padStart(7, '0')}`;
const receipt = () => `v2-Seed${(1000000 + refN++).toString(36)}${'x'.repeat(10)}`.slice(0, 23);

function telebirrFees(amount: number): [number, number] {
  if (amount <= 10000) return [87, 13];
  if (amount <= 50000) return [174, 26];
  if (amount <= 100000) return [348, 52];
  if (amount <= 500000) return [696, 104];
  return [870, 130];
}

const tbTransferOut = (amount: number, name: string, phone4: string, at: number, bal: number, fee: number, vat: number) => {
  const r = ref();
  return `Dear DEV \nYou have transferred ETB ${etb(amount)} to ${name} (2519****${phone4}) on ${local(at)}. Your transaction number is ${r}. The service fee is  ETB ${etb(fee)} and  15% VAT on the service fee is ETB ${etb(vat)}. Your current E-Money Account  balance is ETB ${etb(bal)}. To download your payment information please click this link: https://transactioninfo.ethiotelecom.et/receipt/${r}.\n\nThank you for using telebirr\nEthio telecom`;
};
const tbCashIn = (amount: number, at: number, bal: number) =>
  `Dear DEV\nYour telebirr account  251900001111 has been credited with ETB ${etb(amount)} on ${local(at)} via telebirr agent ${between(10000, 99999)}. Your transaction number is ${ref()}. Your current balance is ETB ${etb(bal)}. \nThank you for using telebirr\nEthio telecom`;
const tbToBank = (amount: number, at: number, bal: number, fee: number, vat: number) => {
  const r = ref();
  return `Dear DEV\nYou have transferred ETB ${etb(amount)} successfully from your telebirr account 251900001111 to Commercial Bank of Ethiopia account number 1000000004321 on ${local(at)}. Your telebirr transaction number is ${r} and your bank transaction number is FT${between(10000000, 99999999)}. The service fee is  ETB ${etb(fee)} and  15% VAT on the service fee is ETB ${etb(vat)}. Your current balance is ETB ${etb(bal)}. To download your payment information please click this link: https://transactioninfo.ethiotelecom.et/receipt/${r}\nThank you for using telebirr\nEthio telecom`;
};
const cbeFoot = () => `Thanks for Banking with CBE. https://mbreciept.cbe.com.et/${receipt()}  for feedback: https://forms.gle/kGNGQpG3mQCCk3iD6`;
const cbeIn = (amount: number, acct4: string, name: string, bal: number) =>
  `Dear Dev User You have received ETB ${etb(amount)} from account 1********${acct4} (${name}) to your account 1********4321. Your current balance is ETB ${etb(bal)}. ${cbeFoot()}`;
const cbeOut = (amount: number, acct4: string, name: string, bal: number) =>
  `Dear Dev User You have successfully transferred ETB ${etb(amount)} from account 1********4321 to account 1********${acct4} (${name}). Service charge of ETB 1.00 and VAT(15%) of ETB 0.15 and Disaster Recovery(5%) of 0.05 with total of ETB ${etb(amount + 120)}. Your current balance is ETB ${etb(bal)}. ${cbeFoot()}`;
const cbeDebit = (amount: number, bal: number) =>
  `Dear Dev User A debit transaction of ETB ${etb(amount)} has occurred on your account 1********4321. Service charge of ETB 10.00 and VAT(15%) of ETB 1.50 and Disaster Recovery(5%) of 0.50 with total of ETB ${etb(amount + 1200)}. Your current balance is ETB ${etb(bal)}. ${cbeFoot()}`;

// ---------- people (all fictional) ----------
const DRIVERS = [['Yonas Tadesse', '4403'], ['Kedir Hussen', '8807'], ['Mekdes Haile', '6605'], ['Samuel Girma', '5504']] as const;
const SHOPS = [['Hanna Grocery', '7712', 'food'], ['Ethio Coffee', '3321', 'food'], ['Selam Pharmacy', '9034', 'health'], ['Lucy Boutique', '1188', 'shopping']] as const;
const RULES: Array<[string, string]> = [
  ...DRIVERS.map(([n]) => [n, 'transport'] as [string, string]),
  ...SHOPS.map(([n, , c]) => [n, c] as [string, string]),
  ['Almaz Tadesse', 'family'],
  ['Kebede Wolde', 'rent'],
  ['Mahber Equb', 'equb'],
  ['Zemen Tech Plc', 'income'],
];

// ---------- simulate ----------
const now = Date.now();
const start = now - 92 * 86400_000;
let tb = 250000; // ETB 2,500.00
let cbe = 4500000; // ETB 45,000.00
const telebirrSms: IngestInput[] = [];
const cbeSms: IngestInput[] = [];
let skipped = false;

const addTb = (body: string, at: number) => telebirrSms.push({ body, sender: '127', receivedAt: at + 4000 });
const addCbe = (body: string, at: number) => cbeSms.push({ body, sender: 'CBE', receivedAt: at });

/** One day's events are scheduled first, then applied in time order so every balance chains. */
type Event = { at: number; run: () => void };

for (let day = 0; day < 92; day++) {
  const dayStart = start + day * 86400_000;
  // Local (UTC+3) midnight of that day, then h:m local.
  const midnight = dayStart - ((dayStart + 3 * 3600_000) % 86400_000);
  const at = (h: number, m = between(0, 59)) => midnight + h * 3600_000 + m * 60_000 + between(0, 59) * 1000;
  if (at(23, 59) > now) break;
  const date = new Date(midnight + 12 * 3600_000 + 3 * 3600_000);
  const dom = date.getUTCDate();
  const dow = date.getUTCDay();
  const events: Event[] = [];

  // Salary on the 25th (CBE), rent on the 1st.
  if (dom === 25) {
    const t = at(9, 5);
    events.push({ at: t, run: () => ((cbe += 4800000), addCbe(cbeIn(4800000, '7001', 'Zemen Tech Plc', cbe), t)) });
  }
  if (dom === 1) {
    const t = at(10, 15);
    events.push({ at: t, run: () => ((cbe -= 1200000 + 120), addCbe(cbeOut(1200000, '2290', 'Kebede Wolde', cbe), t)) });
  }
  // Monthly move from telebirr to CBE (an internal transfer pair) on the 10th.
  if (dom === 10) {
    const t = at(18, 2);
    events.push({
      at: t,
      run: () => {
        const amt = 200000;
        const [fee, vat] = telebirrFees(amt);
        if (tb < amt + fee + vat) return;
        tb -= amt + fee + vat;
        addTb(tbToBank(amt, t, tb, fee, vat), t);
        cbe += amt;
        addCbe(cbeIn(amt, '1111', 'Dev User', cbe), t + 90_000);
      },
    });
  }
  // ATM withdrawal now and then.
  if (rand() < 0.08) {
    const amt = pick([100000, 200000, 300000]);
    const t = at(between(8, 19));
    events.push({ at: t, run: () => ((cbe -= amt + 1200), addCbe(cbeDebit(amt, cbe), t)) });
  }
  // Weekly agent cash-in (and whenever the wallet runs low) keeps telebirr topped up.
  const cashIn = round(between(300000, 700000), 10000);
  const cashInAt = at(8, 30);
  events.push({
    at: cashInAt,
    run: () => {
      if (dow !== 1 && tb >= 80000) return;
      tb += cashIn;
      addTb(tbCashIn(cashIn, cashInAt, tb), cashInAt);
    },
  });
  // Equb every Sunday, family support twice a month, daily taxis and shopping.
  const spends: Array<[number, string, string]> = [];
  if (dow === 0) spends.push([100000, 'Mahber Equb', '5150']);
  if (dom === 5 || dom === 20) spends.push([round(between(150000, 300000), 5000), 'Almaz Tadesse', '2207']);
  for (let k = between(1, 3); k > 0; k--) {
    const [n, p4] = pick(DRIVERS);
    spends.push([round(between(1500, 12000), 500), n, p4]);
  }
  if (rand() < 0.6) {
    const [n, p4] = pick(SHOPS);
    spends.push([round(between(8000, 90000), 500), n, p4]);
  }
  for (const [amt, name, p4] of spends) {
    const t = at(between(9, 21));
    events.push({
      at: t,
      run: () => {
        const [fee, vat] = telebirrFees(amt);
        if (tb < amt + fee + vat) return;
        tb -= amt + fee + vat;
        // Leave one SMS out ~6 weeks ago so the app can show "possible missing SMS".
        if (!skipped && day === 50) {
          skipped = true;
          return;
        }
        addTb(tbTransferOut(amt, name, p4, t, tb, fee, vat), t);
      },
    });
  }
  events.sort((a, b) => a.at - b.at).forEach((e) => e.run());
}

// A couple of messages Birr can't read yet → review queue.
const review: IngestInput[] = [
  { sender: '127', receivedAt: now - 3 * 86400_000, body: 'Dear DEV, you have bought 1GB data package for ETB 50.00 on telebirr. Thank you for using telebirr. Ethio telecom' },
  { sender: 'CBE', receivedAt: now - 86400_000, body: 'Dear Dev User, your account 1********4321 has been credited with ETB 1,250.00 (interest). Thanks for Banking with CBE.' },
];

// ---------- write ----------
const handle = await openDb(env.DATABASE_URL);
await handle.migrate();
const db = handle.db;
const encKey = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');

const [existing] = await db.select().from(users).where(eq(users.telegramId, telegramId));
if (existing) {
  const has = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, existing.id)).limit(1);
  if (has.length && !reset) {
    console.error('That user already has data. Run with --reset to replace it with fresh seed data.');
    process.exit(1);
  }
  if (reset) await db.delete(users).where(eq(users.id, existing.id));
}
const user = await ensureUser(db, telegramId, 'Dev');

const cats = new Map((await db.select().from(categories).where(eq(categories.userId, user.id))).map((c) => [c.key, c.id]));
await db.insert(rules).values(RULES.map(([name, key]) => ({ userId: user.id, field: 'counterparty_name' as const, pattern: name.toLowerCase(), categoryId: cats.get(key)! })));
await db.insert(budgets).values(
  ([['food', 800000], ['transport', 300000], ['shopping', 200000], ['health', 100000]] as const).map(([k, amount]) => ({
    userId: user.id,
    categoryId: cats.get(k)!,
    amount,
  })),
);

const out = [
  ...(await ingestBatch({ db, encKey }, user.id, 'import', telebirrSms)),
  ...(await ingestBatch({ db, encKey }, user.id, 'webhook', cbeSms)),
  ...(await ingestBatch({ db, encKey }, user.id, 'bot', review)),
];
const created = out.filter((o) => o.status === 'created').length;
const gaps = await db.select().from(transactions).where(and(eq(transactions.userId, user.id), eq(transactions.reconciliation, 'gap')));
const linked = await db.select().from(transactions).where(and(eq(transactions.userId, user.id)));
console.log(
  `Seeded Telegram user ${telegramId}: ${created} transactions, ${out.filter((o) => o.status === 'review').length} for review, ` +
    `${gaps.length} gap, ${linked.filter((t) => t.transferGroupId).length / 2} internal transfers.`,
);
console.log(`Balances: telebirr ${formatEtb(tb)}, CBE ${formatEtb(cbe)}`);
await handle.close();
