import pymongo
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold, StopCandidateException
from pymongo.errors import ConnectionFailure, OperationFailure
from datetime import datetime
from django.conf import settings
import logging
import os
from pathlib import Path

from langchain_google_genai import GoogleGenerativeAIEmbeddings
logger = logging.getLogger(__name__)
try:
    from langchain_chroma import Chroma
except ImportError:
    logger.warning("langchain-chroma not found, falling back to Chroma from langchain_community.")
    from langchain_community.vectorstores import Chroma
from langchain.prompts import PromptTemplate, ChatPromptTemplate, MessagesPlaceholder
from langchain.schema.runnable import RunnablePassthrough, RunnableLambda, RunnableBranch
from langchain.schema.output_parser import StrOutputParser
from langchain.docstore.document import Document
# Keep these imports for messages
from langchain.schema import SystemMessage, HumanMessage, AIMessage

# Import ChatPromptValue from its correct core location
from langchain_core.prompt_values import ChatPromptValue


MONGO_URI = settings.MONGO_URI
MONGO_DB_NAME = settings.MONGO_DB_NAME
MONGO_COLLECTION_NAME = settings.MONGO_COLLECTION_NAME
GEMINI_API_KEY = settings.GEMINI_API_KEY
TUNED_MODEL_NAME = settings.TUNED_MODEL_NAME
HISTORY_LIMIT = settings.CHAT_HISTORY_LIMIT
CHAT_TITLE_MAX_LENGTH = settings.CHAT_TITLE_MAX_LENGTH
GENERATION_CONFIG = settings.GENERATION_CONFIG
CUSTOM_SAFETY_SETTINGS = settings.CUSTOM_SAFETY_SETTINGS
VECTORSTORE_PATH = str(settings.VECTORSTORE_PATH)
GEMINI_EMBEDDING_MODEL = settings.GEMINI_EMBEDDING_MODEL
# Ensure GENERAL_SYSTEM_MESSAGE in settings.py also has language instruction
GENERAL_SYSTEM_MESSAGE = settings.GENERAL_SYSTEM_MESSAGE


mongo_client = None
chat_collection = None
initialization_error = None
vector_store = None
rag_chain = None
general_chat_chain = None
router_chain = None
embeddings = None
retriever = None
rag_available = False
direct_genai_model = None


# --- MongoDB Connection ---
try:
    if not MONGO_URI or not MONGO_DB_NAME or not MONGO_COLLECTION_NAME:
        raise ValueError("MongoDB configuration missing in settings.")
    mongo_client = pymongo.MongoClient(
                    MONGO_URI,
                    serverSelectionTimeoutMS=5000,
                    tls=True)
    mongo_client.server_info()
    mongo_db = mongo_client[MONGO_DB_NAME]
    chat_collection = mongo_db[MONGO_COLLECTION_NAME]
    chat_collection.create_index([("chat_id", pymongo.ASCENDING), ("timestamp", pymongo.ASCENDING)], background=True)
    chat_collection.create_index([("timestamp", pymongo.DESCENDING)], background=True)
    logger.info("MongoDB connected and indexes ensured.")
except (ConnectionFailure, ValueError, OperationFailure) as e:
    initialization_error = f"MongoDB connection/configuration/index failed: {e}"
    logger.error(initialization_error, exc_info=True)
    chat_collection = None
except Exception as e:
    initialization_error = f"Unexpected error during MongoDB setup: {e}"
    logger.error(initialization_error, exc_info=True)
    chat_collection = None

# --- Gemini Model Initialization ---
if not initialization_error:
    try:
        if not GEMINI_API_KEY: raise ValueError("GEMINI_API_KEY missing.")
        if not TUNED_MODEL_NAME: raise ValueError("TUNED_MODEL_NAME missing.")
        if not GEMINI_EMBEDDING_MODEL: raise ValueError("GEMINI_EMBEDDING_MODEL missing.")

        genai.configure(api_key=GEMINI_API_KEY)

        direct_genai_model = genai.GenerativeModel(
            model_name=TUNED_MODEL_NAME,
            generation_config=GENERATION_CONFIG,
            safety_settings=CUSTOM_SAFETY_SETTINGS
            )

        logger.info("Testing direct genai model generate_content...")
        response = direct_genai_model.generate_content("Test: Generate a short confirmation.")
        _ = response.text
        logger.info(f"Successfully initialized and tested direct genai model '{TUNED_MODEL_NAME}'.")

    except Exception as e:
        sdk_init_error = f"Failed to initialize or test direct genai.GenerativeModel('{TUNED_MODEL_NAME}'): {e}"
        logger.error(sdk_init_error, exc_info=True)
        initialization_error = sdk_init_error
        direct_genai_model = None

