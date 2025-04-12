from pathlib import Path
import os
from dotenv import load_dotenv
from google.generativeai.types import HarmCategory, HarmBlockThreshold

BASE_DIR = Path(__file__).resolve().parent.parent

dotenv_path = os.path.join(BASE_DIR, '.env')
load_dotenv(dotenv_path=dotenv_path)

SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'change-this-default-secret-key-in-production')

DEBUG = os.getenv('DJANGO_DEBUG', 'True') == 'True'

ALLOWED_HOSTS = os.getenv('DJANGO_ALLOWED_HOSTS', '').split(',') if os.getenv('DJANGO_ALLOWED_HOSTS') else []
if DEBUG:
    ALLOWED_HOSTS.extend(['127.0.0.1', 'localhost'])


INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    "core"
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'chatbot.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'chatbot.wsgi.application'


DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}


AUTH_PASSWORD_VALIDATORS = [
    { 'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator', },
    { 'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', },
    { 'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator', },
    { 'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator', },
]


LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True


STATIC_URL = 'static/'
STATICFILES_DIRS = [ BASE_DIR / "static" ]


DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME")
MONGO_COLLECTION_NAME = os.getenv("MONGO_COLLECTION_NAME")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

TUNED_MODEL_NAME = os.getenv("TUNED_MODEL_NAME")

GEMINI_EMBEDDING_MODEL = os.getenv('GEMINI_EMBEDDING_MODEL', "models/text-embedding-004")

GENERATION_CONFIG = {
    "temperature": float(os.getenv("GEMINI_TEMPERATURE", 0.7)),
    "top_p": float(os.getenv("GEMINI_TOP_P", 0.95)),
    "top_k": int(os.getenv("GEMINI_TOP_K", 64)),
    "max_output_tokens": int(os.getenv("GEMINI_MAX_TOKENS", 8192)),
}

CUSTOM_SAFETY_SETTINGS = {
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_ONLY_HIGH,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
}


LOCAL_DOCUMENTS_PATH = os.getenv('LOCAL_DOCUMENTS_PATH', BASE_DIR / 'local_docs')
VECTORSTORE_PATH = os.getenv('VECTORSTORE_PATH', BASE_DIR / 'vectorstore_db')


CHAT_HISTORY_LIMIT = int(os.getenv('CHAT_HISTORY_LIMIT', 10))
CHAT_TITLE_MAX_LENGTH = int(os.getenv('CHAT_TITLE_MAX_LENGTH', 35))

GENERAL_SYSTEM_MESSAGE = os.getenv('GENERAL_SYSTEM_MESSAGE')

Path(LOCAL_DOCUMENTS_PATH).mkdir(parents=True, exist_ok=True)
Path(VECTORSTORE_PATH).mkdir(parents=True, exist_ok=True)


LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'simple': {
            'format': '{levelname} {asctime} {name} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': os.getenv('DJANGO_LOG_LEVEL', 'INFO'),
            'propagate': False,
        },
        'core': {
             'handlers': ['console'],
             'level': 'DEBUG',
             'propagate': False,
        },
        'langchain': {
             'handlers': ['console'],
             'level': 'WARNING',
             'propagate': False,
        },
         'chromadb': {
             'handlers': ['console'],
             'level': 'WARNING',
             'propagate': False,
        },
         'google.api_core': {
             'handlers': ['console'],
             'level': 'WARNING',
             'propagate': False,
        }
    },
}