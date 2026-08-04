const { google } = require('googleapis');

async function main() {
  const auth = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
  const client = await auth.getClient();
  const drive = google.drive({ version: 'v3', auth: client });
  
  const CBS_FOLDER = '1Dl38eXZ7b9YjdBKcKnJFjdT3gDBGbJ_W';
  
  // List top-level (partner folders)
  const r = await drive.files.list({
    q: `'${CBS_FOLDER}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType)',
    pageSize: 30,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    orderBy: 'name',
  });
  console.log('Top-level:', r.data.files?.map(f=>f.name));
}

main().catch(e => console.error('ERROR:', e.message));
