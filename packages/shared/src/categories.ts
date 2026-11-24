export interface DefaultCategory {
  key: string;
  name: string;
  nameAm: string;
  icon: string;
  /** Excluded from spending totals (internal transfers, income). */
  isSpending: boolean;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { key: 'food', name: 'Food & Groceries', nameAm: 'ምግብ እና ሸቀጣሸቀጥ', icon: '🍲', isSpending: true },
  { key: 'transport', name: 'Transport', nameAm: 'ትራንስፖርት', icon: '🚕', isSpending: true },
  { key: 'airtime', name: 'Airtime & Data', nameAm: 'የአየር ሰዓት እና ዳታ', icon: '📶', isSpending: true },
  { key: 'utilities', name: 'Utilities', nameAm: 'መገልገያዎች', icon: '💡', isSpending: true },
  { key: 'rent', name: 'Rent', nameAm: 'የቤት ኪራይ', icon: '🏠', isSpending: true },
  { key: 'family', name: 'Family support', nameAm: 'የቤተሰብ ድጋፍ', icon: '👨‍👩‍👧', isSpending: true },
  { key: 'equb', name: 'Equb/Iddir', nameAm: 'እቁብ/እድር', icon: '🤝', isSpending: true },
  { key: 'giving', name: 'Church/Mosque & giving', nameAm: 'ቤተ እምነት እና ስጦታ', icon: '🙏', isSpending: true },
  { key: 'health', name: 'Health', nameAm: 'ጤና', icon: '🩺', isSpending: true },
  { key: 'education', name: 'Education', nameAm: 'ትምህርት', icon: '📚', isSpending: true },
  { key: 'shopping', name: 'Shopping', nameAm: 'ግብይት', icon: '🛍️', isSpending: true },
  { key: 'entertainment', name: 'Entertainment', nameAm: 'መዝናኛ', icon: '🎬', isSpending: true },
  { key: 'business', name: 'Business', nameAm: 'ንግድ', icon: '💼', isSpending: true },
  { key: 'fees', name: 'Fees & VAT', nameAm: 'ክፍያዎች እና ቫት', icon: '🧾', isSpending: true },
  { key: 'transfers', name: 'Transfers', nameAm: 'ዝውውሮች', icon: '🔁', isSpending: false },
  { key: 'income', name: 'Income', nameAm: 'ገቢ', icon: '💰', isSpending: false },
  { key: 'other', name: 'Other', nameAm: 'ሌላ', icon: '📦', isSpending: true },
];
