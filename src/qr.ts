// A QR code in the terminal. Scanning this beats opening a page to scan a page:
// the terminal already has the developer's attention.
import qrcodeModule from 'qrcode-generator';

// qrcode-generator is CJS; the default import can arrive as the namespace.
const qrcode = (
  typeof qrcodeModule === 'function' ? qrcodeModule : (qrcodeModule as { default: unknown }).default
) as typeof qrcodeModule;

// Error correction M, smallest version that fits.
const QR_TYPE_AUTO = 0;
const QR_ERROR_CORRECTION = 'M';
const QR_QUIET_ZONE = 2;

// Two vertical modules per character cell, coloured explicitly rather than
// relying on the terminal's palette — scanners want dark-on-light, and a dark
// terminal would otherwise render the code inverted.
const BLACK = 16;
const WHITE = 231;
const HALF_BLOCK = '▀';
const RESET = '[0m';

/**
 * The QR for a link, on stdout. A TTY gets the colored QR. Anything else —
 * piped or backgrounded, which is how a coding agent runs this — gets bare
 * glyphs: the colored QR's contrast is entirely in its ANSI codes, which do
 * not survive being re-printed into a chat. NO_COLOR forces the same on a TTY.
 */
export function printQr(link: string): void {
  const plain = !process.stdout.isTTY || process.env.NO_COLOR !== undefined;
  for (const line of plain ? qrTextLines(link) : qrLines(link)) console.log('  ' + line);
}

export function qrLines(text: string): string[] {
  const qr = qrcode(QR_TYPE_AUTO, QR_ERROR_CORRECTION);
  qr.addData(text);
  qr.make();

  const size = qr.getModuleCount();
  const min = -QR_QUIET_ZONE;
  const max = size + QR_QUIET_ZONE;
  const isDark = (row: number, col: number) =>
    row >= 0 && row < size && col >= 0 && col < size && qr.isDark(row, col);

  const lines: string[] = [];
  for (let row = min; row < max; row += 2) {
    let line = '';
    for (let col = min; col < max; col++) {
      const upper = isDark(row, col) ? BLACK : WHITE;
      const lower = isDark(row + 1, col) ? BLACK : WHITE;
      line += `[38;5;${upper}m[48;5;${lower}m${HALF_BLOCK}`;
    }
    lines.push(line + RESET);
  }
  return lines;
}

// The same code as bare glyphs — no escape codes. For output that is piped or
// re-printed into a chat transcript, where ANSI is stripped and the colored
// version above collapses into a uniform wall of ▀ (its contrast is entirely
// in the colors). Light modules are glyphs and dark modules are spaces, so the
// polarity is right on a dark background and inverted on a light one — phone
// cameras read both.
export function qrTextLines(text: string): string[] {
  const qr = qrcode(QR_TYPE_AUTO, QR_ERROR_CORRECTION);
  qr.addData(text);
  qr.make();
  return qr.createASCII().split('\n');
}
