import { parseAmount, splitMessages } from '@birr/parser';
import { formatEtb, tidyName } from '@birr/shared';
import { Api, Bot, InlineKeyboard, type Context } from 'grammy';
import { isAllowed, REJECTION_MESSAGE } from '../auth/allowlist.js';
import type { DB } from '../db/client.js';
import type { Env } from '../env.js';
import { clearPendingEdit, setPendingEdit, takePendingEdit, type PendingEdit } from '../services/botState.js';
import { ingestBatch, reviewCount, type IngestOutcome } from '../services/ingest.js';
import { revokeIngestSecret, rotateIngestSecret } from '../services/ingestSecret.js';
import {
  confirmTx,
  createRuleFromTx,
  editTx,
  getTx,
  listCategories,
  logAction,
  restore,
  setCategory,
  softDelete,
  undoLast,
  type EditableField,
} from '../services/transactions.js';
import { ensureUser, type User } from '../services/users.js';
import { dueBudgetAlerts } from '../services/plan.js';
import { cancelImport, commitImport, ImportError, previewImport, type ImportSummary } from '../services/importer.js';
import { transactions } from '../db/schema.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  cardText,
  categoryKeyboard,
  confirmedKeyboard,
  deletedKeyboard,
  editKeyboard,
  esc,
  mainKeyboard,
  ruleKeyboard,
} from './cards.js';

export type BotContext = Context & { user: User };

export interface BotDeps {
  db: DB;
  env: Env;
  encKey: Buffer;
  /** Downloads a Telegram file by file_path. Injectable for tests. */
  downloadFile?: (filePath: string) => Promise<Buffer>;
}

/** Telegram bots can download files up to 20 MB. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMPORTABLE = /\.(xml|csv|tsv|txt)$/i;

/** SMS exports are UTF-8, but some CSV tools write UTF-16 with a BOM. */
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  return buf.toString('utf8');
}

