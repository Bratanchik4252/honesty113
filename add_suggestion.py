from google.oauth2 import service_account
from googleapiclient.discovery import build
import os
import json
from datetime import datetime
import uuid

def handler(request):
    if request.method != 'POST':
        return {
            'statusCode': 405,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'error': 'Method not allowed'})
        }
    
    try:
        # Получаем данные из запроса
        data = json.loads(request.body)
        
        # Настройки Google Sheets
        SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
        SERVICE_ACCOUNT_INFO = json.loads(os.environ.get('GOOGLE_SERVICE_ACCOUNT'))
        SPREADSHEET_ID = os.environ.get('SHEET_ID')
        RANGE_NAME = 'Лист1!A:H'
        
        credentials = service_account.Credentials.from_service_account_info(
            SERVICE_ACCOUNT_INFO, scopes=SCOPES)
        service = build('sheets', 'v4', credentials=credentials)
        
        # Подготовка данных для записи
        now = datetime.now().strftime('%d.%m.%Y %H:%M')
        suggestion_id = str(uuid.uuid4())
        
        values = [[
            now,
            data.get('nick', 'Аноним'),
            data.get('title', ''),
            data.get('category', 'Другое'),
            data.get('link', '-'),
            data.get('comment', '-'),
            '0',
            suggestion_id
        ]]
        
        body = {
            'values': values
        }
        
        # Добавляем строку
        service.spreadsheets().values().append(
            spreadsheetId=SPREADSHEET_ID,
            range=RANGE_NAME,
            valueInputOption='USER_ENTERED',
            body=body
        ).execute()
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'success': True, 'id': suggestion_id})
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