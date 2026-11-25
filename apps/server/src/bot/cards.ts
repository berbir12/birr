import { formatEtb, KIND_LABELS, tidyName, type TransactionKind } from '@birr/shared';
import { InlineKeyboard } from 'grammy';
import type { TxView } from '../services/transactions.js';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatWhen(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ms);
}

/** Compact confirmation card, HTML parse mode. */
export function cardText(t: TxView, tz: string, footer?: string): string {
  const sign = t.direction === 'in' ? '➕' : '➖';
  const kind = KIND_LABELS[t.kind as TransactionKind] ?? t.kind;
  const lines = [`${sign} <b>${formatEtb(t.amount)}</b> · ${kind}`];

  if (t.counterpartyName) {
    const prep = t.direction === 'in' ? 'from' : 'to';
    const id = t.counterpartyMaskedId ? ` <code>${esc(t.counterpartyMaskedId)}</code>` : '';
    lines.push(`${prep} <b>${esc(tidyName(t.counterpartyName))}</b>${id}`);
  }

  lines.push(`${t.categoryIcon ?? '🏷'} ${esc(t.categoryName ?? 'Uncategorized')} · 💳 ${esc(t.accountName)}`);

  const charges = t.fee + t.vat + t.otherCharges;
  const money = [charges ? `🧾 Fees ${formatEtb(charges)}` : null, t.balanceAfter !== null ? `Bal ${formatEtb(t.balanceAfter)}` : null]
    .filter(Boolean)
    .join(' · ');
  if (money) lines.push(money);

  lines.push(`🕒 ${t.occurredAtEstimated ? '~' : ''}${formatWhen(t.occurredAt, tz)}${t.occurredAtEstimated ? ' (time estimated)' : ''}`);
  if (t.note || t.tags.length) lines.push(`📝 ${esc([t.note, ...t.tags.map((x) => `#${x}`)].filter(Boolean).join(' '))}`);
  if (t.transferGroupId) {
    lines.push(`🔁 Internal transfer${t.transferPeerAccount ? ` ${t.direction === 'out' ? 'to' : 'from'} ${esc(t.transferPeerAccount)}` : ''} · not spending`);
  }
  if (t.reconciliation === 'gap' && t.reconciliationDelta !== null) {
    const which = t.reconciliationDelta > 0 ? 'money in' : 'money out';
    lines.push(`⚠️ Possible missing SMS before this one: ${formatEtb(Math.abs(t.reconciliationDelta))} of ${which} unrecorded`);
  }
  if (t.deletedAt) lines.push('🗑 <i>Deleted</i>');
  if (footer) lines.push('', footer);
  return lines.join('\n');
}

// Callback data stays well under Telegram's 64-byte limit: "<verb>:<txId>[:<arg>]".
export const cb = {
  ok: (id: number) => `ok:${id}`,
  edit: (id: number) => `ed:${id}`,
  editField: (id: number, f: 'amount' | 'name' | 'note') => `ef:${id}:${f}`,
  cats: (id: number) => `cat:${id}`,
  setCat: (id: number, catId: number) => `sc:${id}:${catId}`,
  rule: (id: number, catId: number) => `ru:${id}:${catId}`,
  noRule: (id: number) => `nr:${id}`,
  del: (id: number) => `del:${id}`,
  undel: (id: number) => `ud:${id}`,
  back: (id: number) => `bk:${id}`,
};

export function mainKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ OK', cb.ok(id))
    .text('✏️ Edit', cb.edit(id))
    .text('🏷 Category', cb.cats(id))
    .text('🗑', cb.del(id));
}

export function editKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('💰 Amount', cb.editField(id, 'amount'))
    .text('👤 Name', cb.editField(id, 'name'))
    .text('📝 Note / #tags', cb.editField(id, 'note'))
    .row()
    .text('↩ Back', cb.back(id));
}

export function categoryKeyboard(id: number, cats: Array<{ id: number; name: string; icon: string | null }>, currentId: number | null) {
  const kb = new InlineKeyboard();
  cats.forEach((c, i) => {
    kb.text(`${c.id === currentId ? '• ' : ''}${c.icon ?? ''} ${c.name}`.trim(), cb.setCat(id, c.id));
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text('↩ Back', cb.back(id));
}

export function ruleKeyboard(id: number, catId: number) {
  return new InlineKeyboard().text('Yes, always', cb.rule(id, catId)).text('Just this one', cb.noRule(id));
}

export function deletedKeyboard(id: number) {
  return new InlineKeyboard().text('↩️ Undo delete', cb.undel(id));
}

export function confirmedKeyboard(id: number) {
  // Keep a way back in after OK, without the clutter.
  return new InlineKeyboard().text('✏️', cb.edit(id)).text('🏷', cb.cats(id)).text('🗑', cb.del(id));
}
