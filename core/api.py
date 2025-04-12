import json
import time
import logging
import uuid
import google.generativeai as genai
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from . import services

logger = logging.getLogger(__name__)

@csrf_exempt
@require_POST
def chat_api(request):
    if services.direct_genai_model is None or services.chat_collection is None or not hasattr(services, 'get_response'):
        core_error = services.initialization_error or "Chat service core components not ready."
        logger.error(f"[CHAT_API|SERVICE_UNAVAILABLE] Chat service unavailable on request: {core_error}")
        return JsonResponse({"error": f"Chatbot is currently unavailable. Please try again later."}, status=503)

    request_start_time = time.time()
    response_text = None
    status_code = 200
    chat_id = None
    is_new_chat = False

    try:
        data = json.loads(request.body)
        user_message = data.get("message", "").strip()
        chat_id = data.get("chat_id")
        log_chat_id_str = chat_id if chat_id else "NEW_CHAT"

        if not user_message:
            logger.warning(f"[{log_chat_id_str}] Received empty message.")
            return JsonResponse({"error": "Message cannot be empty"}, status=400)

        is_new_chat = not chat_id
        if is_new_chat:
            logger.info(f"[CHAT_API|NEW_CHAT] Request START")
        else:
            logger.info(f"[CHAT_API|{chat_id}] Request START (Existing Chat)")

        try:
            if is_new_chat:
                chat_id = str(uuid.uuid4())
                log_chat_id_str = chat_id # Update log prefix for subsequent logs
                logger.info(f"[CHAT_API|{chat_id}] New chat ID generated.")

            logger.info(f"[CHAT_API|{log_chat_id_str}] Processing query: '{user_message[:60]}...'")
            response_start_time = time.time()

            response_text = services.get_response(user_message, chat_id)

            response_end_time = time.time()
            logger.info(f"[CHAT_API|{log_chat_id_str}] -> Response generation successful, took: {response_end_time - response_start_time:.4f} seconds")
            status_code = 200

        except genai.types.StopCandidateException as e:
             logger.warning(f"[CHAT_API|{log_chat_id_str}] Response blocked by safety filter: {e}")
             block_reason_detail = f"Reason: {e}"
             response_text = f"BOT: My safety filters blocked the response. {block_reason_detail}"
             logger.debug(f"Safety block details: {e}")
             status_code = 200

        except ConnectionError as e:
             logger.error(f"[CHAT_API|{log_chat_id_str}] Service layer connection/processing error: {e}")
             response_text = f"BOT: Sorry, I encountered an issue processing your request. Please try again later. ({e})"
             status_code = 503

        except Exception as e:
             logger.error(f"[CHAT_API|{log_chat_id_str}] Unexpected error getting response: {e}", exc_info=True)
             response_text = f"BOT: Sorry, an unexpected internal error occurred ({type(e).__name__})."
             status_code = 500

        if chat_id and user_message and response_text is not None and status_code < 400:
             if not response_text.startswith("BOT: Sorry,") and not response_text.startswith("BOT: My safety filters"):
                 services.save_chat_messages(chat_id, user_message, response_text)
                 logger.debug(f"[CHAT_API|{chat_id}] -> Saved user message and bot response.")
             else:
                 logger.info(f"[CHAT_API|{chat_id}] Skipping save for bot-generated error/safety message: '{response_text[:50]}...'")
        elif chat_id:
             logger.warning(f"[CHAT_API|{chat_id}] Skipping message save. Status Code: {status_code}, Response Text Valid: {response_text is not None}")
             if response_text is None:
                 response_text = "BOT: Failed to generate a response."
                 status_code = 500


        total_api_time = time.time() - request_start_time
        log_chat_id_final = chat_id or "NEW_CHAT_FAILED"
        logger.info(f"[CHAT_API|{log_chat_id_final}] Request END. Total time: {total_api_time:.4f} seconds. Status: {status_code}")

        response_data = {"response": response_text or "Error: No response generated."}
        if is_new_chat and status_code < 400 and chat_id:
            response_data["new_chat_id"] = chat_id

        return JsonResponse(response_data, status=status_code)

    except json.JSONDecodeError:
        logger.warning("[CHAT_API|BAD_REQUEST] Invalid JSON received", exc_info=True)
        return JsonResponse({"error": "Invalid JSON format"}, status=400)
    except Exception as e:
        chat_id_str = chat_id or "UNKNOWN"
        logger.error(f"[CHAT_API|{chat_id_str}] Unhandled exception in outer scope: {e}", exc_info=True)
        return JsonResponse({"error": "An unexpected server error occurred."}, status=500)