# --- RAG Setup ---
if not initialization_error and direct_genai_model and os.path.exists(VECTORSTORE_PATH):
    if not os.listdir(VECTORSTORE_PATH):
         logger.warning(f"Vector store path '{VECTORSTORE_PATH}' exists but is empty. RAG IS DISABLED.")
         rag_available = False
    else:
        try:
            logger.info("[RAG] Initializing RAG components...")
            logger.debug(f"[RAG] Loading embeddings model: {GEMINI_EMBEDDING_MODEL}")
            embeddings = GoogleGenerativeAIEmbeddings(
                model=GEMINI_EMBEDDING_MODEL,
                google_api_key=GEMINI_API_KEY
            )
            _ = embeddings.embed_query("test embedding")
            logger.info("[RAG] Embeddings model loaded and tested.")

            logger.debug(f"[RAG] Loading vector store from: {VECTORSTORE_PATH}")
            vector_store = Chroma(
                persist_directory=VECTORSTORE_PATH,
                embedding_function=embeddings
            )
            collection_count = vector_store._collection.count()
            logger.info(f"[RAG] Chroma collection count: {collection_count}")
            if collection_count == 0:
                logger.warning(f"[RAG] Vector store at '{VECTORSTORE_PATH}' loaded but returned 0 documents via count. RAG disabled.")
                rag_available = False
            else:
                logger.info(f"[RAG] Vector store loaded successfully with ~{collection_count} items.")
                retriever = vector_store.as_retriever(
                    search_type="similarity",
                    search_kwargs={"k": 5}
                )
                logger.info(f"[RAG] Retriever created (search_type=similarity, search_kwargs={{'k': 5}}).")

                # --- MODIFIED: Added language instruction to RAG Prompt ---
                rag_template = """Answer the following question using the provided context. Try to base your answer directly on the information found.
If the context clearly doesn't contain the information needed to answer, state that the provided documents do not seem to contain the answer.
***Importantly, present the answer in the same language as the QUESTION is asked.***

CONTEXT:
{context}

QUESTION:
{question}

ANSWER:"""
                # ----------------------------------------------------------
                rag_prompt = PromptTemplate.from_template(rag_template)
                logger.info("[RAG] Using RAG prompt with language instruction.") # Updated log message

                # --- format_docs function (keep as before) ---
                def format_docs(docs: list[Document]) -> str:
                    if not docs:
                        logger.warning("[RAG] Retriever returned NO documents for the query.")
                        return "No relevant context found in documents."

                    formatted = []
                    sources = set()
                    logger.debug(f"[RAG] Retriever returned {len(docs)} document chunks:")
                    for i, doc in enumerate(docs):
                        source_name = Path(doc.metadata.get('source', 'Unknown Source')).name
                        sources.add(source_name)
                        prefix = f"--- Context from: {source_name} (Chunk {i+1}) ---\n"
                        chunk_content = doc.page_content
                        logger.debug(f"[RAG] Chunk {i+1} (Source: {source_name}) Content Start:\n{chunk_content[:300]}...\n")
                        formatted.append(f"{prefix}{chunk_content}")

                    log_sources = ', '.join(sorted(list(sources))) if sources else "None"
                    logger.debug(f"[RAG] Formatted context from sources: [{log_sources}] for prompt.")
                    return "\n\n".join(formatted)

                # --- invoke_direct_model_rag function (keep as before) ---
                def invoke_direct_model_rag(prompt_value: str):
                    try:
                        response = direct_genai_model.generate_content(prompt_value)

                        if not response.candidates:
                            block_reason = response.prompt_feedback.block_reason if response.prompt_feedback else 'Unknown'
                            safety_ratings = response.prompt_feedback.safety_ratings if response.prompt_feedback else 'None'
                            logger.warning(f"[RAG] Model call returned no candidates. Block Reason: {block_reason}. Ratings: {safety_ratings}")
                            if block_reason != HarmBlockThreshold.BLOCK_REASON_UNSPECIFIED:
                                 return f"Error: Response blocked due to safety settings (Reason: {block_reason})."
                            return "Error: Model returned no response (Reason unknown)."
                        try:
                            return response.text
                        except ValueError as ve:
                             finish_reason = 'Unknown'
                             safety_ratings = 'Unknown'
                             if response.candidates:
                                finish_reason = response.candidates[0].finish_reason
                                safety_ratings = response.candidates[0].safety_ratings
                             logger.warning(f"[RAG] Model call failed accessing .text (ValueError: {ve}). Finish Reason: {finish_reason}. Safety: {safety_ratings}")
                             return f"Error: Response generation stopped prematurely (Reason: {finish_reason})."
                        except StopCandidateException as sce:
                             logger.warning(f"[RAG] Response generation stopped by StopCandidateException: {sce}")
                             return f"Error: Response generation stopped (Reason: {sce})"

                    except Exception as e:
                        logger.error(f"[RAG] Unexpected error invoking model during RAG: {e}", exc_info=True)
                        return f"Error during RAG generation process: {e}"

                # --- log_final_rag_prompt function (keep as before) ---
                def log_final_rag_prompt(prompt_str: str) -> str:
                    logger.debug(f"[RAG] Final combined prompt string being sent to LLM:\n--- START RAG PROMPT ---\n{prompt_str}\n--- END RAG PROMPT ---")
                    return prompt_str

                # --- RAG Chain Definition (keep as before) ---
                rag_chain = (
                    {"context": retriever | format_docs, "question": RunnablePassthrough()}
                    | rag_prompt
                    | RunnableLambda(lambda prompt_value: prompt_value.to_string())
                    | RunnableLambda(log_final_rag_prompt)
                    | RunnableLambda(invoke_direct_model_rag)
                )
                rag_available = True
                logger.info("[RAG] RAG chain created with language instruction, similarity retriever, and enhanced logging. RAG IS ENABLED.") # Updated log message

        except Exception as e:
            rag_init_error = f"[RAG] RAG component initialization failed: {e}"
            logger.error(rag_init_error, exc_info=True)
            vector_store = retriever = embeddings = rag_chain = None
            rag_available = False
            if not initialization_error: initialization_error = rag_init_error

