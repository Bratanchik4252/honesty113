import { google } from 'googleapis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const { suggestionId, userId } = req.body;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Лист1!A:I',
    });

    const rows = response.data.values || [];
    let foundRow = -1;
    let currentVotes = 0;

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][7] === suggestionId) {
        foundRow = i + 1;
        currentVotes = parseInt(rows[i][6]) || 0;
        break;
      }
    }

    if (foundRow === -1) {
      return res.status(404).json({ error: 'Предложка не найдена' });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: `Лист1!G${foundRow}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[currentVotes + 1]]
      }
    });

    res.status(200).json({ success: true, newVotes: currentVotes + 1 });
  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({ error: error.message });
  }
}
