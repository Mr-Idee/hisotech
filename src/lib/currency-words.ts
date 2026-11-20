const SMALL_NUMBERS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

function underOneThousand(value: number): string {
  if (value < 20) return SMALL_NUMBERS[value];
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)];
    const units = value % 10;
    return units ? `${tens}-${SMALL_NUMBERS[units]}` : tens;
  }

  const hundreds = `${SMALL_NUMBERS[Math.floor(value / 100)]} Hundred`;
  const remainder = value % 100;
  return remainder ? `${hundreds} and ${underOneThousand(remainder)}` : hundreds;
}

function integerToWords(value: number): string {
  if (value === 0) return SMALL_NUMBERS[0];

  const groups: { value: number; scale: string }[] = [];
  let remainder = value;
  let scaleIndex = 0;
  while (remainder > 0) {
    if (scaleIndex >= SCALES.length) {
      throw new RangeError('Amount is too large to convert to words.');
    }
    const group = remainder % 1000;
    if (group > 0) groups.push({ value: group, scale: SCALES[scaleIndex] });
    remainder = Math.floor(remainder / 1000);
    scaleIndex += 1;
  }

  return groups
    .reverse()
    .map((group, index, allGroups) => {
      const words = [underOneThousand(group.value), group.scale].filter(Boolean).join(' ');
      const isFinalGroup = index === allGroups.length - 1;
      return isFinalGroup && allGroups.length > 1 && !group.scale && group.value < 100
        ? `and ${words}`
        : words;
    })
    .join(' ')
    .replace(/\s+/g, ' ');
}

export function amountInNairaWords(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError('Amount must be a finite number.');
  }

  const totalKobo = Math.round(Math.abs(amount) * 100);
  if (!Number.isSafeInteger(totalKobo)) {
    throw new RangeError('Amount exceeds the supported precision for words.');
  }

  const naira = Math.floor(totalKobo / 100);
  const kobo = totalKobo % 100;
  const nairaWords = `${integerToWords(naira)} Naira`;
  const koboWords = kobo ? ` and ${integerToWords(kobo)} Kobo` : '';
  const sign = amount < 0 ? 'Minus ' : '';
  return `${sign}${nairaWords}${koboWords} Only`;
}