elif not initialization_error and direct_genai_model:
     logger.warning(f"Vector store path '{VECTORSTORE_PATH}' does not exist. RAG IS DISABLED.")
     rag_available = False


# --- General Chat & Router Setup ---
if direct_genai_model:
    try:
        def invoke_direct_model_general(prompt_value: ChatPromptValue):
            """Invokes the direct Gemini model for General Chat/Router, handling history format."""
            try:
                langchain_messages = prompt_value.to_messages()
                history_for_api = []
                system_instruction = None

                for msg in langchain_messages:
                    role = "user" if isinstance(msg, HumanMessage) else "model"
                    if isinstance(msg, SystemMessage):
                         system_instruction = msg.content
                         logger.debug(f"General/Router extracted system instruction (first 100 chars): {system_instruction[:100]}...")
                         # Check if GENERAL_SYSTEM_MESSAGE already contains language instruction
                         if "respond in the same language" not in system_instruction.lower():
                             logger.warning("GENERAL_SYSTEM_MESSAGE in settings.py might be missing language instruction!")
                         continue
                    if msg.content:
                        history_for_api.append({'role': role, 'parts': [msg.content]})

                if not history_for_api:
                     logger.error("Cannot generate response: No valid user/model messages found after processing prompt.")
                     return "Error: Cannot generate response without valid input message(s)."

                if system_instruction:
                    # System instruction handled via settings.py and potentially model tuning
                    logger.debug("System instruction provided via settings.py/prompt template.")

                logger.debug(f"Invoking direct model (General/Router) with {len(history_for_api)} history entries.")

                response = direct_genai_model.generate_content(
                    history_for_api,
                    # system_instruction=... # Typically not used directly here with Gemini history format
                )

                if not response.candidates:
                    block_reason = response.prompt_feedback.block_reason if response.prompt_feedback else 'Unknown'
                    safety_ratings = response.prompt_feedback.safety_ratings if response.prompt_feedback else 'None'
                    logger.warning(f"General/Router direct model call returned no candidates. Block Reason: {block_reason}. Ratings: {safety_ratings}")
                    if block_reason != HarmBlockThreshold.BLOCK_REASON_UNSPECIFIED:
                         return f"Error: Response blocked due to safety settings (Reason: {block_reason})."
                    return "Error: Model returned no response (Reason unknown)."
                try:
                     return response.text
                except ValueError as ve:
                     finish_reason = 'Unknown'
                     safety_ratings = 'Unknown'
                     if response.candidates:
                        finish_reason = response.candidates[0].finish_reason
                        safety_ratings = response.candidates[0].safety_ratings
                     logger.warning(f"General/Router direct model call failed accessing .text (ValueError: {ve}). Finish Reason: {finish_reason}. Safety: {safety_ratings}")
                     return f"Error: Response generation stopped prematurely (Reason: {finish_reason})."
                except StopCandidateException as sce:
                     logger.warning(f"General/Router response generation stopped by StopCandidateException: {sce}")
                     return f"Error: Response generation stopped (Reason: {sce})"

            except Exception as e:
                logger.error(f"Error invoking direct model (General/Router): {e}", exc_info=True)
                return f"Error during generation: {e}"

        # --- Router Chain (keep as before) ---
        router_template = """Classify the user's query. Your goal is to decide if the query requires searching specific documents for a factual answer.

Output only 'SEARCH_DOCS' if the query asks for specific factual details, definitions, steps, criteria, data, or information likely found within uploaded documents (such as educational standards, curriculum details, project specifications, user guides, procedures, reports). Examples of queries needing SEARCH_DOCS: "What are the criteria for X?", "List the steps for Y.", "Define Z according to the standard document.", "What does document A say about topic B?".

Otherwise, output 'GENERAL_CHAT'. This includes greetings, casual conversation, questions about your capabilities, opinions, summarization requests (unless about specific document content), or broadly defined topics not referencing specific document details. Examples of queries needing GENERAL_CHAT: "Hello", "What can you do?", "Summarize the main points about IT competence.", "What is your opinion on X?".

Chat History:
{chat_history}

User Query: {query}
Classification:"""
        router_prompt = ChatPromptTemplate.from_template(router_template)

        class DecisionParser(StrOutputParser):
             def parse(self, text: str) -> str:
                cleaned = super().parse(text).strip().upper()
                logger.debug(f"Router raw output: '{text}', Cleaned Classification: '{cleaned}'")
                if "SEARCH_DOCS" in cleaned:
                    return "SEARCH_DOCS"
                elif "GENERAL_CHAT" in cleaned:
                    return "GENERAL_CHAT"
                else:
                    logger.warning(f"Router classification uncertain ('{cleaned}'). Defaulting to GENERAL_CHAT.")
                    return "GENERAL_CHAT"

        router_chain = (
             router_prompt
             | RunnableLambda(invoke_direct_model_general)
             | DecisionParser()
        )
        logger.info("Router chain created.")

        # --- General Chat Chain (keep as before) ---
        # Ensure GENERAL_SYSTEM_MESSAGE in settings.py includes language instructions
        general_prompt = ChatPromptTemplate.from_messages([
            SystemMessage(content=GENERAL_SYSTEM_MESSAGE),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{query}")
        ])

        general_chat_chain = (
             general_prompt
             | RunnableLambda(invoke_direct_model_general)
        )
        logger.info("General chat chain created.")

    except Exception as e:
         chain_init_error = f"Failed to create router/general chain: {e}"
         logger.error(chain_init_error, exc_info=True)
         router_chain = general_chat_chain = None
         if not initialization_error: initialization_error = chain_init_error

