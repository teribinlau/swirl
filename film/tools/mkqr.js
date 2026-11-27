// QR for the end card: cream modules on transparent, quiet zone included
const QR = require('qrcode');
const fs = require('fs'), path = require('path');
QR.toString('https://swirl.ilililab.de', { type: 'svg', errorCorrectionLevel: 'M', margin: 3, color: { dark: '#201d1d', light: '#fdfcfc' } }, (e, svg) => {
    if (e) throw e;
    fs.writeFileSync(path.join(__dirname, '../stage/qr.svg'), svg);
    console.log('qr.svg', svg.length, 'bytes', (svg.match(/viewBox="([^"]+)"/) || [])[1]);
});
