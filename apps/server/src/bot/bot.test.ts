import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { rules, transactions } from '../db/schema.js';
import { loadEnv } from '../env.js';
import { useTestDb } from '../test/db.js';
import { createBot } from './index.js';

const FIX = join(import.meta.dirname, '../../../../packages/parser/fixtures/sms');
const sms = (p: string) => readFileSync(join(FIX, p), 'utf8');
const all = (dir: string) => readdirSync(join(FIX, dir)).filter((f) => f.endsWith('.txt')).sort().map((f) => sms(`${dir}/${f}`));
const CBE_ALL = all('cbe');
const TB_ALL = all('telebirr');

const env = loadEnv({
  BOT_TOKEN: '123456:TEST-token-abcdefghijklmnopqrstuvwxyz',
  ALLOWED_TELEGRAM_IDS: '42',
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

interface Call {
  method: string;
  payload: Record<string, any>;
}

const tdb = useTestDb();

const files = new Map<string, Buffer>();

function setup() {
  const db = tdb.db;
  const bot = createBot(
    { db, env, encKey: randomBytes(32), downloadFile: async (p) => files.get(p) ?? Buffer.alloc(0) },
    {
      botInfo: {
        id: 1,
        is_bot: true,
        first_name: 'Birr',
        username: 'birr_bot',
        can_join_groups: false,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      } as any,
    },
  );
  const calls: Call[] = [];
  let nextMsgId = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, any> });
    if (method === 'getFile') return { ok: true, result: { file_id: (payload as any).file_id, file_unique_id: 'u', file_path: (payload as any).file_id } } as any;
    const result =
      method === 'sendMessage'
        ? { message_id: nextMsgId++, date: 0, chat: { id: (payload as any).chat_id, type: 'private' }, text: (payload as any).text }
        : true;
    return { ok: true, result } as any;
  });

  let updateId = 1;
  const user = (id = 42) => ({ id, is_bot: false, first_name: 'T' });
  const chat = (id = 42) => ({ id, type: 'private' as const, first_name: 'T' });
  const send = (text: string, from = 42) =>
    bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: 0,
        chat: chat(from),
        from: user(from),
        text,
        ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] } : {}),
      },
    } as any);
  const tap = (data: string, messageId = 1000) =>
    bot.handleUpdate({
      update_id: updateId++,
      callback_query: { id: String(updateId), from: user(), chat_instance: 'x', data, message: { message_id: messageId, date: 0, chat: chat(), text: '' } },
    } as any);
  const sendDoc = (fileName: string, content: string | Buffer, size?: number) => {
    const buf = typeof content === 'string' ? Buffer.from(content) : content;
    files.set(fileName, buf);
    return bot.handleUpdate({
      update_id: updateId++,
      message: { message_id: updateId, date: 0, chat: chat(), from: user(), document: { file_id: fileName, file_unique_id: fileName, file_name: fileName, file_size: size ?? buf.length } },
    } as any);
  };
  const txs = () => db.select().from(transactions).orderBy(transactions.id);
  const firstTx = async () => (await txs())[0]!;

  return { db, calls, send, sendDoc, tap, txs, firstTx, sent: () => calls.filter((c) => c.method === 'sendMessage') };
}

