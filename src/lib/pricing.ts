import rates from '../../data/pricing.json' with { type: 'json' };
export { rates };
export type Material = keyof typeof rates.materials;
export type Profile = keyof typeof rates.profiles;
export interface CalculatorInput {
  area: number;
  perimeter: number;
  material: Material;
  profile: Profile;
  lights: number;
  lines: number;
  tracks: number;
  curtain: number;
  corners: number;
  pipes: number;
}
export const defaults: CalculatorInput = {
  ...rates.defaults,
  material: 'matte',
  profile: 'standard',
};
export const materialLabels = { matte: 'Матовый', satin: 'Сатиновый', gloss: 'Глянцевый' };
export const profileLabels = {
  standard: 'Стандартный',
  shadow: 'Теневой',
  floating: 'Парящий с подсветкой',
};
export const fieldLabels = {
  area: 'Площадь',
  perimeter: 'Периметр',
  lights: 'Светильники',
  lines: 'Световые линии',
  tracks: 'Треки',
  curtain: 'Скрытый карниз',
  corners: 'Углы',
  pipes: 'Обходы труб',
};
export function parseDecimal(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^[0-9]+(?:[.,][0-9]+)?$/.test(value.trim())) return NaN;
  return Number(value.replace(',', '.').trim());
}
export function validateCalculation(raw: Record<string, unknown>): {
  input?: CalculatorInput;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const result: Record<string, number> = {};
  for (const [key, bounds] of Object.entries(rates.bounds)) {
    const number = parseDecimal(raw[key]);
    if (
      !Number.isFinite(number) ||
      number < bounds[0] ||
      number > bounds[1] ||
      (['lights', 'corners', 'pipes'].includes(key) && !Number.isInteger(number))
    )
      errors[key] =
        `Укажите ${fieldLabels[key as keyof typeof fieldLabels].toLowerCase()} от ${bounds[0]} до ${bounds[1]}${['lights', 'corners', 'pipes'].includes(key) ? ' целым числом' : ''}.`;
    else result[key] = number;
  }
  const material = raw.material,
    profile = raw.profile;
  if (material !== 'matte' && material !== 'satin' && material !== 'gloss')
    errors.material = 'Выберите фактуру.';
  if (profile !== 'standard' && profile !== 'shadow' && profile !== 'floating')
    errors.profile = 'Выберите профиль.';
  if (Object.keys(errors).length) return { errors };
  if (
    (material === 'matte' || material === 'satin' || material === 'gloss') &&
    (profile === 'standard' || profile === 'shadow' || profile === 'floating')
  )
    return {
      input: {
        area: result.area,
        perimeter: result.perimeter,
        material,
        profile,
        lights: result.lights,
        lines: result.lines,
        tracks: result.tracks,
        curtain: result.curtain,
        corners: result.corners,
        pipes: result.pipes,
      },
      errors,
    };
  return { errors };
}
export function calculate(input: CalculatorInput) {
  const rows = [
    {
      label: `${materialLabels[input.material]} потолок с монтажом`,
      quantity: input.area,
      unit: 'м²',
      rate: rates.materials[input.material],
    },
    {
      label: `${profileLabels[input.profile]} профиль`,
      quantity: input.perimeter,
      unit: 'пог. м',
      rate: rates.profiles[input.profile],
    },
    {
      label: 'Монтаж точечных светильников',
      quantity: input.lights,
      unit: 'шт.',
      rate: rates.extras.lights,
    },
    { label: 'Световые линии', quantity: input.lines, unit: 'пог. м', rate: rates.extras.lines },
    { label: 'Трек с монтажом', quantity: input.tracks, unit: 'пог. м', rate: rates.extras.tracks },
    {
      label: 'Скрытый карниз',
      quantity: input.curtain,
      unit: 'пог. м',
      rate: rates.extras.curtain,
    },
    {
      label: 'Дополнительные углы',
      quantity: Math.max(0, input.corners - 4),
      unit: 'шт.',
      rate: rates.extras.corners,
    },
    { label: 'Обход труб', quantity: input.pipes, unit: 'шт.', rate: rates.extras.pipes },
  ]
    .filter((row) => row.quantity > 0)
    .map((row) => ({ ...row, total: Math.round(row.quantity * row.rate * 100) / 100 }));
  const subtotal = rows.reduce((sum, row) => sum + row.total, 0);
  const total = Math.max(subtotal, rates.minimum);
  const round = (n: number) => Math.floor(n / 10 + 0.5) * 10;
  return {
    rows,
    subtotal,
    total,
    minimumAdjustment: Math.max(0, rates.minimum - subtotal),
    low: Math.max(rates.minimum, round(total * rates.lowMultiplier)),
    high: round(total * rates.highMultiplier),
  };
}
export const money = (n: number) =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n)} ₽`;
export function normalizePhone(value: string): string | null {
  if (!/^[+0-9()\s.\-]+$/.test(value) || value.length > 32) return null;
  const digits = value.replace(/\D/g, '');
  const normalized =
    digits.length === 10
      ? `7${digits}`
      : digits.length === 11 && digits[0] === '8'
        ? `7${digits.slice(1)}`
        : digits;
  return /^7\d{10}$/.test(normalized) ? `+${normalized}` : null;
}
