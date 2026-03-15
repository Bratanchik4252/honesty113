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
      range: 'vods!A:C',
    });

    const rows = response.data.values || [];
    const vods = rows.slice(1).map(row => ({
      date: row[0] || '',
      url: row[1] || '',
      title: row[2] || ''
    }));

    res.status(200).json(vods);
  } catch (error) {
    console.error('Get vods error:', error);
    res.status(500).json({ error: error.message });
  }
}
