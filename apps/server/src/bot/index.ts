import { Bot, InlineKeyboard } from 'grammy';
import { isAllowed, REJECTION_MESSAGE } from '../auth/allowlist.js';
import type { DB } from '../db/client.js';
import type { Env } from '../env.js';
import { ensureUser, type User } from '../services/users.js';
import type { Context } from 'grammy';

export type BotContext = Context & { user: User };

export function createBot(deps: { db: DB; env: Env }) {
  const { db, env } = deps;
  const bot = new Bot<BotContext>(env.BOT_TOKEN);

  // Allowlist gate: runs before every handler.
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (!isAllowed(from?.id, env.ALLOWED_TELEGRAM_IDS)) {
      if (ctx.chat?.type === 'private') await ctx.reply(REJECTION_MESSAGE).catch(() => {});
      return;
    }
    ctx.user = ensureUser(db, from!.id, from!.first_name);
    await next();
  });

  bot.command('start', async (ctx) => {
    const kb = new InlineKeyboard().webApp('📊 Open Birr', env.MINIAPP_URL);
    await ctx.reply(
      [
        `Selam ${ctx.user.firstName ?? ''} 👋`,
        '',
        'Forward or paste your telebirr (127) and CBE SMS here and I’ll track them.',
        'Open the app for your balance, budgets and insights.',
      ].join('\n'),
      { reply_markup: kb },
    );
  });

  bot.catch((err) => {
    // Never log message bodies: they contain financial data.
    console.error('[bot] error in update', err.ctx.update.update_id, err.error instanceof Error ? err.error.message : err.error);
  });

  return bot;
}
