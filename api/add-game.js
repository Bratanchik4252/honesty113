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
    const { name, category, firstSeen } = req.body;

    const existingResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: 'games!B:B',
    });

    const existingGames = existingResponse.data.values?.map(row => row[0].toLowerCase()) || [];
    
    if (existingGames.includes(name.toLowerCase())) {
      return res.status(200).json({ success: true, message: 'Game already exists' });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: 'games!A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          Date.now().toString(),
          name,
          category,
          firstSeen,
          '',
          '0'
        ]]
      }
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Add game error:', error);
    res.status(500).json({ error: error.message });
  }
}
