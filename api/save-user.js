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
    const { id, login, display_name, email, profile_image_url } = req.body;

    const now = new Date().toLocaleString('ru-RU');

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Пользователи!A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          now,
          id,
          login,
          display_name,
          email || '-',
          profile_image_url || '-'
        ]]
      }
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Save user error:', error);
    res.status(500).json({ error: error.message });
  }
}
