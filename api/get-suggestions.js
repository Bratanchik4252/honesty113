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
      range: 'Лист1!A:I',
    });

    const rows = response.data.values || [];
    const suggestions = rows.slice(1).map(row => ({
      date: row[0] || '',
      nick: row[1] || '',
      title: row[2] || '',
      category: row[3] || '',
      link: row[4] || '-',
      comment: row[5] || '-',
      votes: parseInt(row[6]) || 0,
      id: row[7] || '',
      avatar: row[8] || ''
    }));

    res.status(200).json(suggestions);
  } catch (error) {
    console.error('Get suggestions error:', error);
    res.status(500).json({ error: error.message });
  }
}
