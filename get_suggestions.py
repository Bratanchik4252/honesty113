from google.oauth2 import service_account
from googleapiclient.discovery import build
import os
import json
from datetime import datetime

def handler(request):
    try:
        # Настройки Google Sheets
        SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
        SERVICE_ACCOUNT_INFO = json.loads(os.environ.get('GOOGLE_SERVICE_ACCOUNT'))
        SPREADSHEET_ID = os.environ.get('SHEET_ID')
        RANGE_NAME = 'Лист1!A:H'
        
        credentials = service_account.Credentials.from_service_account_info(
            SERVICE_ACCOUNT_INFO, scopes=SCOPES)
        service = build('sheets', 'v4', credentials=credentials)
        
        # Получаем данные
        sheet = service.spreadsheets()
        result = sheet.values().get(spreadsheetId=SPREADSHEET_ID,
                                    range=RANGE_NAME).execute()
        values = result.get('values', [])
        
        if not values:
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps([])
            }
        
        # Преобразуем в список словарей
        headers = values[0]
        suggestions = []
        for row in values[1:]:
            if len(row) >= 7:
                suggestion = {
                    'date': row[0] if len(row) > 0 else '',
                    'nick': row[1] if len(row) > 1 else '',
                    'title': row[2] if len(row) > 2 else '',
                    'category': row[3] if len(row) > 3 else '',
                    'link': row[4] if len(row) > 4 else '-',
                    'comment': row[5] if len(row) > 5 else '-',
                    'votes': int(row[6]) if len(row) > 6 and row[6] else 0,
                    'id': row[7] if len(row) > 7 else ''
                }
                suggestions.append(suggestion)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(suggestions)
        }
        
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'error': str(e)})
        }