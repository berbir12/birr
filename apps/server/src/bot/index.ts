import { parseAmount, splitMessages } from '@birr/parser';
import { formatEtb, tidyName } from '@birr/shared';
import { Api, Bot, InlineKeyboard, type Context } from 'grammy';
import { revokeIngestSecret, rotateIngestSecret } from '../services/ingestSecret.js';
import { isAllowed, REJECTION_MESSAGE } from '../auth/allowlist.js';
import type { DB } from '../db/client.js';
import type { Env } from '../env.js';
import { ingestBatch, reviewCount, type IngestOutcome } from '../services/ingest.js';
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
}

/** Cards sent individually per paste; the rest are summarised. */
const MAX_CARDS = 10;
const PENDING_EDIT_TTL_MS = 5 * 60 * 1000;

interface PendingEdit {
  txId: number;
  field: EditableField;
  chatId: number;
  cardMessageId: number;
  expires: number;
}

const FIELD_PROMPTS: Record<EditableField, string> = {
  amount: 'Send the correct amount (e.g. 1,250.50).',
  counterpartyName: 'Send the name to show for this transaction.',
  note: 'Send a note. Add #tags anywhere, e.g. “lunch with team #work”.',
};

export function createBot(deps: BotDeps, botConfig?: ConstructorParameters<typeof Bot<BotContext>>[1]) {
  const { db, env, encKey } = deps;
  const bot = new Bot<BotContext>(env.BOT_TOKEN, botConfig);
  const pending = new Map<number, PendingEdit>();

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
    ctx.user = ensureUser(db, from!.id, from!.first_name);
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
        '/undo reverts your last action.',
      ].join('\n'),
      { reply_markup: kb, parse_mode: 'HTML' },
    );
  });

  bot.command('undo', async (ctx) => {
    const what = undoLast(db, ctx.user.id);
    await ctx.reply(what ? `↩️ Undone: ${what}.` : 'Nothing to undo from the last 24 hours.');
  });

  bot.command('connect', async (ctx) => {
    const secret = rotateIngestSecret(db, encKey, ctx.user.id);
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
      'Full guide with screenshots-level detail: SETUP.md in the repo.',
      '',
      '⚠️ Anyone with this token can add transactions to your account. Keep it private and delete this message once set up. ' +
        'Running /connect again issues a new token (the old one keeps working for 1 hour). /disconnect revokes it.',
    ];
    if (!env.PUBLIC_URL.startsWith('https://')) {
      lines.push('', `ℹ️ PUBLIC_URL is ${esc(env.PUBLIC_URL)} — your phone can’t reach that. Deploy, or use a tunnel and set PUBLIC_URL.`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  });

  bot.command('disconnect', async (ctx) => {
    revokeIngestSecret(db, ctx.user.id);
    await ctx.reply('🔌 Forwarding token revoked. Your phone automation will stop working until you run /connect again.');
  });

  // ---------- text: either an answer to an edit prompt, or SMS to ingest ----------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // unknown command

    const p = pending.get(ctx.user.id);
    const looksLikeSms = /^\s*Dear\s/i.test(text);
    if (p && p.expires > Date.now() && !looksLikeSms) {
      pending.delete(ctx.user.id);
      await applyEdit(ctx, p, text);
      return;
    }
    pending.delete(ctx.user.id);

    const parts = splitMessages(text);
    const now = Date.now();
    const outcomes = ingestBatch({ db, encKey }, ctx.user.id, 'bot', parts.map((body) => ({ body, receivedAt: now })));
    logIngest(ctx.user.id, outcomes);
    await sendOutcomes(ctx.api, deps, ctx.user, ctx.chat.id, outcomes, 'paste');
  });

  function logIngest(userId: number, outcomes: IngestOutcome[]) {
    const txIds = outcomes.flatMap((o) => (o.status === 'created' ? [o.txId] : []));
    const rawIds = outcomes.flatMap((o) =>
      o.status === 'created' || (o.status === 'review' && !o.duplicate) ? [o.rawId] : [],
    );
    if (txIds.length || rawIds.length) logAction(db, userId, { action: 'ingest', payload: { txIds, rawIds } });
  }

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
    if (!editTx(db, ctx.user.id, p.txId, p.field, value)) return;
    const t = getTx(db, ctx.user.id, p.txId)!;
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
    const t = getTx(db, uid, txId);
    if (!t) return ctx.answerCallbackQuery({ text: 'Transaction not found.' });

    const redraw = async (footer?: string, kb?: InlineKeyboard) => {
      const fresh = getTx(db, uid, txId)!;
      await ctx
        .editMessageText(cardText(fresh, tz, footer), { parse_mode: 'HTML', reply_markup: kb ?? mainKeyboard(txId) })
        .catch(() => {}); // "message is not modified" is fine
    };

    switch (verb) {
      case 'ok':
        confirmTx(db, uid, txId);
        await redraw(undefined, confirmedKeyboard(txId));
        return ctx.answerCallbackQuery({ text: 'Saved ✅' });

      case 'ed':
        await ctx.editMessageReplyMarkup({ reply_markup: editKeyboard(txId) }).catch(() => {});
        return ctx.answerCallbackQuery();

      case 'ef': {
        const field: EditableField = arg === 'amount' ? 'amount' : arg === 'name' ? 'counterpartyName' : 'note';
        pending.set(uid, {
          txId,
          field,
          chatId: ctx.chat!.id,
          cardMessageId: ctx.callbackQuery.message!.message_id,
          expires: Date.now() + PENDING_EDIT_TTL_MS,
        });
        await ctx.reply(FIELD_PROMPTS[field], { reply_markup: { force_reply: true, selective: true } });
        return ctx.answerCallbackQuery();
      }

      case 'cat': {
        const cats = listCategories(db, uid);
        await ctx.editMessageReplyMarkup({ reply_markup: categoryKeyboard(txId, cats, t.categoryId) }).catch(() => {});
        return ctx.answerCallbackQuery();
      }

      case 'sc': {
        const catId = Number(arg);
        if (!setCategory(db, uid, txId, catId)) return ctx.answerCallbackQuery({ text: 'Unknown category.' });
        const fresh = getTx(db, uid, txId)!;
        if (fresh.counterpartyName) {
          const q = `Always categorize <b>${esc(tidyName(fresh.counterpartyName))}</b> as <b>${esc(fresh.categoryName ?? '')}</b>?`;
          await redraw(q, ruleKeyboard(txId, catId));
        } else {
          await redraw(undefined, confirmedKeyboard(txId));
        }
        return ctx.answerCallbackQuery({ text: `${fresh.categoryIcon ?? ''} ${fresh.categoryName ?? ''}`.trim() });
      }

      case 'ru': {
        const res = createRuleFromTx(db, uid, txId, Number(arg));
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
        softDelete(db, uid, txId);
        await redraw(undefined, deletedKeyboard(txId));
        return ctx.answerCallbackQuery({ text: 'Deleted 🗑' });

      case 'ud':
        restore(db, uid, txId);
        await redraw();
        return ctx.answerCallbackQuery({ text: 'Restored' });

      case 'bk':
        await redraw(undefined, t.confirmedAt ? confirmedKeyboard(txId) : mainKeyboard(txId));
        return ctx.answerCallbackQuery();
    }
  });

  bot.on('callback_query:data', (ctx) => ctx.answerCallbackQuery({ text: 'This button has expired.' }));

  bot.catch((err) => {
    // Never log message bodies: they contain financial data.
    const e = err.error;
    console.error('[bot] error in update', err.ctx.update.update_id, e instanceof Error ? e.message : 'unknown error');
  });

  return bot;
}