const fmtDay = (ms: number, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(ms);
const n = (x: number) => x.toLocaleString('en-US');

export function importPreviewText(s: ImportSummary, tz: string): string {
  const lines = [
    `📦 <b>${esc(s.fileName)}</b>`,
    `${n(s.inFile)} message${s.inFile === 1 ? '' : 's'} in the file · ${n(s.relevant)} from telebirr/CBE` +
      (s.relevant ? ` (telebirr ${n(s.bySource.telebirr)} · CBE ${n(s.bySource.cbe)})` : ''),
  ];
  if (s.from !== null && s.to !== null) lines.push(`📅 ${fmtDay(s.from, tz)} – ${fmtDay(s.to, tz)}`);
  lines.push('', `✅ ${n(s.created)} new · ↺ ${n(s.duplicates)} already recorded · 🔍 ${n(s.review)} for review`);
  return lines.join('\n');
}

/** Cards sent individually per paste; the rest are summarised. */
const MAX_CARDS = 10;

const FIELD_PROMPTS: Record<EditableField, string> = {
  amount: 'Send the correct amount (e.g. 1,250.50).',
  counterpartyName: 'Send the name to show for this transaction.',
  note: 'Send a note. Add #tags anywhere, e.g. “lunch with team #work”.',
};

export function createBot(deps: BotDeps, botConfig?: ConstructorParameters<typeof Bot<BotContext>>[1]) {
  const { db, env, encKey } = deps;
  const bot = new Bot<BotContext>(env.BOT_TOKEN, botConfig);

  const tzOf = (ctx: BotContext) => ctx.user.timezone;

  // Allowlist gate: runs before every handler. Private chats only.
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!isAllowed(from?.id, env.ALLOWED_TELEGRAM_IDS)) {
      if (ctx.chat?.type === 'private') await ctx.reply(REJECTION_MESSAGE).catch(() => {});
      else if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    if (ctx.chat && ctx.chat.type !== 'private') return;
    ctx.user = await ensureUser(db, from!.id, from!.first_name);
    await next();
  });

  bot.command('start', async (ctx) => {
    const kb = new InlineKeyboard().webApp('📊 Open Birr', env.MINIAPP_URL);
    await ctx.reply(
      [
        `Selam ${esc(ctx.user.firstName ?? '')} 👋`,
        '',
        'Forward or paste your <b>telebirr (127)</b> and <b>CBE</b> SMS here — one or many at once — and I’ll record them.',
        'Each one gets a card where you can fix the category, edit or delete it.',
        '',
        '/connect sets up automatic forwarding from your phone. /undo reverts your last action.',
      ].join('\n'),
      { reply_markup: kb, parse_mode: 'HTML' },
    );
  });

  bot.command('undo', async (ctx) => {
    const what = await undoLast(db, ctx.user.id);
    await ctx.reply(what ? `↩️ Undone: ${what}.` : 'Nothing to undo from the last 24 hours.');
  });

  bot.command('connect', async (ctx) => {
    const secret = await rotateIngestSecret(db, encKey, ctx.user.id);
    const url = `${env.PUBLIC_URL}/ingest/sms`;
    const lines = [
      '🔗 <b>Automatic SMS forwarding</b>',
      '',
      `URL: <code>${esc(url)}</code>`,
      `Token: <code>${esc(secret)}</code>`,
      '',
      '<b>iPhone (Shortcuts → Automation → New → Message)</b>',
      '1. Message Contains: <code>telebirr</code> → Run Immediately',
      '2. Action <b>Get Contents of URL</b>: the URL above, Method <b>POST</b>',
      `3. Header <code>Authorization</code> = <code>Bearer ${esc(secret)}</code>`,
      '4. Request Body <b>JSON</b>: <code>body</code> = Shortcut Input › Content, <code>sender</code> = Shortcut Input › Sender',
      '5. Repeat with Message Contains: <code>CBE</code>',
      '',
      'Full step-by-step guide: SETUP.md in the repo.',
      '',
      '⚠️ Anyone with this token can add transactions to your account. Keep it private and delete this message once set up. ' +
        'Running /connect again issues a new token (the old one keeps working for 1 hour). /disconnect revokes it.',
    ];
    if (!env.PUBLIC_URL.startsWith('https://')) {
      lines.push('', `ℹ️ PUBLIC_URL is ${esc(env.PUBLIC_URL)} — your phone can’t reach that. Deploy first and set PUBLIC_URL.`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  });

  bot.command('disconnect', async (ctx) => {
    await revokeIngestSecret(db, ctx.user.id);
    await ctx.reply('🔌 Forwarding token revoked. Your phone automation will stop working until you run /connect again.');
  });

  // ---------- text: either an answer to an edit prompt, or SMS to ingest ----------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // unknown command

    const looksLikeSms = /^\s*Dear\s/i.test(text);
    const p = await takePendingEdit(db, ctx.user.id);
    if (p && !looksLikeSms) {
      await applyEdit(ctx, p, text);
      return;
    }

    const parts = splitMessages(text);
    const now = Date.now();
    const outcomes = await ingestBatch({ db, encKey }, ctx.user.id, 'bot', parts.map((body) => ({ body, receivedAt: now })));
    await logIngest(db, ctx.user.id, outcomes);
    await sendOutcomes(ctx.api, deps, ctx.user, ctx.chat.id, outcomes, 'paste');
  });

  // ---------- bulk import: send a backup file ----------
  const download =
    deps.downloadFile ??
    (async (filePath: string) => {
      const res = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    });

  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const name = doc.file_name ?? 'file';
    if (!IMPORTABLE.test(name) && !doc.mime_type?.startsWith('text/')) {
      await ctx.reply('Send an SMS export as .xml (SMS Backup & Restore), .csv or .txt to import it.');
      return;
    }
    if ((doc.file_size ?? 0) > MAX_FILE_BYTES) {
      await ctx.reply('That file is over 20 MB, the most Telegram lets bots download. Export only telebirr (127) and CBE conversations, or split it.');
      return;
    }
    await ctx.replyWithChatAction('typing').catch(() => {});
    const file = await ctx.getFile();
    const content = decodeText(await download(file.file_path!));

    let preview;
    try {
      preview = await previewImport({ db, encKey }, ctx.user.id, name, content);
    } catch (e) {
      if (e instanceof ImportError) return void (await ctx.reply(e.message));
      throw e;
    }
    const { importId, summary } = preview;
    const text = importPreviewText(summary, tzOf(ctx));
    if (!summary.created && !summary.review) {
      await cancelImport(db, ctx.user.id, importId);
      await ctx.reply(`${text}\n\nNothing new to import.`, { parse_mode: 'HTML' });
      return;
    }
    const kb = new InlineKeyboard()
      .text(`📥 Import ${n(summary.created + summary.review)}`, `imp:${importId}`)
      .text('✖ Cancel', `impx:${importId}`);
    await ctx.reply(`${text}\n\nNothing is saved until you tap Import.`, { parse_mode: 'HTML', reply_markup: kb });
  });

  bot.callbackQuery(/^imp(x?):(\d+)$/, async (ctx) => {
    const [, cancel, idStr] = ctx.match as RegExpMatchArray;
    const importId = Number(idStr);
    if (cancel) {
      await cancelImport(db, ctx.user.id, importId);
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.reply('Import cancelled. Nothing was saved.');
      return ctx.answerCallbackQuery();
    }
    await ctx.answerCallbackQuery({ text: 'Importing…' });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    let result;
    try {
      result = await commitImport({ db, encKey }, ctx.user.id, importId);
    } catch (e) {
      if (e instanceof ImportError) return void (await ctx.reply(e.message));
      throw e;
    }
    await logIngest(db, ctx.user.id, result.outcomes);
    const createdIds = result.outcomes.flatMap((o) => (o.status === 'created' ? [o.txId] : []));
    const { gaps, linked } = await importFindings(db, ctx.user.id, createdIds);
    const lines = [
      `✅ Imported ${n(result.counts.created)} transaction${result.counts.created === 1 ? '' : 's'}` +
        (result.counts.review ? ` · 🔍 ${n(result.counts.review)} for review` : '') +
        (result.counts.duplicates ? ` · ↺ ${n(result.counts.duplicates)} already recorded` : ''),
    ];
    if (linked) lines.push(`🔁 ${n(linked)} internal transfer${linked === 1 ? '' : 's'} between your accounts (not counted as spending)`);
    if (gaps) lines.push(`⚠️ ${n(gaps)} place${gaps === 1 ? '' : 's'} where the balance doesn’t add up: probably missing SMS`);
    lines.push('', 'Open the app to browse them. /undo removes this whole import.');
    await ctx.reply(lines.join('\n'), { reply_markup: new InlineKeyboard().webApp('📊 Open Birr', env.MINIAPP_URL) });
  });

  async function applyEdit(ctx: BotContext, p: PendingEdit, text: string) {
    let value: string | number = text;
    if (p.field === 'amount') {
      const cents = parseAmount(text);
      if (cents === null || cents <= 0) {
        await ctx.reply('That isn’t an amount I understand. Tap Edit → Amount to try again.');
        return;
      }
      value = cents;
    }
    if (!(await editTx(db, ctx.user.id, p.txId, p.field, value))) return;
    const t = (await getTx(db, ctx.user.id, p.txId))!;
    await ctx.api
      .editMessageText(p.chatId, p.cardMessageId, cardText(t, tzOf(ctx)), {
        parse_mode: 'HTML',
        reply_markup: confirmedKeyboard(t.id),
      })
      .catch(() => {});
    await ctx.reply('✏️ Updated.');
  }

  // ---------- inline buttons ----------
  bot.callbackQuery(/^(ok|ed|ef|cat|sc|ru|nr|del|ud|bk):(\d+)(?::(\w+))?$/, async (ctx) => {
    const [, verb, idStr, arg] = ctx.match as RegExpMatchArray;
    const txId = Number(idStr);
    const uid = ctx.user.id;
    const tz = tzOf(ctx);
    const t = await getTx(db, uid, txId);
    if (!t) return ctx.answerCallbackQuery({ text: 'Transaction not found.' });

    const redraw = async (footer?: string, kb?: InlineKeyboard) => {
      const fresh = (await getTx(db, uid, txId))!;
      await ctx
        .editMessageText(cardText(fresh, tz, footer), { parse_mode: 'HTML', reply_markup: kb ?? mainKeyboard(txId) })
        .catch(() => {}); // "message is not modified" is fine
    };

    switch (verb) {
      case 'ok':
        await confirmTx(db, uid, txId);
        await redraw(undefined, confirmedKeyboard(txId));
        return ctx.answerCallbackQuery({ text: 'Saved ✅' });

      case 'ed':
        await ctx.editMessageReplyMarkup({ reply_markup: editKeyboard(txId) }).catch(() => {});
        return ctx.answerCallbackQuery();

      case 'ef': {
        const field: EditableField = arg === 'amount' ? 'amount' : arg === 'name' ? 'counterpartyName' : 'note';
        await setPendingEdit(db, uid, {
          txId,
          field,
          chatId: ctx.chat!.id,
          cardMessageId: ctx.callbackQuery.message!.message_id,
        });
        await ctx.reply(FIELD_PROMPTS[field], { reply_markup: { force_reply: true, selective: true } });
        return ctx.answerCallbackQuery();
      }

      case 'cat': {
        const cats = await listCategories(db, uid);
        await ctx.editMessageReplyMarkup({ reply_markup: categoryKeyboard(txId, cats, t.categoryId) }).catch(() => {});
        return ctx.answerCallbackQuery();
      }

      case 'sc': {
        const catId = Number(arg);
        if (!(await setCategory(db, uid, txId, catId))) return ctx.answerCallbackQuery({ text: 'Unknown category.' });
        const fresh = (await getTx(db, uid, txId))!;
        if (fresh.counterpartyName) {
          const q = `Always categorize <b>${esc(tidyName(fresh.counterpartyName))}</b> as <b>${esc(fresh.categoryName ?? '')}</b>?`;
          await redraw(q, ruleKeyboard(txId, catId));
        } else {
          await redraw(undefined, confirmedKeyboard(txId));
        }
        return ctx.answerCallbackQuery({ text: `${fresh.categoryIcon ?? ''} ${fresh.categoryName ?? ''}`.trim() });
      }

      case 'ru': {
        const res = await createRuleFromTx(db, uid, txId, Number(arg));
        await redraw(undefined, confirmedKeyboard(txId));
        return ctx.answerCallbackQuery({
          text: res
            ? `Rule saved${res.updated ? ` · ${res.updated} past transaction${res.updated === 1 ? '' : 's'} updated` : ''}`
            : 'Could not save a rule for this one.',
        });
      }

      case 'nr':
        await redraw(undefined, confirmedKeyboard(txId));
        return ctx.answerCallbackQuery();

      case 'del':
        await clearPendingEdit(db, uid);
        await softDelete(db, uid, txId);
        await redraw(undefined, deletedKeyboard(txId));
        return ctx.answerCallbackQuery({ text: 'Deleted 🗑' });

      case 'ud':
        await restore(db, uid, txId);
        await redraw();
        return ctx.answerCallbackQuery({ text: 'Restored' });

      case 'bk':
        await redraw(undefined, t.confirmedAt ? confirmedKeyboard(txId) : mainKeyboard(txId));
        return ctx.answerCallbackQuery();
    }
  });

  bot.on('callback_query:data', (ctx) => ctx.answerCallbackQuery({ text: 'This button has expired.' }));

  bot.catch((err) => {
    // Never log messages verbatim: SMS text and DB errors (which embed query parameters such as
    // amounts and names) are financial data. Log only the error class and code.
    const e = err.error as (Error & { code?: string; cause?: { code?: string } }) | undefined;
    const code = e?.code ?? e?.cause?.code ?? '';
    console.error(`[bot] update ${err.ctx.update.update_id} failed: ${e?.name ?? 'Error'}${code ? ` (${code})` : ''}`);
  });

  return bot;
}