elif not initialization_error:
    initialization_error = initialization_error or "Core chat model (direct genai) failed initialization."
    logger.error(f"Cannot create chains because core model initialization failed: {initialization_error}")
    router_chain = general_chat_chain = None


# --- Helper Functions (keep as before) ---

def format_history_for_langchain(db_history: list) -> list:
    messages = []
    for msg in db_history:
        role = msg.get("role")
        content = str(msg.get("content", "")).strip()
        if not content: continue

        if role == "user": messages.append(HumanMessage(content=content))
        elif role == "model": messages.append(AIMessage(content=content))
    return messages

# --- Core API Functions (keep as before) ---

def get_response(user_query: str, chat_id: str) -> str:
    if not router_chain or not general_chat_chain or not direct_genai_model:
        core_error = initialization_error or "Chatbot core components not initialized."
        logger.error(f"[{chat_id}] Cannot get response: {core_error}")
        raise ConnectionError(f"Chatbot is not ready due to initialization issues. Please check logs. Error: {core_error}")

    user_query = str(user_query or "").strip()
    if not user_query:
        logger.warning(f"[{chat_id}] Received empty user query.")
        return "Please enter a query."

    raw_history_for_router_db = load_chat_history(chat_id, limit=4)
    router_history_str = "\n".join([f"{msg.get('role','unknown')}: {msg.get('content','')}" for msg in raw_history_for_router_db])

    raw_history_for_chat_db = load_chat_history(chat_id, limit=HISTORY_LIMIT)
    formatted_history_for_chat = format_history_for_langchain(raw_history_for_chat_db)

    try:
        logger.debug(f"[{chat_id}] Routing query (first 60 chars): '{user_query[:60]}...'")
        routing_decision = router_chain.invoke({
            "chat_history": router_history_str,
            "query": user_query
        })
        logger.info(f"[{chat_id}] Router decision: {routing_decision}")

        response_text = None

        if routing_decision == "SEARCH_DOCS":
            if rag_available and rag_chain:
                logger.info(f"[{chat_id}][RAG] Executing RAG chain.")
                response_text = rag_chain.invoke(user_query)
                if response_text is None or response_text.startswith("Error:"):
                    logger.warning(f"[{chat_id}][RAG] RAG chain produced an error or no response: '{response_text}'. Falling back to General Chat.")
                else:
                     logger.debug(f"[{chat_id}][RAG] RAG chain successful.")

            else:
                logger.warning(f"[{chat_id}] Router chose SEARCH_DOCS, but RAG is unavailable/disabled. Falling back to General Chat.")
                general_response = general_chat_chain.invoke({
                    "chat_history": formatted_history_for_chat,
                    "query": user_query
                })
                response_text = f"(Note: I tried to search documents for this, but couldn't access them.)\n\n{general_response}"

        if response_text is None or response_text.startswith("Error:"):
            if routing_decision != "GENERAL_CHAT":
                 logger.info(f"[{chat_id}] Router decided '{routing_decision}', but executing General Chat chain (due to RAG unavailable/error or fallback).")
            else:
                 logger.info(f"[{chat_id}] Executing General Chat chain.")

            response_text = general_chat_chain.invoke({
                "chat_history": formatted_history_for_chat,
                "query": user_query
            })

        final_response = str(response_text) if response_text is not None else "Sorry, I encountered an issue generating a response."
        logger.debug(f"[{chat_id}] Final response generated (first 100 chars): {final_response[:100]}...")
        return final_response

    except StopCandidateException as safety_exception:
         logger.warning(f"[{chat_id}] Response generation blocked by safety filter at outer level: {safety_exception}")
         return "I cannot provide a response to this query due to safety guidelines."
    except Exception as e:
        logger.error(f"[{chat_id}] Critical error during get_response execution: {e}", exc_info=True)
        return f"Sorry, a processing error occurred while handling your request."