export const BOT_COMMANDS = [
  { command: 'start', description: 'Open Birr' },
  { command: 'undo', description: 'Undo the last action' },
  { command: 'connect', description: 'Set up automatic SMS forwarding' },
  { command: 'disconnect', description: 'Stop accepting forwarded SMS' },
];

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
    const t = getTx(db, user.id, o.txId)!;
    await send(cardText(t, user.timezone), { parse_mode: 'HTML', reply_markup: mainKeyboard(t.id) });
  }
  if (created.length > MAX_CARDS) {
    await send(`…and ${created.length - MAX_CARDS} more. Open the app to review them all.`);
  }

  if (mode === 'paste' && outcomes.length <= 3) {
    for (const o of dupes) {
      if (o.status !== 'duplicate') continue;
      const t = o.txId ? getTx(db, user.id, o.txId) : undefined;
      const what = t ? `${formatEtb(t.amount)}${t.counterpartyName ? ` · ${esc(tidyName(t.counterpartyName))}` : ''}` : 'this message';
      await send(o.restored ? `♻️ Restored ${what} (it was deleted).` : `↺ Already recorded: ${what}.`, { parse_mode: 'HTML' });
    }
  }

  if (review.length) {
    const lowConf = review.some((o) => o.status === 'review' && o.reason === 'low_confidence');
    const n = reviewCount(db, user.id);
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