export const BOT_COMMANDS = [
  { command: 'start', description: 'Open Birr' },
  { command: 'undo', description: 'Undo the last action' },
  { command: 'connect', description: 'Set up automatic SMS forwarding' },
  { command: 'disconnect', description: 'Stop accepting forwarded SMS' },
];

/** Among freshly imported transactions: how many sit after a balance gap, and how many got linked. */
export async function importFindings(db: DB, userId: number, txIds: readonly number[]): Promise<{ gaps: number; linked: number }> {
  let gaps = 0;
  let linked = 0;
  for (let i = 0; i < txIds.length; i += 1000) {
    const part = txIds.slice(i, i + 1000);
    const [row] = await db
      .select({
        gaps: sql<number>`count(*) filter (where ${transactions.reconciliation} = 'gap')::int`,
        linked: sql<number>`count(distinct ${transactions.transferGroupId})::int`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, part)));
    gaps += row?.gaps ?? 0;
    linked += row?.linked ?? 0;
  }
  return { gaps, linked };
}

/** Records an ingest in the action log so /undo can remove it. */
export async function logIngest(db: DB, userId: number, outcomes: IngestOutcome[]): Promise<void> {
  const txIds = outcomes.flatMap((o) => (o.status === 'created' ? [o.txId] : []));
  const rawIds = outcomes.flatMap((o) => (o.status === 'created' || (o.status === 'review' && !o.duplicate) ? [o.rawId] : []));
  if (txIds.length || rawIds.length) await logAction(db, userId, { action: 'ingest', payload: { txIds, rawIds } });
}

