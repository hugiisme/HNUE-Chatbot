import os
import logging
import re # Import regex for potential cleaning
from django.core.management.base import BaseCommand
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from pathlib import Path
from typing import List

from langchain_google_genai import GoogleGenerativeAIEmbeddings
try:
    from langchain_chroma import Chroma
except ImportError:
    logging.warning("langchain-chroma not found, falling back to Chroma from langchain_community.")
    from langchain_community.vectorstores import Chroma
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import (
    Docx2txtLoader,
    DirectoryLoader,
    PyMuPDFLoader,
)
from langchain.docstore.document import Document

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = 'Builds or rebuilds the RAG vectorstore index from LOCAL documents using PyMuPDF for PDFs.'

    def _validate_settings(self) -> None:
        """Checks if required settings are configured."""
        required_settings = [
            'LOCAL_DOCUMENTS_PATH',
            'VECTORSTORE_PATH',
            'GEMINI_EMBEDDING_MODEL',
            'GEMINI_API_KEY',
        ]
        missing_settings = []
        for setting_name in required_settings:
            if not getattr(settings, setting_name, None):
                missing_settings.append(setting_name)

        if missing_settings:
            raise ImproperlyConfigured(
                f"The following settings are required for build_rag_index: {', '.join(missing_settings)}"
            )
        self.stdout.write(self.style.HTTP_INFO("Required settings validated."))

    def _load_local_docs(self, docs_path: str) -> List[Document]:
        """Loads PDF (using PyMuPDF) and DOCX documents recursively."""
        all_docs: List[Document] = []
        processed_pdf_sources: set[str] = set()
        processed_docx_sources: set[str] = set() # Separate set for DOCX sources

        path_obj = Path(docs_path)

        if not path_obj.is_dir():
            self.stderr.write(self.style.ERROR(f"Local documents directory not found or not a directory: {docs_path}"))
            return []

        self.stdout.write(f"Scanning for documents in local directory: {docs_path}")

        pdf_glob = "**/*.pdf"
        docx_glob = "**/*.docx"

        # --- PDF Loader ---
        self.stdout.write(self.style.HTTP_INFO("Configuring PDF loader using PyMuPDFLoader."))
        pdf_loader = DirectoryLoader(
            str(path_obj),
            glob=pdf_glob,
            loader_cls=PyMuPDFLoader,
            recursive=True,
            show_progress=True,
            silent_errors=True
        )
        # --- DOCX Loader ---
        self.stdout.write(self.style.HTTP_INFO("Configuring DOCX loader using Docx2txtLoader (error reporting enabled)."))
        docx_loader = DirectoryLoader(
            str(path_obj),
            glob=docx_glob,
            loader_cls=Docx2txtLoader,
            recursive=True,
            show_progress=True,
            use_multithreading=True, # Keep enabled unless issues arise
            silent_errors=False # Keep False to see errors during debugging
        )
        # -----------------------------

        loaded_pdf_sections_count = 0
        loaded_docx_sections_count = 0 # Separate count for DOCX
        errors_occurred_pdf = False
        errors_occurred_docx = False

        # --- Loading PDF Files ---
        try:
            self.stdout.write(" -> Loading PDF files using PyMuPDFLoader...")
            pdf_docs = pdf_loader.load()
            loaded_pdf_sections_count = len(pdf_docs) # Update specific count
            self.stdout.write(f" -> Found {loaded_pdf_sections_count} sections in PDF files.")
            for doc in pdf_docs:
                 source_name = Path(doc.metadata.get('source', 'unknown')).name
                 doc.metadata['source'] = source_name
                 if source_name != 'unknown':
                    processed_pdf_sources.add(source_name)
            all_docs.extend(pdf_docs)
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Unexpected error during PDF loading phase (PyMuPDF): {e}"))
            logger.error("PDF loading with PyMuPDF failed", exc_info=True)
            errors_occurred_pdf = True
        # -----------------------

        # --- Loading DOCX Files ---
        try:
            # ADDED: Explicit log before attempting to load DOCX
            self.stdout.write(" -> Attempting to load DOCX files (errors will be shown)...")
            docx_docs = docx_loader.load()
            loaded_docx_sections_count = len(docx_docs) # Update specific count
            # ADDED: Clearer log message for DOCX success/failure
            if loaded_docx_sections_count > 0:
                self.stdout.write(self.style.SUCCESS(f" -> Successfully loaded {loaded_docx_sections_count} sections from DOCX files."))
            else:
                # If no error occurred but count is 0, it means no DOCX files were found or they were empty
                self.stdout.write(self.style.WARNING(" -> No sections loaded from DOCX files (either none found or files were empty/unreadable)."))

            for doc in docx_docs: # Process metadata even if count is 0 (though loop won't run)
                 source_name = Path(doc.metadata.get('source', 'unknown')).name
                 doc.metadata['source'] = source_name
                 if source_name != 'unknown':
                     processed_docx_sources.add(source_name)
            all_docs.extend(docx_docs)
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Error during DOCX loading phase: {e}"))
            logger.error("DOCX loading failed", exc_info=True)
            errors_occurred_docx = True
        # ------------------------

        # --- Summary ---
        total_loaded_sections = loaded_pdf_sections_count + loaded_docx_sections_count
        processed_files_sources = processed_pdf_sources.union(processed_docx_sources)
        processed_count = len(processed_files_sources)

        total_files_in_dir = sum(1 for f in path_obj.rglob("*") if f.is_file() and f.suffix.lower() in ['.pdf', '.docx'])
        skipped_files = total_files_in_dir - processed_count if total_files_in_dir >= processed_count else 0
        errors_occurred = errors_occurred_pdf or errors_occurred_docx

        summary_style = self.style.SUCCESS if not errors_occurred else self.style.WARNING
        # UPDATED: More detailed summary
        self.stdout.write(summary_style(
            f"Finished loading local files. "
            f"Total sections loaded: {total_loaded_sections} ({loaded_pdf_sections_count} PDF, {loaded_docx_sections_count} DOCX). "
            f"Processed unique source files (approx): {processed_count}. "
            f"Potential skipped/error files (approx): {skipped_files}"
        ))
        if errors_occurred:
             self.stdout.write(self.style.WARNING("Note: Errors occurred during the loading phase. Check specific error messages above or logs for details."))
        # ---------------

        return all_docs


    def handle(self, *args, **options) -> None:
        """Main command execution logic."""
        self.stdout.write(self.style.NOTICE("Starting LOCAL RAG index build process..."))

        # --- 1. Validate Settings ---
        try:
            self._validate_settings()
        except ImproperlyConfigured as e:
            self.stderr.write(self.style.ERROR(f"Configuration error: {e}"))
            return

        # --- 2. Load Documents ---
        docs_path = settings.LOCAL_DOCUMENTS_PATH
        self.stdout.write(f"DEBUG: Using LOCAL_DOCUMENTS_PATH = {docs_path}")
        documents = self._load_local_docs(docs_path)

        if not documents:
            self.stdout.write(self.style.WARNING("No document sections loaded or an error prevented loading. Index build aborted."))
            return

        # --- 3. Split Documents ---
        self.stdout.write("Splitting documents into chunks...")
        chunk_size = getattr(settings, 'RAG_CHUNK_SIZE', 1000)
        chunk_overlap = getattr(settings, 'RAG_CHUNK_OVERLAP', 150)
        self.stdout.write(f" -> Using chunk_size={chunk_size}, chunk_overlap={chunk_overlap}")
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
            is_separator_regex=False,
        )
        try:
            chunks = text_splitter.split_documents(documents)
            self.stdout.write(f"Split documents into {len(chunks)} chunks.")
        except Exception as e:
             self.stderr.write(self.style.ERROR(f"Error during document splitting: {e}"))
             logger.error("Document splitting failed", exc_info=True)
             return

        if not chunks:
             self.stdout.write(self.style.WARNING("No chunks created after splitting (perhaps documents were empty?). Index build aborted."))
             return

        # --- 4. Initialize Embeddings ---
        self.stdout.write(f"Initializing embeddings using model: {settings.GEMINI_EMBEDDING_MODEL}")
        try:
            embeddings = GoogleGenerativeAIEmbeddings(
                model=settings.GEMINI_EMBEDDING_MODEL,
                google_api_key=settings.GEMINI_API_KEY
            )
            self.stdout.write(" -> Testing embedding model connection...")
            _ = embeddings.embed_query("test query for embedding model")
            self.stdout.write(self.style.SUCCESS(" -> Embeddings initialized and tested successfully."))
        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Failed to initialize or test embeddings: {e}"))
            self.stderr.write(self.style.ERROR("Ensure GEMINI_API_KEY is valid, the model name is correct, and network connectivity is okay."))
            logger.error("Embedding initialization failed", exc_info=True)
            return

        # --- 5. Build and Persist Vector Store ---
        vectorstore_path = str(settings.VECTORSTORE_PATH)
        self.stdout.write(f"Preparing Chroma vector store at: {vectorstore_path}")
        self.stdout.write(self.style.WARNING("WARNING: This will create/update the index in the target directory."))
        self.stdout.write(self.style.WARNING("Existing data in that Chroma index directory might be replaced or merged depending on Chroma's behavior."))

        try:
            os.makedirs(vectorstore_path, exist_ok=True)

            self.stdout.write(f" -> Building Chroma index with {len(chunks)} chunks... (This might take a while)")
            vector_store = Chroma.from_documents(
                documents=chunks,
                embedding=embeddings,
                persist_directory=vectorstore_path
            )

            final_count = vector_store._collection.count()
            if final_count != len(chunks):
                self.stdout.write(self.style.WARNING(f" -> Initial chunk count ({len(chunks)}) differs from final vector count ({final_count}). This might indicate issues during embedding/indexing."))
            self.stdout.write(self.style.SUCCESS(f" -> Successfully built and persisted Chroma index. Final vector count: {final_count}"))

        except Exception as e:
            self.stderr.write(self.style.ERROR(f"Failed to build or persist Chroma index: {e}"))
            logger.error("Chroma index build failed", exc_info=True)
            return

        self.stdout.write(self.style.SUCCESS("LOCAL RAG index build process completed successfully."))