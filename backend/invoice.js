const PDFDocument = require('pdfkit');

const ORANGE = '#ff9900', BLACK = '#131921', GREY = '#6b7280', LINE = '#e5e7eb';
// The built-in PDF fonts have no rupee sign, so amounts are written as "Rs."
const money = n => 'Rs. ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const pretty = s => s.charAt(0).toUpperCase() + s.slice(1);

function paymentLine(o) {
  if (o.payment_method === 'COD') {
    return o.payment_status === 'paid'
      ? { mode: 'CASH ON DELIVERY', note: 'Payment received' }
      : { mode: 'CASH ON DELIVERY', note: `Amount to pay on delivery: ${money(o.total)}` };
  }
  return o.payment_status === 'paid'
    ? { mode: 'PREPAID', note: 'Payment received. Nothing to pay on delivery.' }
    : { mode: 'PREPAID', note: 'Payment not yet confirmed' };
}

/** Streams a one-or-more page A4 invoice for the given order (as returned by loadOrder) into `out`. */
function writeInvoice(order, out) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Invoice ${order.invoice_no}`, Author: 'ToothKart' } });
  doc.pipe(out);
  const L = 40, R = 555, W = R - L;

  // Header band
  doc.rect(0, 0, 595, 92).fill(BLACK);
  doc.font('Helvetica-Bold').fontSize(28).fillColor('#ffffff').text('Tooth', L, 30, { continued: true }).fillColor(ORANGE).text('Kart');
  doc.font('Helvetica').fontSize(9).fillColor('#9ca3af').text('Dental supplies for clinics and students', L, 64);
  doc.font('Helvetica-Bold').fontSize(24).fillColor('#ffffff').text('INVOICE', L, 34, { width: W, align: 'right' });
  doc.rect(0, 92, 595, 4).fill(ORANGE);

  // Customer (left) and invoice details (right)
  let y = 120;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY).text('BILL TO / SHIP TO', L, y);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(BLACK).text(order.ship_name, L, y + 16, { width: 280 });
  doc.font('Helvetica').fontSize(10.5).fillColor('#374151');
  doc.text(order.ship_address, L, doc.y + 3, { width: 280 });
  doc.text(`Pincode: ${order.ship_pincode}`, L, doc.y + 3);
  doc.text(`Phone: ${order.ship_phone}`, L, doc.y + 3);
  const leftEnd = doc.y;

  const details = [['Invoice no.', order.invoice_no], ['Order no.', `#${order.id}`], ['Order date', when(order.created_at)], ['Order status', pretty(order.status)]];
  details.forEach(([k, v], i) => {
    const ry = y + i * 18;
    doc.font('Helvetica').fontSize(10).fillColor(GREY).text(k, 340, ry, { width: 90 });
    doc.font('Helvetica-Bold').fillColor(BLACK).text(v, 430, ry, { width: R - 430, align: 'right' });
  });

  // Payment mode box
  y = Math.max(leftEnd, y + 4 * 18) + 18;
  const pay = paymentLine(order);
  doc.roundedRect(L, y, W, 46, 8).fillAndStroke('#fff7ec', ORANGE);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GREY).text('PAYMENT MODE', L + 14, y + 9);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(BLACK).text(pay.mode, L + 14, y + 22);
  doc.font('Helvetica').fontSize(10.5).fillColor('#374151').text(pay.note, L + 200, y + 18, { width: W - 214, align: 'right' });
  y += 66;

  // Items table
  const col = { n: L + 10, item: L + 38, qty: 330, mrp: 375, price: 440, amt: 500 };
  const header = at => {
    doc.rect(L, at, W, 24).fill(BLACK);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#ffffff');
    doc.text('#', col.n, at + 8).text('ITEM', col.item, at + 8);
    doc.text('QTY', col.qty, at + 8, { width: 35, align: 'right' }).text('MRP', col.mrp, at + 8, { width: 55, align: 'right' });
    doc.text('PRICE', col.price, at + 8, { width: 55, align: 'right' }).text('AMOUNT', col.amt - 5, at + 8, { width: R - col.amt + 5 - 6, align: 'right' });
    return at + 24;
  };
  y = header(y);
  order.items.forEach((it, i) => {
    if (y > 700) { doc.addPage(); y = header(40); }
    if (i % 2 === 1) doc.rect(L, y, W, 26).fill('#fafafa');
    doc.font('Helvetica').fontSize(10).fillColor(BLACK);
    doc.text(String(i + 1), col.n, y + 8);
    doc.text(it.name, col.item, y + 8, { width: 275, lineBreak: false, ellipsis: true });
    doc.text(String(it.quantity), col.qty, y + 8, { width: 35, align: 'right' });
    doc.fillColor(GREY).text(money(it.list_price).replace('Rs. ', ''), col.mrp, y + 8, { width: 55, align: 'right' });
    doc.fillColor(BLACK).text(money(it.unit_price).replace('Rs. ', ''), col.price, y + 8, { width: 55, align: 'right' });
    doc.font('Helvetica-Bold').text(money(it.unit_price * it.quantity).replace('Rs. ', ''), col.amt - 5, y + 8, { width: R - col.amt + 5 - 6, align: 'right' });
    y += 26;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(LINE).stroke();
  });

  // Totals
  if (y > 650) { doc.addPage(); y = 40; }
  y += 16;
  const row = (k, v, opts = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.big ? 13 : 10.5).fillColor(opts.color || '#374151');
    doc.text(k, 330, y, { width: 120 });
    doc.text(v, 440, y, { width: R - 440 - 6, align: 'right' });
    y += opts.big ? 24 : 19;
  };
  row('Subtotal (MRP)', money(order.subtotal));
  row('Discount', '- ' + money(order.discount), { color: '#16a34a' });
  doc.moveTo(330, y).lineTo(R, y).lineWidth(1).strokeColor(ORANGE).stroke();
  y += 8;
  row('TOTAL', money(order.total), { bold: true, big: true, color: BLACK });

  // Footer
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BLACK).text('Thank you for shopping with ToothKart!', L, 770, { width: W, align: 'center' });
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text('This is a computer-generated invoice and does not need a signature.', L, 788, { width: W, align: 'center' });
  doc.end();
}

module.exports = { writeInvoice };
