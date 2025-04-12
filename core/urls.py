from django.urls import path
from . import views
from . import api

urlpatterns = [
    path('', views.home, name='home'),
    path('chat/', views.chat_index, name='chat_index'),
    path('logout/', views.logout_view, name='logout'),

    path('api/chat/', api.chat_api, name='chat_api'),
    path('api/update-title/', api.update_chat_title_api, name='update_chat_title_api'),
    path('api/delete-chat/', api.delete_chat_api, name='delete_chat_api'),
]