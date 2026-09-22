const { google } = require('googleapis');
const fs = require('fs');

const key = JSON.parse(fs.readFileSync('/home/pm2/.pptx-sa-key.json'));
const auth = new google.auth.JWT(key.client_email, null, key.private_key, [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
]);
const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

const XLSX_TEMPLATE_ID = '1wcZqlCUUBR6rhdf_iRSSj7uGjVjfvOzG';
const BILLING_PARENT_FOLDER_ID = '12ZCC-rS-wplcT3anilQhCNzhz5NBqgzq';

async function main() {
  console.log('Converting XLSX template to native Google Sheets...');

  // Convert XLSX → native Sheets (one-time), placed in Shared Drive billing folder
  const copy = await drive.files.copy({
    fileId: XLSX_TEMPLATE_ID,
    requestBody: {
      name: 'INVOICE_TEMPLATE_NATIVE (do not delete)',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [BILLING_PARENT_FOLDER_ID],
    },
    supportsAllDrives: true,
    fields: 'id,name,mimeType,webViewLink',
  });

  const nativeId = copy.data.id;
  console.log('\n✅ Converted successfully!');
  console.log('Native Sheets ID:', nativeId);
  console.log('View at:', copy.data.webViewLink);

  // Verify sheet tab names
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: nativeId,
    fields: 'sheets(properties(title))',
  });
  const tabs = meta.data.sheets.map(s => s.properties.title);
  console.log('Sheet tabs:', tabs);

  // Read back key cells to verify structure
  const verify = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: nativeId,
    ranges: ['INVOICE!E4', 'INVOICE!F4', 'INVOICE!E6', 'INVOICE!F6', 'INVOICE!E7'],
    valueRenderOption: 'FORMATTED_VALUE',
  });
  console.log('\nKey cells in converted Sheets:');
  for (const r of verify.data.valueRanges) {
    const val = r.values?.[0]?.[0] ?? '(empty)';
    console.log(`  ${r.range}: ${val}`);
  }

  console.log('\n👉 Next: set NATIVE_INVOICE_TEMPLATE_ID=' + nativeId);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