describe('bot', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('politely rejects users not on the allowlist', async () => {
    await t.send(sms('telebirr/t01_transfer_out.txt'), 7);
    expect(t.sent()).toHaveLength(1);
    expect(t.sent()[0]!.payload.text).toMatch(/private/);
    expect(await t.txs()).toHaveLength(0);
  });

  it('records a multi-SMS paste and replies with a summary and one card each', async () => {
    await t.send([sms('telebirr/t10_wallet_to_bank.txt'), sms('telebirr/t11_transfer_out.txt')].join('\n\n'));
    const [summary, c1, c2] = t.sent();
    expect(summary!.payload.text).toBe('📥 2 recorded');
    expect(c1!.payload.text).toContain('ETB 4,500.00');
    expect(c1!.payload.text).toContain('Awash International Bank S C');
    expect(c2!.payload.text).toContain('to <b>Selam Bekele</b>');
    expect(c2!.payload.text).toContain('Fees ETB 8.00');
    const buttons = c2!.payload.reply_markup.inline_keyboard.flat().map((b: any) => b.text);
    expect(buttons).toEqual(['✅ OK', '✏️ Edit', '🏷 Category', '🗑']);
  });

  it('says so when a message is already recorded', async () => {
    await t.send(sms('cbe/c01_transfer_in.txt'));
    await t.send(sms('cbe/c01_transfer_in.txt'));
    expect(t.sent().at(-1)!.payload.text).toMatch(/Already recorded: ETB 5,000.00/);
  });

  it('answers non-SMS text with a hint', async () => {
    await t.send('what is my balance?');
    expect(t.sent()[0]!.payload.text).toMatch(/doesn’t look like/);
  });

  it('recategorize → "always?" → rule saved', async () => {
    await t.send(sms('telebirr/t11_transfer_out.txt'));
    const txId = (await t.firstTx()).id;
    await t.tap(`cat:${txId}`);
    const grid = t.calls.at(-2)!; // editMessageReplyMarkup, then answerCallbackQuery
    expect(grid.method).toBe('editMessageReplyMarkup');
    const family = grid.payload.reply_markup.inline_keyboard.flat().find((b: any) => /Family/.test(b.text));

    await t.tap(family.callback_data);
    const edited = t.calls.find((c) => c.method === 'editMessageText' && /Always categorize/.test(c.payload.text))!;
    expect(edited.payload.text).toContain('Always categorize <b>Selam Bekele</b> as <b>Family support</b>?');

    const yes = edited.payload.reply_markup.inline_keyboard.flat()[0];
    await t.tap(yes.callback_data);
    expect(await t.db.select().from(rules)).toMatchObject([{ field: 'counterparty_name', pattern: 'selam bekele' }]);
    expect(t.calls.at(-1)).toMatchObject({ method: 'answerCallbackQuery', payload: { text: 'Rule saved' } });
  });

  it('edit amount via prompt, then /undo reverts it', async () => {
    await t.send(sms('telebirr/t05_transfer_out.txt'));
    const txId = (await t.firstTx()).id;
    await t.tap(`ef:${txId}:amount`);
    expect(t.sent().at(-1)!.payload.text).toMatch(/correct amount/);

    await t.send('1,250.50');
    expect((await t.firstTx()).amount).toBe(125050);
    expect(t.calls.some((c) => c.method === 'editMessageText' && c.payload.message_id === 1000)).toBe(true);

    await t.send('/undo');
    expect(t.sent().at(-1)!.payload.text).toMatch(/reverted the edit/);
    expect((await t.firstTx()).amount).toBe(1500);
  });

  it('an SMS pasted while an edit prompt is open is ingested, not taken as the edit', async () => {
    await t.send(sms('telebirr/t05_transfer_out.txt'));
    const txId = (await t.firstTx()).id;
    await t.tap(`ef:${txId}:note`);
    await t.send(sms('telebirr/t06_transfer_out.txt'));
    expect(await t.txs()).toHaveLength(2);
    expect((await t.firstTx()).note).toBeNull();
  });

  it('note with #tags', async () => {
    await t.send(sms('telebirr/t05_transfer_out.txt'));
    const txId = (await t.firstTx()).id;
    await t.tap(`ef:${txId}:note`);
    await t.send('lunch with team #Work #lunch');
    expect(await t.firstTx()).toMatchObject({ note: 'lunch with team', tags: ['work', 'lunch'] });
  });

  it('delete and undo-delete buttons', async () => {
    await t.send(sms('telebirr/t05_transfer_out.txt'));
    const txId = (await t.firstTx()).id;
    await t.tap(`del:${txId}`);
    expect((await t.firstTx()).deletedAt).not.toBeNull();
    await t.tap(`ud:${txId}`);
    expect((await t.firstTx()).deletedAt).toBeNull();
  });

  it('cannot touch another user’s transaction via forged callback data', async () => {
    await t.tap('del:999');
    expect(t.calls.at(-1)).toMatchObject({ method: 'answerCallbackQuery', payload: { text: 'Transaction not found.' } });
  });

  describe('bulk import by sending a file', () => {
    const csv = () =>
      ['address,date,body', ...[...CBE_ALL, ...TB_ALL].map((b, k) => `${k < 10 ? 'CBE' : '127'},${1795500000000 + k * 60000},"${b.replace(/"/g, '""')}"`)].join('\n');

    it('previews counts, imports on tap, and /undo removes the whole import', async () => {
      await t.sendDoc('messages.csv', csv());
      const preview = t.sent().at(-1)!;
      expect(preview.payload.text).toContain('<b>messages.csv</b>');
      expect(preview.payload.text).toContain('21 messages in the file · 21 from telebirr/CBE (telebirr 11 · CBE 10)');
      expect(preview.payload.text).toContain('✅ 21 new · ↺ 0 already recorded · 🔍 0 for review');
      expect(await t.txs()).toHaveLength(0);

      const [importBtn, cancelBtn] = preview.payload.reply_markup.inline_keyboard.flat();
      expect(importBtn.text).toBe('📥 Import 21');
      expect(cancelBtn.text).toBe('✖ Cancel');
      await t.tap(importBtn.callback_data);
      expect(t.sent().at(-1)!.payload.text).toMatch(/^✅ Imported 21 transactions/);
      expect(await t.txs()).toHaveLength(21);

      await t.send('/undo');
      expect(t.sent().at(-1)!.payload.text).toMatch(/removed 21 imported transactions/);
      expect(await t.txs()).toHaveLength(0);
    });

    it('cancel saves nothing', async () => {
      await t.sendDoc('messages.csv', csv());
      const [, cancelBtn] = t.sent().at(-1)!.payload.reply_markup.inline_keyboard.flat();
      await t.tap(cancelBtn.callback_data);
      expect(t.sent().at(-1)!.payload.text).toMatch(/cancelled/);
      expect(await t.txs()).toHaveLength(0);
    });

    it('says when there is nothing new', async () => {
      await t.sendDoc('a.csv', csv());
      await t.tap(t.sent().at(-1)!.payload.reply_markup.inline_keyboard.flat()[0].callback_data);
      await t.sendDoc('b.csv', csv());
      expect(t.sent().at(-1)!.payload.text).toMatch(/↺ 21 already recorded[\s\S]*Nothing new to import/);
      expect(t.sent().at(-1)!.payload.reply_markup).toBeUndefined();
    });

    it('rejects other file types and files over 20 MB', async () => {
      await t.sendDoc('photo.jpg', 'x');
      expect(t.sent().at(-1)!.payload.text).toMatch(/\.xml/);
      await t.sendDoc('huge.xml', '<smses/>', 25 * 1024 * 1024);
      expect(t.sent().at(-1)!.payload.text).toMatch(/over 20 MB/);
    });
  });

  it('a card warns about a possible missing SMS', async () => {
    await t.send(sms('cbe/c01_transfer_in.txt'));
    await t.send(sms('cbe/c03_debit.txt')); // c02 (3,481.20 out) never arrived
    expect(t.sent().at(-1)!.payload.text).toContain('⚠️ Possible missing SMS before this one: ETB 3,481.20 of money out unrecorded');
  });

  it('/undo after a paste removes the imported transactions', async () => {
    await t.send([sms('cbe/c01_transfer_in.txt'), sms('cbe/c02_transfer_out.txt')].join(' '));
    await t.send('/undo');
    expect(t.sent().at(-1)!.payload.text).toMatch(/removed 2 imported transactions/);
    expect(await t.txs()).toHaveLength(0);
  });
});
