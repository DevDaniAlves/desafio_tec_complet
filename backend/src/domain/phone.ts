/** Variantes de um número brasileiro (com/sem o 9º dígito) para casar o JID do WhatsApp com o cadastro. */
export function phoneVariants(raw: string): string[] {
  let d = raw.replace(/\D/g, '');
  if (!d) return [];
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
  const out = new Set([d]);
  if (d.startsWith('55')) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.length === 9 && rest.startsWith('9')) out.add(`55${ddd}${rest.slice(1)}`);
    if (rest.length === 8) out.add(`55${ddd}9${rest}`);
  }
  return [...out];
}

export const normalizePhone = (raw: string): string => phoneVariants(raw)[0] ?? '';
