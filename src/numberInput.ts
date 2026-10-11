// What a number field means by what was typed into it. Pure, so a test can load it straight into Node.

/**
 * "1.5", ".5" and "1,5" are numbers; "1." is 1 until more is typed; "1,450" is 1450. Anything that
 * doesn't start with a number is 0, and a stray second dot ("1.2.") ends the number where it is.
 */
export function parseTypedNumber(text: string): number {
  let typed = text.trim().replace(/\s+/g, '');
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(typed)) typed = typed.replace(/,/g, '');
  else if (/^\d*,\d*$/.test(typed)) typed = typed.replace(',', '.');
  const number = Number(typed.match(/^\d*\.?\d*/)?.[0] || 0);
  return Number.isFinite(number) ? number : 0;
}
