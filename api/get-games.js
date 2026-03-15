import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'games!A:D',
    });

    const rows = response.data.values || [];
    const games = rows.slice(1).map(row => ({
      id: row[0] || '',
      name: row[1] || '',
      category: row[2] || 'Другое',
      firstSeen: row[3] || ''
    }));

    res.status(200).json(games);
  } catch (error) {
    console.error('Get games error:', error);
    res.status(500).json({ error: error.message });
  }
}
