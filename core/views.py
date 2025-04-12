from django.shortcuts import render, redirect
from django.conf import settings
from . import services
import logging

logger = logging.getLogger(__name__)

def home(request):
    return redirect('chat_index')

def chat_index(request):
    if services.initialization_error:
        logger.error(f"Rendering error page due to: {services.initialization_error}")
        return render(request, "error_page.html", {"error_message": f"Cannot initialize chat service: {services.initialization_error}"})

    viewed_chat_id = request.GET.get('chat_id')
    logger.info(f"Accessing chat_index. Viewed Chat ID from URL: {viewed_chat_id}")

    chat_list = services.get_chat_list()
    initial_history = []
    if viewed_chat_id:
        logger.info(f"Loading history for viewed chat ID: {viewed_chat_id}")
        raw_db_history = services.load_chat_history(viewed_chat_id)
        template_history = []
        for msg in raw_db_history:
            role = msg.get("role")
            content = msg.get("content")
            if role and content is not None:
                 template_history.append({"role": role, "parts": [str(content)]})
        initial_history = template_history
        logger.debug(f"Loaded {len(initial_history)} messages for template rendering.")

    else:
        logger.info("No chat ID in URL, rendering new chat interface.")

    context = {
        'chat_list': chat_list,
        'viewed_chat_id': viewed_chat_id,
        'chat_history': initial_history,
        'service_available': services.direct_genai_model is not None and services.chat_collection is not None,
    }
    return render(request, "index.html", context)

def logout_view(request):
    logger.info("User logging out.")
    request.session.flush()
    response = redirect('home')
    logger.info("Session flushed and redirecting after logout.")
    return response