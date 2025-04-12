from django.shortcuts import render, redirect
from django.conf import settings
from django.http import JsonResponse, HttpResponseBadRequest, HttpResponseNotAllowed
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.contrib.auth import logout
import json
import uuid
from . import services
import logging

logger = logging.getLogger(__name__)

def home(request):
    return redirect('chat_index')

@ensure_csrf_cookie
def chat_index(request):
    if services.initialization_error:
        logger.error(f"Rendering error page due to initialization failure: {services.initialization_error}")
        return render(request, "error_page.html", {"error_message": f"Cannot initialize chat service: {services.initialization_error}"})

    viewed_chat_id = request.GET.get('chat_id')
    logger.info(f"Accessing chat_index. Viewed Chat ID from URL: {viewed_chat_id or 'None'}")

    chat_list = []
    initial_history_for_json = []

    try:
        chat_list = services.get_chat_list()
        logger.debug(f"Retrieved chat list count: {len(chat_list)}")

        if viewed_chat_id:
            logger.info(f"Loading history for viewed chat ID: {viewed_chat_id}")
            raw_db_history = services.load_chat_history(viewed_chat_id)
            initial_history_for_json = [
                {"role": msg.get("role"), "content": msg.get("content")}
                for msg in raw_db_history if msg.get("role") and msg.get("content") is not None
            ]
            logger.debug(f"Prepared {len(initial_history_for_json)} messages for JSON context.")
        else:
            logger.info("No chat ID in URL, rendering new chat interface.")

    except Exception as e:
        logger.error(f"Error preparing chat view data (chat_list or history): {e}", exc_info=True)

    context = {
        'chat_list': chat_list,
        'current_chat_id': viewed_chat_id,
        'chat_history_json': json.dumps(initial_history_for_json),
        'service_available': services.direct_genai_model is not None and services.chat_collection is not None,
    }
    return render(request, "index.html", context)


@csrf_exempt
def chat_api(request):
    if request.method != 'POST':
        return HttpResponseNotAllowed(['POST'])
    try:
        data = json.loads(request.body)
        user_message = data.get('message')
        chat_id = data.get('chat_id')
        if not user_message:
            logger.warning("Chat API received empty message.")
            return JsonResponse({'error': 'Empty message received.'}, status=400)

        is_new_chat = not chat_id
        if is_new_chat:
            chat_id = str(uuid.uuid4())
            logger.info(f"API: New chat request. Generated ID: {chat_id}")

        response_text, generated_title = services.get_response(user_message, chat_id)
        services.save_chat_messages(chat_id, user_message, response_text, generated_title)

        response_data = {'response': response_text}
        if is_new_chat:
            response_data['new_chat_id'] = chat_id
            response_data['title'] = generated_title or services.DEFAULT_CHAT_TITLE
            logger.info(f"API: Responding for new chat {chat_id} with title: '{response_data['title']}'")
        return JsonResponse(response_data)
    except json.JSONDecodeError:
        logger.error("Chat API received invalid JSON.")
        return JsonResponse({'error': 'Invalid JSON.'}, status=400)
    except ConnectionError as ce:
         logger.error(f"Chat API ConnectionError: {ce}", exc_info=True)
         return JsonResponse({'error': f'Chat service unavailable: {ce}'}, status=503)
    except Exception as e:
        logger.error(f"Error in chat API: {e}", exc_info=True)
        return JsonResponse({'error': 'An unexpected server error occurred.'}, status=500)


@csrf_exempt
def update_title_api(request):
    if request.method != 'POST':
        return HttpResponseNotAllowed(['POST'])
    try:
        data = json.loads(request.body)
        chat_id = data.get('chat_id')
        new_title = data.get('new_title')
        if not chat_id or new_title is None:
            logger.warning("Update Title API missing chat_id or new_title.")
            return JsonResponse({'error': 'Missing chat_id or new_title.'}, status=400)

        logger.info(f"API: Update title request for chat {chat_id} to: '{new_title}'")
        success = services.update_session_title(chat_id, new_title)

        if success:
            updated_chat_list = services.get_chat_list()
            current_title = services.DEFAULT_CHAT_TITLE
            for chat in updated_chat_list:
                if chat['chat_id'] == chat_id:
                    current_title = chat['title']
                    break
            logger.info(f"API: Title update successful for {chat_id}. Returning effective title: '{current_title}'")
            return JsonResponse({'success': True, 'new_title': current_title})
        else:
             logger.warning(f"API: Title update failed for chat_id {chat_id} (service returned false).")
             return JsonResponse({'error': 'Failed to update title. Chat not found or no changes made.'}, status=404)
    except json.JSONDecodeError:
        logger.error("Update Title API received invalid JSON.")
        return JsonResponse({'error': 'Invalid JSON.'}, status=400)
    except Exception as e:
        logger.error(f"Error updating title via API: {e}", exc_info=True)
        return JsonResponse({'error': 'An unexpected server error occurred.'}, status=500)


@csrf_exempt
def delete_chat_api(request):
    if request.method != 'POST':
        return HttpResponseNotAllowed(['POST'])
    try:
        data = json.loads(request.body)
        chat_id = data.get('chat_id')
        if not chat_id:
            logger.warning("Delete Chat API missing chat_id.")
            return JsonResponse({'error': 'Missing chat_id.'}, status=400)

        logger.info(f"API: Delete request for chat: {chat_id}")
        deleted_count = services.delete_session_history(chat_id)
        logger.info(f"API: Deletion result for {chat_id}: Deleted {deleted_count} documents.")
        return JsonResponse({'success': True, 'message': f'Deleted {deleted_count} messages.'})
    except json.JSONDecodeError:
        logger.error("Delete Chat API received invalid JSON.")
        return JsonResponse({'error': 'Invalid JSON.'}, status=400)
    except Exception as e:
        logger.error(f"Error deleting chat via API: {e}", exc_info=True)
        return JsonResponse({'error': 'An unexpected server error occurred.'}, status=500)


def logout_view(request):
    logger.info("User logging out.")
    logout(request)
    response = redirect('home')
    logger.info("User logged out, redirecting.")
    return response