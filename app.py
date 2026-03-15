from flask import Flask, jsonify, request, send_from_directory
from googleapiclient.discovery import build
from google.oauth2.service_account import Credentials
import os
import json

app = Flask(__name__, static_folder='public')

SHEET_ID = '1AcrjqHJMi