/**
 * Replies to an ingest: a summary for batches, a card per new transaction, notes for duplicates
 * and review items. Webhook deliveries stay quiet about duplicates and non-SMS, since phone
 * automations may fire twice or on unrelated messages.
 */
export async function sendOutcomes(
  api: Api,
  deps: BotDeps,
  user: User,
  chatId: number,
  outcomes: IngestOutcome[],
  mode: 'paste' | 'webhook',
): Promise<void> {
  const { db, env } = deps;
  const send = (text: string, other?: Parameters<Api['sendMessage']>[2]) => api.sendMessage(chatId, text, other);
  const created = outcomes.filter((o) => o.status === 'created');
  const dupes = outcomes.filter((o) => o.status === 'duplicate');
  const review = outcomes.filter((o) => o.status === 'review' && !(mode === 'webhook' && o.duplicate));
  const ignored = outcomes.filter((o) => o.status === 'ignored');

  if (outcomes.length === ignored.length) {
    if (mode === 'paste') {
      await send('That doesn’t look like a telebirr or CBE transaction SMS. Paste the full message (starting with “Dear …”).');
    }
    return;
  }

  if (outcomes.length > 1) {
    const bits = [
      `${created.length} recorded`,
      dupes.length && `${dupes.length} already recorded`,
      review.length && `${review.length} to review`,
      ignored.length && `${ignored.length} skipped`,
    ].filter(Boolean);
    await send(`📥 ${bits.join(' · ')}`);
  }

  for (const o of created.slice(0, MAX_CARDS)) {
    const t = (await getTx(db, user.id, o.txId))!;
    await send(cardText(t, user.timezone), { parse_mode: 'HTML', reply_markup: mainKeyboard(t.id) });
  }
  if (created.length > MAX_CARDS) {
    await send(`…and ${created.length - MAX_CARDS} more. Open the app to review them all.`);
  }

  if (mode === 'paste' && outcomes.length <= 3) {
    for (const o of dupes) {
      if (o.status !== 'duplicate') continue;
      const t = o.txId ? await getTx(db, user.id, o.txId) : undefined;
      const what = t ? `${formatEtb(t.amount)}${t.counterpartyName ? ` · ${esc(tidyName(t.counterpartyName))}` : ''}` : 'this message';
      await send(o.restored ? `♻️ Restored ${what} (it was deleted).` : `↺ Already recorded: ${what}.`, { parse_mode: 'HTML' });
    }
  }

  if (created.length) {
    for (const msg of await dueBudgetAlerts(db, user)) await send(msg, { parse_mode: 'HTML' });
  }

  if (review.length) {
    const lowConf = review.some((o) => o.status === 'review' && o.reason === 'low_confidence');
    const n = await reviewCount(db, user.id);
    await send(
      (lowConf
        ? '⚠️ I read a message but its numbers don’t add up, so I didn’t record it.'
        : '🔍 I couldn’t read a message in a format I know yet.') + ` It’s in the review queue (${n} waiting).`,
      { reply_markup: new InlineKeyboard().webApp('Open review queue', `${env.MINIAPP_URL}#/review`) },
    );
  }
}

/** Notifier the webhook route uses to post cards into the user's private chat. */
export function makeNotifier(api: Api, deps: BotDeps) {
  return (user: User, outcomes: IngestOutcome[]) => sendOutcomes(api, deps, user, user.telegramId, outcomes, 'webhook');
}