@csrf_exempt
@require_POST
def update_chat_title_api(request):
    if services.chat_collection is None:
        db_error = services.initialization_error or "Database service not ready."
        logger.error(f"[TITLE_API|SERVICE_UNAVAILABLE] Update title failed: {db_error}")
        return JsonResponse({"error": f"Service unavailable: {db_error}"}, status=503)

    chat_id = None
    try:
        data = json.loads(request.body)
        chat_id = data.get('chat_id')
        new_title = data.get('new_title', '').strip()
        log_chat_id = chat_id or "NO_CHAT_ID"

        if not chat_id or not new_title:
            logger.warning(f"[TITLE_API|{log_chat_id}] Request missing chat_id or new_title.")
            return JsonResponse({"error": "chat_id and new_title required."}, status=400)

        logger.info(f"[TITLE_API|{log_chat_id}] Request START /api/update-title/")
        success = services.update_session_title(chat_id, new_title)

        if success:
            logger.info(f"[TITLE_API|{chat_id}] Title updated successfully to '{new_title}'.")
            return JsonResponse({"success": True, "chat_id": chat_id, "new_title": new_title})
        else:
            logger.warning(f"[TITLE_API|{chat_id}] Failed to update title (chat not found or DB error).")
            return JsonResponse({"error": "Failed to update title (Chat not found or internal error)."}, status=404)

    except json.JSONDecodeError:
        logger.warning(f"[TITLE_API|{chat_id or 'UNKNOWN'}] Invalid JSON received.", exc_info=True)
        return JsonResponse({"error": "Invalid JSON format."}, status=400)
    except Exception as e:
        logger.error(f"[TITLE_API|{chat_id or 'UNKNOWN'}] Unhandled exception: {e}", exc_info=True)
        return JsonResponse({"error": "An internal server error occurred."}, status=500)


@csrf_exempt
@require_POST
def delete_chat_api(request):
    if services.chat_collection is None:
        db_error = services.initialization_error or "Database service not ready."
        logger.error(f"[DELETE_API|SERVICE_UNAVAILABLE] Delete chat failed: {db_error}")
        return JsonResponse({"error": f"Service unavailable: {db_error}"}, status=503)

    chat_id = None
    try:
        data = json.loads(request.body)
        chat_id = data.get('chat_id')
        log_chat_id = chat_id or "NO_CHAT_ID"

        if not chat_id:
            logger.warning(f"[DELETE_API|{log_chat_id}] Request missing chat_id.")
            return JsonResponse({"error": "'chat_id' is required."}, status=400)

        logger.info(f"[DELETE_API|{log_chat_id}] Request START /api/delete-chat/")
        deleted_count = services.delete_session_history(chat_id)
        logger.info(f"[DELETE_API|{chat_id}] Chat delete finished. Documents deleted: {deleted_count}")
        return JsonResponse({"success": True, "deleted_count": deleted_count})

    except json.JSONDecodeError:
        logger.warning(f"[DELETE_API|{chat_id or 'UNKNOWN'}] Invalid JSON received.", exc_info=True)
        return JsonResponse({"error": "Invalid JSON format."}, status=400)
    except Exception as e:
        logger.error(f"[DELETE_API|{chat_id or 'UNKNOWN'}] Unhandled exception: {e}", exc_info=True)
        return JsonResponse({"error": "An internal server error occurred during deletion."}, status=500)