def load_chat_history(chat_id: str, limit: int = HISTORY_LIMIT) -> list:
    history = []
    if chat_collection is None:
        logger.warning(f"[{chat_id}] Cannot load history: MongoDB collection not available.")
        return history
    try:
        history_cursor = chat_collection.find(
            {"chat_id": chat_id},
            projection={"role": 1, "content": 1, "timestamp": 1, "_id": 0}
        ).sort("timestamp", pymongo.DESCENDING).limit(limit)
        db_history = list(history_cursor)
        db_history.reverse()
        history = db_history
        logger.debug(f"[{chat_id}] Loaded {len(history)} messages from DB history (limit={limit}).")
    except Exception as e:
        logger.error(f"[{chat_id}] Error loading history from DB: {e}", exc_info=True)
    return history

def save_chat_messages(chat_id: str, user_message: str, model_response: str):
    if chat_collection is None:
        logger.warning(f"[{chat_id}] Cannot save messages: MongoDB collection not available.")
        return
    try:
        user_message_str = str(user_message or "").strip()
        model_response_str = str(model_response or "").strip()

        if not user_message_str and not model_response_str:
            logger.warning(f"[{chat_id}] Attempted to save empty user and model messages. Skipping.")
            return

        timestamp = datetime.utcnow()
        docs_to_insert = []
        if user_message_str:
             docs_to_insert.append({
                 "chat_id": chat_id,
                 "role": "user",
                 "content": user_message_str,
                 "timestamp": timestamp
             })
        if model_response_str:
             docs_to_insert.append({
                 "chat_id": chat_id,
                 "role": "model",
                 "content": model_response_str,
                 "timestamp": timestamp
             })

        if docs_to_insert:
            chat_collection.insert_many(docs_to_insert)
            logger.debug(f"[{chat_id}] Saved {len(docs_to_insert)} message(s) to DB.")
        else:
             logger.debug(f"[{chat_id}] No valid messages provided to save.")

    except OperationFailure as ofe:
         logger.error(f"[{chat_id}] MongoDB operation failed during message save: {ofe}", exc_info=True)
    except Exception as e:
        logger.error(f"[{chat_id}] Error saving messages: {e}", exc_info=True)


