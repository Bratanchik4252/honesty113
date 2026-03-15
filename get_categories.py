from google.oauth2 import service_account
from googleapiclient.discovery import build
import os
import json

def handler(request):
    try:
        # Настройки Google Sheets
        SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
        SERVICE_ACCOUNT_INFO = json.loads(os.environ.get('GOOGLE_SERVICE_ACCOUNT'))
        SPREADSHEET_ID = os.environ.get('SHEET_ID')
        RANGE_NAME = 'Категории!A:A'
        
        credentials = service_account.Credentials.from_service_account_info(
            SERVICE_ACCOUNT_INFO, scopes=SCOPES)
        service = build('sheets', 'v4', credentials=credentials)
        
        # Получаем категории
        sheet = service.spreadsheets()
        result = sheet.values().get(spreadsheetId=SPREADSHEET_ID,
                                    range=RANGE_NAME).execute()
        values = result.get('values', [])
        
        categories = ['Хоррор', 'Выживание', 'Инди', 'Мультиплеер', 'Сюжетная', 'Другое']
        if values:
            categories = [row[0] for row in values if row]
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(categories)
        }
        
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(['Хоррор', 'Выживание', 'Инди', 'Мультиплеер', 'Сюжетная', 'Другое'])
        }