# --- Chat List & Management (keep as before) ---

def get_chat_list() -> list:
    chat_list_result = []
    if chat_collection is None:
        logger.warning("Cannot get chat list: MongoDB collection not available.")
        return chat_list_result
    try:
        pipeline = [
            {"$sort": {"timestamp": pymongo.ASCENDING}},
            {"$group": {
                "_id": "$chat_id",
                "first_doc": {"$first": "$$ROOT"},
                "latest_ts": {"$last": "$timestamp"}
            }},
            {"$sort": {"latest_ts": pymongo.DESCENDING}},
            {"$project": {
                "chat_id": "$_id",
                "first_message_content": "$first_doc.content",
                "first_message_role": "$first_doc.role",
                "custom_title": "$first_doc.custom_title",
                "first_message_timestamp": "$first_doc.timestamp",
                "_id": 0
            }}
        ]
        unique_chats_cursor = chat_collection.aggregate(pipeline)

        for chat_data in unique_chats_cursor:
            chat_id = chat_data.get('chat_id')
            if not chat_id: continue

            title = chat_data.get('custom_title')
            if not title:
                first_content = str(chat_data.get('first_message_content', '') or "").strip()
                first_role = chat_data.get('first_message_role')
                max_len = CHAT_TITLE_MAX_LENGTH

                if first_role == 'user' and first_content:
                    title = first_content[:max_len] + ('...' if len(first_content) > max_len else '')
                elif first_role == 'model' and first_content:
                     prefix = "Bot: "
                     available_len = max_len - len(prefix)
                     if available_len > 0:
                         title = prefix + first_content[:available_len] + ('...' if len(first_content) > available_len else '')
                     else:
                          title = first_content[:max_len] + ('...' if len(first_content) > max_len else '')

                if not title:
                    timestamp = chat_data.get('first_message_timestamp')
                    default_title = f"Chat {chat_id[:6]}..."
                    if timestamp and isinstance(timestamp, datetime):
                        try:
                            default_title = timestamp.strftime("Chat %b %d, %H:%M")
                        except ValueError: pass
                    title = default_title

            chat_list_result.append({"chat_id": chat_id, "title": title or f"Chat {chat_id[:6]}..."})

        logger.info(f"Retrieved {len(chat_list_result)} unique chats.")
    except OperationFailure as ofe:
         logger.error(f"MongoDB operation failed during get_chat_list: {ofe}", exc_info=True)
    except Exception as e:
        logger.error(f"Error getting chat list: {e}", exc_info=True)
    return chat_list_result


def update_session_title(chat_id: str, new_title: str) -> bool:
    if chat_collection is None:
        logger.warning(f"[{chat_id}] Cannot update title: MongoDB collection not available.")
        return False
    try:
        first_message = chat_collection.find_one(
            {"chat_id": chat_id},
            sort=[("timestamp", pymongo.ASCENDING)],
            projection={"_id": 1}
        )
        if not first_message:
             logger.warning(f"[{chat_id}] Cannot update title: Chat session not found or has no messages.")
             return False

        result = chat_collection.update_one(
            {"_id": first_message['_id']},
            {"$set": {"custom_title": str(new_title or "").strip()}}
        )
        success = result.modified_count > 0
        logger.info(f"[{chat_id}] Update title result: Matched={result.matched_count}, Modified={result.modified_count}. Success: {success}")
        return success
    except OperationFailure as ofe:
        logger.error(f"[{chat_id}] MongoDB operation failed during title update: {ofe}", exc_info=True)
        return False
    except Exception as e:
        logger.error(f"[{chat_id}] Error updating title: {e}", exc_info=True)
        return False

def delete_session_history(chat_id: str) -> int:
    deleted_count = 0
    if chat_collection is None:
        logger.warning(f"[{chat_id}] Cannot delete history: MongoDB collection not available.")
        return deleted_count
    try:
        result = chat_collection.delete_many({"chat_id": chat_id})
        deleted_count = result.deleted_count
        logger.info(f"[{chat_id}] Deleted {deleted_count} history documents.")
    except OperationFailure as ofe:
         logger.error(f"[{chat_id}] MongoDB operation failed during history deletion: {ofe}", exc_info=True)
    except Exception as e:
         logger.error(f"[{chat_id}] Error deleting history: {e}", exc_info=True)
    return deleted_count