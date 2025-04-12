// script.js
let currentlyOpenMenu = null;
let activeEditItem = null;
let isWaitingForResponse = false;
let currentChatId = null;

let chatListSubmenu = null;
let chatbox = null;
let inputField = null;
let submitButton = null;
let mainTitleElement = null;
let newChatButton = null;
const DEFAULT_CHAT_TITLE_JS = "Untitled Chat"; // Match python default

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== "") {
        const cookies = document.cookie.split(";");
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === name + "=") {
                cookieValue = decodeURIComponent(
                    cookie.substring(name.length + 1)
                );
                break;
            }
        }
    }
    return cookieValue;
}

function closeOpenMenu() {
    if (currentlyOpenMenu) {
        if (document.body.contains(currentlyOpenMenu)) {
            currentlyOpenMenu.classList.remove("visible");
            setTimeout(() => {
                if (
                    currentlyOpenMenu &&
                    !currentlyOpenMenu.classList.contains("visible")
                ) {
                    currentlyOpenMenu.style.display = "none";
                }
            }, 150);
        }
        currentlyOpenMenu = null;
    }
}

function exitEditMode(listItem, restoreOriginal = false) {
    if (!listItem || !listItem.classList.contains("editing")) return;

    const inputElement = listItem.querySelector(".edit-title-input");
    const titleSpan = listItem.querySelector(".chat-title-text");

    if (
        restoreOriginal &&
        inputElement &&
        inputElement.dataset.originalTitle &&
        titleSpan
    ) {
        const originalTitle = inputElement.dataset.originalTitle;
        inputElement.value = originalTitle;
        // Truncate if needed for display span
        const maxLen = 35; // Should match addChatToSidebar display truncation
        let displayTitle = originalTitle;
        if (displayTitle.length > maxLen) {
            displayTitle = displayTitle.substring(0, maxLen) + "...";
        }
        titleSpan.textContent = displayTitle;
    }

    listItem.classList.remove("editing");

    if (listItem === activeEditItem) {
        activeEditItem = null;
    }
    console.log("[script] Exited edit mode for", listItem.dataset.chatId);
}

function updateMainTitle(forceTitle = null) {
    if (!mainTitleElement) {
        console.error("[script] mainTitleElement missing");
        return;
    }
    let finalTitle = "Gemini Chat"; // Absolute default if no chat context
    const safeChatListSubmenu = document.querySelector(".chatlist .submenu");

    if (
        forceTitle !== null &&
        typeof forceTitle === "string" &&
        forceTitle.trim() !== ""
    ) {
        finalTitle = forceTitle.trim();
        console.log("[script] Updating main title (forced):", finalTitle);
    } else if (currentChatId && safeChatListSubmenu) {
        try {
            const targetListItem = safeChatListSubmenu.querySelector(
                `.submenu-content[data-chat-id="${currentChatId}"]`
            );
            if (targetListItem) {
                // Get the *full* title from the link's title attribute or input's data
                const linkElement = targetListItem.querySelector(".chat-link");
                const inputElement =
                    targetListItem.querySelector(".edit-title-input");
                let currentItemTitle = linkElement
                    ?.getAttribute("title")
                    ?.trim();
                if (!currentItemTitle) {
                    currentItemTitle =
                        inputElement?.dataset?.originalTitle?.trim();
                }

                if (currentItemTitle) {
                    finalTitle = currentItemTitle;
                    console.log(
                        "[script] Updating main title (from sidebar item full title):",
                        finalTitle
                    );
                } else {
                    // Fallback if somehow title attribute/data is missing
                    const titleSpan =
                        targetListItem.querySelector(".chat-title-text");
                    finalTitle =
                        titleSpan?.textContent?.trim() || DEFAULT_CHAT_TITLE_JS;
                    console.log(
                        "[script] Updating main title (sidebar item title attribute missing, using span/default):",
                        finalTitle
                    );
                }
            } else {
                // Chat selected but not found in list (shouldn't happen often)
                finalTitle = DEFAULT_CHAT_TITLE_JS;
                console.log(
                    "[script] Updating main title (sidebar item not found, using default):",
                    finalTitle
                );
            }
        } catch (e) {
            console.error("[script] Error finding sidebar item title:", e);
            finalTitle = DEFAULT_CHAT_TITLE_JS;
            console.log(
                "[script] Updating main title (error finding sidebar item, using default):",
                finalTitle
            );
        }
    } else {
        // No current chat ID, use the main default
        console.log(
            "[script] Updating main title (no current chat ID or sidebar, using default):",
            finalTitle
        );
    }

    mainTitleElement.textContent = finalTitle;
    document.title = `${finalTitle} - Gemini Chatbot`;
}

function scrollToBottom() {
    if (chatbox) {
        requestAnimationFrame(() => {
            // Scroll down more aggressively
            chatbox.scrollTop = chatbox.scrollHeight;
        });
    }
}

function appendMessage(text, sender, isLoading = false) {
    if (!chatbox) return null;
    const messageDiv = document.createElement("div");
    messageDiv.classList.add(
        "message",
        sender === "user" ? "user-message" : "bot-message"
    );

    if (isLoading) {
        messageDiv.id = "loading-indicator";
        const loadingContainer = document.createElement("span");
        loadingContainer.classList.add("loading-dots-container");

        for (let i = 0; i < 3; i++) {
            const dot = document.createElement("span");
            dot.classList.add("dot-flashing");

            loadingContainer.appendChild(dot);
        }
        messageDiv.appendChild(loadingContainer);
    } else {
        // Basic check for potentially harmful HTML (replace < and >)
        // For full safety, use a proper sanitizer library if input allows HTML
        const safeText = text.replace(/</g, "<").replace(/>/g, ">");
        messageDiv.innerHTML = safeText.replace(/\n/g, "<br>");
    }

    chatbox.appendChild(messageDiv);
    scrollToBottom(); // Ensure scroll happens after adding
    return messageDiv;
}

function loadInitialHistory() {
    const historyDataElement = document.getElementById("chat-history-data");
    if (!chatbox) {
        console.error(
            "[script] Chatbox element not found during history load."
        );
        return;
    }
    chatbox.innerHTML = ""; // Clear previous messages

    if (historyDataElement?.textContent) {
        try {
            const chatHistory = JSON.parse(historyDataElement.textContent);
            if (Array.isArray(chatHistory) && chatHistory.length > 0) {
                console.log(
                    `[script] Loading ${chatHistory.length} history messages for chat_id:`,
                    currentChatId
                );
                const fragment = document.createDocumentFragment();
                chatHistory.forEach((message) => {
                    const role = message?.role;
                    let content = message?.content; // Prefer content field

                    // Basic validation
                    if (role && typeof content === "string" && content.trim()) {
                        const sender = role === "user" ? "user" : "bot";
                        const msgDiv = document.createElement("div");
                        msgDiv.classList.add(
                            "message",
                            sender === "user" ? "user-message" : "bot-message"
                        );
                        // Sanitize potentially harmful HTML
                        const safeContent = content
                            .replace(/</g, "<")
                            .replace(/>/g, ">");
                        msgDiv.innerHTML = safeContent.replace(/\n/g, "<br>");
                        fragment.appendChild(msgDiv);
                    } else {
                        console.warn(
                            "[script] Skipping invalid/empty message format in history:",
                            message
                        );
                    }
                });
                chatbox.appendChild(fragment);
                setTimeout(scrollToBottom, 50); // Scroll after DOM updates
            } else if (currentChatId) {
                // Only log if we expected history
                console.log(
                    "[script] History data found but empty or not an array for chat_id:",
                    currentChatId
                );
            }
            // Do NOT add "Bắt đầu..." message here
        } catch (e) {
            console.error("[script] Error parsing chat history JSON:", e);
            const errorMsg = "Lỗi: Không thể tải lịch sử trò chuyện.";
            appendMessage(errorMsg, "bot"); // Show error in chat
        }
    } else if (currentChatId) {
        // Only log if we expected history
        console.log(
            "[script] No history data element found in DOM for chat_id:",
            currentChatId
        );
    }
    // Do NOT add "Bắt đầu..." message if no history element found
}

function toggleInput(enabled) {
    if (inputField) {
        inputField.disabled = !enabled;
        inputField.placeholder = enabled
            ? "Nhập tin nhắn..."
            : "Đang đợi phản hồi...";
        inputField.classList.toggle("disabled", !enabled);
    }
    if (submitButton) {
        submitButton.disabled = !enabled;
        submitButton.classList.toggle("disabled", !enabled);
        const icon = submitButton.querySelector("i");
        if (icon) {
            icon.className = enabled
                ? "bx bxs-send"
                : "bx bx-loader-alt bx-spin";
        }
    }
}

async function sendMessage() {
    if (isWaitingForResponse || !inputField || !submitButton) return;
    const userInput = inputField.value.trim();
    if (!userInput) return;

    const isFirstMessage = !currentChatId;

    console.log(
        `[script] Sending message. Current Chat ID: ${
            currentChatId || "NEW CHAT"
        }`
    );

    appendMessage(userInput, "user");

    const originalInputValue = inputField.value; // Keep original for title gen fallback if needed
    inputField.value = "";
    inputField.style.height = "auto"; // Reset height
    inputField.dispatchEvent(new Event("input")); // Trigger resize

    toggleInput(false);
    isWaitingForResponse = true;
    const loadingIndicator = appendMessage("...", "bot", true);

    try {
        const csrftoken = getCookie("csrftoken");
        if (!csrftoken) {
            throw new Error(
                "Lỗi xác thực (CSRF token missing). Vui lòng tải lại trang."
            );
        }

        const requestBody = { message: userInput };
        if (currentChatId) {
            requestBody.chat_id = currentChatId;
        }

        const response = await fetch("/api/chat/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": csrftoken,
            },
            body: JSON.stringify(requestBody),
        });

        if (loadingIndicator && chatbox?.contains(loadingIndicator)) {
            chatbox.removeChild(loadingIndicator);
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const responseText = await response.text();
            let errorDetail = responseText.substring(0, 300);
            if (responseText.trim().startsWith("<!DOCTYPE html>")) {
                errorDetail = "Server returned an HTML error page.";
            }
            // Attempt to parse as JSON if possible for detailed error
            try {
                const errorJson = JSON.parse(responseText);
                errorDetail = errorJson.error || errorDetail;
            } catch (parseError) {
                /* ignore if not JSON */
            }
            throw new Error(`Lỗi máy chủ (${response.status}). ${errorDetail}`);
        }

        const data = await response.json();

        if (!response.ok) {
            // Prefer data.error if available
            throw new Error(data.error || `Lỗi máy chủ: ${response.status}`);
        }

        // Process successful response
        if (data.response) {
            appendMessage(data.response, "bot");

            if (data.new_chat_id && isFirstMessage) {
                console.log(
                    "[script] New chat created. Received new chat ID:",
                    data.new_chat_id,
                    "| Received Title:",
                    data.title || "None"
                );
                currentChatId = data.new_chat_id;

                const newUrl = `/chat/?chat_id=${currentChatId}`;
                history.pushState({ chatId: currentChatId }, "", newUrl);
                console.log("[script] Updated browser URL to:", newUrl);

                // Use returned title, or default if missing
                const initialTitle = data.title || DEFAULT_CHAT_TITLE_JS;
                addChatToSidebar(currentChatId, initialTitle);
                updateMainTitle(initialTitle); // Update main title immediately
            } else if (data.new_chat_id && !isFirstMessage) {
                // This case should ideally not happen if backend logic is correct
                console.warn(
                    "[script] Received new_chat_id but it wasn't the first message. Ignoring."
                );
            }
        } else if (data.error) {
            // Handle specific bot errors returned in JSON
            const errorMsg = `Lỗi từ Bot: ${data.error}`;
            appendMessage(errorMsg, "bot");
        } else {
            // Response ok, but unexpected format
            const errorMsg = "Đã nhận được phản hồi không mong đợi từ bot.";
            appendMessage(errorMsg, "bot");
        }
    } catch (error) {
        console.error("[script] Error sending message:", error);
        const loadingElem = document.getElementById("loading-indicator");
        if (loadingElem && chatbox?.contains(loadingElem)) {
            chatbox.removeChild(loadingElem);
        }
        // Display a user-friendly error message
        const errorMessage = `Lỗi: ${
            error.message ||
            "Không thể gửi tin nhắn. Vui lòng kiểm tra kết nối."
        }`;
        appendMessage(errorMessage, "bot");
    } finally {
        toggleInput(true);
        if (inputField) inputField.focus();
        isWaitingForResponse = false;
        scrollToBottom(); // Ensure scroll after response/error
    }
}

function addChatToSidebar(chatId, initialTitle) {
    if (!chatListSubmenu) {
        console.warn(
            "[script] Cannot add chat to sidebar: chatListSubmenu element not found."
        );
        return;
    }

    const placeholder = chatListSubmenu.querySelector(".no-chats-placeholder");
    if (placeholder) {
        placeholder.remove();
    }

    const fullTitle = initialTitle || DEFAULT_CHAT_TITLE_JS; // Use default if initial title is empty/null

    // Truncate for display
    const maxLen = 35; // Max length for the sidebar text span
    let displayTitle = fullTitle;
    if (fullTitle.length > maxLen) {
        displayTitle = fullTitle.substring(0, maxLen) + "...";
    }

    const newLi = document.createElement("li");
    newLi.classList.add("submenu-content");
    newLi.dataset.chatId = chatId;

    // Use fullTitle for the 'title' attribute and input value/dataset
    newLi.innerHTML = `
        <div class="chat-list-item">
            <a href="/chat/?chat_id=${chatId}" class="chat-link" title="${fullTitle}">
                <span class="chat-title-text">${displayTitle}</span>
            </a>
            <button class="chat-settings-btn" title="Tùy chọn"><i class="bx bx-dots-horizontal-rounded"></i></button>
        </div>
        <div class="edit-title-container">
            <input type="text" class="edit-title-input" value="${fullTitle}" data-original-title="${fullTitle}">
            <div class="edit-title-actions">
                <button class="save-title-btn" title="Lưu"><i class="bx bx-check"></i></button>
                <button class="cancel-title-btn" title="Hủy"><i class="bx bx-x"></i></button>
            </div>
        </div>
        <div class="chat-options-menu">
            <button class="rename-chat-btn"><i class="bx bx-pencil"></i> Đổi tên</button>
            <button class="delete-chat-btn"><i class="bx bx-trash"></i> Xóa</button>
        </div>
    `;

    chatListSubmenu.insertBefore(newLi, chatListSubmenu.firstChild);

    // Make the newly added chat active
    document
        .querySelectorAll(".submenu-content.active")
        .forEach((el) => el.classList.remove("active"));
    newLi.classList.add("active");

    console.log(
        `[script] Added chat ${chatId} to sidebar. Full title: "${fullTitle}", Display title: "${displayTitle}"`
    );
}

async function saveChatTitle(
    chatId,
    inputElement,
    listItem,
    titleSpan,
    linkElement
) {
    console.log(`[script] Attempting to save title for chat_id: ${chatId}`);
    const newTitle = inputElement.value.trim();
    const originalTitle =
        inputElement.dataset.originalTitle || titleSpan.textContent.trim(); // Fallback, should use dataset

    // Allow saving an empty title (will reset to default via backend logic)
    // if (!newTitle) {
    //     alert("Tiêu đề không được để trống.");
    //     inputElement.focus();
    //     return;
    // }

    if (newTitle === originalTitle) {
        console.log("[script] Title unchanged, exiting edit mode.");
        exitEditMode(listItem, false); // Exit without restoring, title is already correct
        return;
    }

    const saveButton = listItem.querySelector(".save-title-btn");
    const cancelButton = listItem.querySelector(".cancel-title-btn");
    if (saveButton) saveButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;
    inputElement.disabled = true;

    try {
        const csrftoken = getCookie("csrftoken");
        if (!csrftoken) {
            throw new Error("Lỗi xác thực (CSRF). Vui lòng tải lại.");
        }

        console.log(
            `[script] Sending API request to update title for ${chatId} to "${newTitle}"`
        );
        const response = await fetch("/api/update-title/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": csrftoken,
            },
            // Send the new title, backend handles empty string to unset custom title
            body: JSON.stringify({ chat_id: chatId, new_title: newTitle }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Backend returns the *actual* title that should now be displayed
            // (might be the newTitle, might be generated, might be default)
            const actualTitle = data.new_title || DEFAULT_CHAT_TITLE_JS;
            console.log(
                `[script] Title update successful for ${chatId}. Actual title set to: "${actualTitle}"`
            );

            // Truncate for display span
            const maxLen = 35; // Should match addChatToSidebar display truncation
            let displayTitle = actualTitle;
            if (displayTitle.length > maxLen) {
                displayTitle = displayTitle.substring(0, maxLen) + "...";
            }
            titleSpan.textContent = displayTitle;

            // Update the full title everywhere else
            linkElement.setAttribute("title", actualTitle);
            inputElement.value = actualTitle;
            inputElement.dataset.originalTitle = actualTitle;

            exitEditMode(listItem, false); // Exit, showing the new actual title

            // Dispatch event with the actual title
            document.dispatchEvent(
                new CustomEvent("chatRenamed", {
                    detail: { chatId: chatId, newTitle: actualTitle },
                })
            );
        } else {
            const errorMsg = `Lỗi cập nhật tiêu đề: ${
                data.error || `Server error (${response.status})`
            }`;
            console.error("[script]", errorMsg);
            alert(errorMsg);
            inputElement.focus(); // Keep focus on input on error
        }
    } catch (error) {
        console.error("[script] Network/fetch error saving title:", error);
        const errorMsg = `Lỗi kết nối khi cập nhật tiêu đề: ${error.message}`;
        alert(errorMsg);
        inputElement.focus(); // Keep focus on input on error
    } finally {
        // Re-enable buttons/input only if still in editing mode (e.g., error occurred)
        if (listItem.classList.contains("editing")) {
            if (saveButton) saveButton.disabled = false;
            if (cancelButton) cancelButton.disabled = false;
            inputElement.disabled = false;
        }
    }
}

async function deleteChatSession(chatId, listItemElement) {
    console.log("[script] Requesting deletion for chat_id:", chatId);

    // Get the full title for confirmation message
    const linkElement = listItemElement.querySelector(".chat-link");
    const currentTitle =
        linkElement?.getAttribute("title")?.trim() || DEFAULT_CHAT_TITLE_JS;

    if (
        !confirm(
            `Bạn có chắc chắn muốn xóa cuộc trò chuyện "${currentTitle}" không?\nHành động này không thể hoàn tác.`
        )
    ) {
        console.log("[script] Deletion cancelled by user for chat:", chatId);
        return;
    }

    console.log("[script] User confirmed deletion for chat:", chatId);
    closeOpenMenu(); // Close menu if open

    try {
        const csrftoken = getCookie("csrftoken");
        if (!csrftoken) {
            throw new Error("Lỗi xác thực (CSRF). Vui lòng tải lại.");
        }

        const response = await fetch("/api/delete-chat/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": csrftoken,
            },
            body: JSON.stringify({ chat_id: chatId }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
            console.log(
                `[script] Chat ${chatId} successfully deleted via API.`
            );

            const isDeletingCurrent = chatId === currentChatId;

            // Animate out
            listItemElement.style.transition =
                "opacity 0.3s ease, transform 0.3s ease, height 0.3s ease, margin 0.3s ease, padding 0.3s ease";
            listItemElement.style.transform = "translateX(-100%)";
            listItemElement.style.opacity = "0";
            listItemElement.style.height = "0";
            listItemElement.style.margin = "0";
            listItemElement.style.padding = "0";
            listItemElement.style.border = "none";

            setTimeout(() => {
                const parentList = listItemElement.parentNode;
                if (parentList?.contains(listItemElement)) {
                    parentList.removeChild(listItemElement);
                }

                // Show placeholder if list becomes empty
                if (
                    parentList &&
                    !parentList.querySelector(".submenu-content")
                ) {
                    const noChatsLi = document.createElement("li");
                    noChatsLi.classList.add("no-chats-placeholder");
                    noChatsLi.style.cssText =
                        "padding: 15px; color: #777; font-style: italic; text-align: center; opacity: 0; transition: opacity 0.5s ease;";
                    noChatsLi.innerHTML =
                        "<span>Chưa có cuộc trò chuyện nào.</span>";
                    parentList.appendChild(noChatsLi);
                    requestAnimationFrame(() => {
                        noChatsLi.style.opacity = "1";
                    });
                }

                // Redirect if the current chat was deleted
                if (isDeletingCurrent) {
                    console.log(
                        "[script] Deleted the currently active chat. Redirecting to /chat/"
                    );
                    currentChatId = null;
                    window.location.href = "/chat/"; // Navigate to base page
                }
            }, 300); // Match animation duration

            document.dispatchEvent(
                new CustomEvent("chatDeleted", { detail: { chatId: chatId } })
            );
        } else {
            const errorMsg = `Lỗi xóa cuộc trò chuyện: ${
                data.error || `Server error (${response.status})`
            }`;
            console.error("[script]", errorMsg);
            alert(errorMsg);
        }
    } catch (error) {
        console.error("[script] Network/fetch error deleting chat:", error);
        const errorMsg = `Lỗi kết nối khi xóa cuộc trò chuyện: ${error.message}`;
        alert(errorMsg);
    }
}

// --- Initialization ---
document.addEventListener("DOMContentLoaded", function () {
    console.log("[script] DOM fully loaded and parsed.");

    // Cache DOM elements
    chatListSubmenu = document.querySelector(".chatlist .submenu");
    chatbox = document.querySelector(".chat-area-wrapper .chatbox");
    inputField = document.getElementById("prompt");
    submitButton = document.getElementById("submit-btn");
    mainTitleElement = document.querySelector(".main-title");
    newChatButton = document.getElementById("new-chat-btn");

    // Get initial chat ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    currentChatId = urlParams.get("chat_id");
    console.log("[script] Initial Chat ID from URL:", currentChatId || "None");

    // --- Event Listeners ---

    // New Chat Button
    if (newChatButton) {
        newChatButton.addEventListener("click", (e) => {
            if (currentChatId !== null) {
                // Only redirect if currently in a chat
                e.preventDefault();
                console.log(
                    "[script] 'New Chat' button clicked. Navigating to base /chat/"
                );
                currentChatId = null; // Prevent potential race condition
                window.location.href = "/chat/";
            } else {
                console.log(
                    "[script] 'New Chat' button clicked, already on base page."
                );
                // Optionally clear input/chatbox if needed, but usually handled by page load
                if (inputField) inputField.focus();
                // Do NOT add "Bắt đầu..." message here
            }
        });
    } else {
        console.warn("[script] New Chat button not found.");
    }

    // Chat List Actions (Event Delegation)
    if (chatListSubmenu) {
        chatListSubmenu.addEventListener("click", function (event) {
            const target = event.target;
            const listItem = target.closest(".submenu-content");

            if (!listItem || !listItem.dataset.chatId) return; // Ensure we have a valid list item

            const chatId = listItem.dataset.chatId;
            const optionsMenu = listItem.querySelector(".chat-options-menu");
            const editInput = listItem.querySelector(".edit-title-input");
            const titleSpan = listItem.querySelector(".chat-title-text");
            const chatLink = listItem.querySelector(".chat-link");

            // Settings Button (...)
            if (target.closest(".chat-settings-btn")) {
                console.log("[script] Settings button clicked for", chatId);
                event.preventDefault(); // Prevent link navigation if button is inside link
                event.stopPropagation(); // Prevent triggering other clicks on the list item

                if (activeEditItem && activeEditItem !== listItem)
                    exitEditMode(activeEditItem, true); // Close other edits
                if (currentlyOpenMenu && currentlyOpenMenu !== optionsMenu)
                    closeOpenMenu(); // Close other menus

                if (optionsMenu.classList.contains("visible")) {
                    closeOpenMenu();
                } else {
                    optionsMenu.style.display = "block"; // Make it take space
                    requestAnimationFrame(() => {
                        // Ensure display:block is applied before adding class
                        optionsMenu.classList.add("visible");
                    });
                    currentlyOpenMenu = optionsMenu;
                }
            }
            // Rename Button (from menu)
            else if (target.closest(".rename-chat-btn")) {
                console.log("[script] Rename button clicked for", chatId);
                event.preventDefault();
                event.stopPropagation();
                closeOpenMenu(); // Close the options menu

                if (activeEditItem && activeEditItem !== listItem)
                    exitEditMode(activeEditItem, true); // Close other edits

                if (editInput && titleSpan && chatLink) {
                    // Get the full title from link attribute or input data
                    const currentFullTitle =
                        chatLink.getAttribute("title") ||
                        editInput.dataset.originalTitle ||
                        editInput.value ||
                        DEFAULT_CHAT_TITLE_JS;
                    inputElement.value = currentFullTitle;
                    // Ensure original title is set if not already
                    if (!inputElement.dataset.originalTitle) {
                        inputElement.dataset.originalTitle = currentFullTitle;
                    }
                    inputElement.disabled = false; // Ensure enabled

                    listItem.classList.add("editing"); // Trigger CSS state change
                    editInput.focus();
                    editInput.select(); // Select text for easy replacement
                    activeEditItem = listItem;
                } else {
                    console.error(
                        "[script] Edit elements not found for rename on",
                        chatId
                    );
                }
            }
            // Delete Button (from menu)
            else if (target.closest(".delete-chat-btn")) {
                console.log("[script] Delete button clicked for", chatId);
                event.preventDefault();
                event.stopPropagation();
                // No need to close menu explicitly, deleteChatSession handles it if needed
                deleteChatSession(chatId, listItem);
            }
            // Save Title Button (tick icon)
            else if (target.closest(".save-title-btn")) {
                console.log("[script] Save title button clicked for", chatId);
                event.preventDefault();
                event.stopPropagation();
                if (listItem.classList.contains("editing")) {
                    saveChatTitle(
                        chatId,
                        editInput,
                        listItem,
                        titleSpan,
                        chatLink
                    );
                } else {
                    console.warn(
                        "[script] Save clicked but item not in edit mode?",
                        chatId
                    );
                }
            }
            // Cancel Title Button (cross icon)
            else if (target.closest(".cancel-title-btn")) {
                console.log("[script] Cancel title button clicked for", chatId);
                event.preventDefault();
                event.stopPropagation();
                if (listItem.classList.contains("editing")) {
                    exitEditMode(listItem, true); // Restore original title on cancel
                } else {
                    console.warn(
                        "[script] Cancel clicked but item not in edit mode?",
                        chatId
                    );
                }
            }
            // Chat Link Click
            else if (target.closest(".chat-link")) {
                console.log(
                    "[script] Chat link clicked for ID:",
                    chatId,
                    "Target:",
                    target.tagName
                );

                // Close any open edit mode or menu before navigating
                if (activeEditItem && activeEditItem !== listItem)
                    exitEditMode(activeEditItem, true);
                if (currentlyOpenMenu) closeOpenMenu();

                // If already on this chat's page, prevent full reload, just update state
                if (window.location.search.includes(`chat_id=${chatId}`)) {
                    event.preventDefault();
                    console.log(
                        "[script] Already on chat page for",
                        chatId,
                        "- navigation prevented."
                    );
                    if (!listItem.classList.contains("active")) {
                        // Update active state visually if needed
                        document
                            .querySelectorAll(".submenu-content.active")
                            .forEach((el) => el.classList.remove("active"));
                        listItem.classList.add("active");
                        currentChatId = chatId; // Ensure state is correct
                        updateMainTitle(); // Update title bar
                    }
                } else {
                    // Allow navigation to proceed (href handles it)
                    // Mark clicked item active immediately for visual feedback
                    document
                        .querySelectorAll(".submenu-content.active")
                        .forEach((el) => el.classList.remove("active"));
                    listItem.classList.add("active");
                    // currentChatId will be updated on the new page load's DOMContentLoaded
                    // updateMainTitle(); // Update title bar based on clicked item
                }
            }
            // Click on list item itself (outside buttons/link)
            else if (target === listItem || target.closest(".chat-list-item")) {
                // Close menu/edit if click is on non-interactive part
                if (currentlyOpenMenu) closeOpenMenu();
                if (activeEditItem && activeEditItem !== listItem)
                    exitEditMode(activeEditItem, true);
                // Potentially navigate or select the chat if not already active?
                // For now, just closes menus/edits. If navigation is desired here,
                // simulate a click on the chatLink.
            }
        });

        // Enter/Escape key handling for title edit (delegated)
        chatListSubmenu.addEventListener("keydown", function (event) {
            if (!activeEditItem) return; // Only act if an item is being edited

            if (
                event.target.classList.contains("edit-title-input") &&
                event.target.closest(".submenu-content") === activeEditItem
            ) {
                const listItem = activeEditItem;
                const chatId = listItem.dataset.chatId;
                const editInput = event.target;
                const titleSpan = listItem.querySelector(".chat-title-text");
                const chatLink = listItem.querySelector(".chat-link");

                if (event.key === "Enter") {
                    console.log(
                        "[script] Enter key pressed in edit mode for",
                        chatId
                    );
                    event.preventDefault(); // Prevent form submission/newline
                    saveChatTitle(
                        chatId,
                        editInput,
                        listItem,
                        titleSpan,
                        chatLink
                    );
                } else if (event.key === "Escape") {
                    console.log(
                        "[script] Escape key pressed in edit mode for",
                        chatId
                    );
                    event.preventDefault();
                    exitEditMode(listItem, true); // Cancel edit, restore original
                }
            }
        });
    } else {
        console.warn(
            "[script] Chat list submenu element (.chatlist .submenu) not found."
        );
    }

    // Global click listener to close menus/edits when clicking outside
    document.addEventListener("click", function (event) {
        // Close options menu
        if (
            currentlyOpenMenu &&
            !currentlyOpenMenu.contains(event.target) &&
            !event.target.closest(".chat-settings-btn")
        ) {
            closeOpenMenu();
        }

        // Cancel edit mode
        if (activeEditItem && !activeEditItem.contains(event.target)) {
            // Check if the click was on a button within the active item's menu (which would be closed by the above)
            const isClickOnOwnMenuButton = activeEditItem
                .querySelector(".chat-options-menu")
                ?.contains(event.target);

            if (!isClickOnOwnMenuButton) {
                console.log(
                    "[script] Click outside active edit item detected. Cancelling edit for",
                    activeEditItem.dataset.chatId
                );
                exitEditMode(activeEditItem, true); // Restore original on click outside
            }
        }
    });

    // Input field and Submit button
    if (submitButton && inputField) {
        submitButton.addEventListener("click", sendMessage);

        inputField.addEventListener("keypress", function (event) {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault(); // Prevent newline
                sendMessage();
            }
        });

        // Auto-resize textarea
        inputField.addEventListener("input", function () {
            this.style.height = "auto"; // Reset height
            const maxHeight = window.innerHeight * 0.25; // Max height 25% of viewport
            const newHeight = Math.min(this.scrollHeight, maxHeight);
            this.style.height = newHeight + "px";
        });
        // Initial resize check
        inputField.dispatchEvent(new Event("input"));
    } else {
        console.error(
            "[script] Submit button or input field element not found."
        );
        if (chatbox)
            appendMessage("Lỗi: Không thể khởi tạo vùng nhập liệu.", "bot");
    }

    // Custom Event Listeners (e.g., for cross-component communication)
    document.addEventListener("chatRenamed", function (event) {
        const { chatId, newTitle } = event.detail;
        console.log(
            `[script] Event 'chatRenamed' received for ${chatId}. New title: "${newTitle}"`
        );
        // Update main title if the currently viewed chat was renamed
        if (chatId === currentChatId) {
            updateMainTitle(newTitle);
        }
    });

    document.addEventListener("chatDeleted", function (event) {
        const { chatId } = event.detail;
        console.log(`[script] Event 'chatDeleted' received for ${chatId}.`);
        // Main title/state update is handled by page redirection if current chat is deleted
    });

    // --- Final Setup ---
    console.log("[script] Performing final setup...");
    loadInitialHistory(); // Load messages for the current chat (if any)
    updateMainTitle(); // Set the initial title bar text

    // Set initial focus
    if (inputField) {
        inputField.focus();
        // Ensure resize happens after potential layout shifts
        setTimeout(() => {
            if (inputField) inputField.dispatchEvent(new Event("input"));
        }, 50);
    }

    // Highlight active chat in sidebar
    if (currentChatId && chatListSubmenu) {
        document
            .querySelectorAll(".submenu-content.active")
            .forEach((el) => el.classList.remove("active")); // Clear previous active
        const activeItem = chatListSubmenu.querySelector(
            `.submenu-content[data-chat-id="${currentChatId}"]`
        );
        if (activeItem) {
            activeItem.classList.add("active");
            console.log("[script] Marked chat item as active:", currentChatId);
        } else {
            console.warn(
                "[script] Current chat ID item not found in sidebar:",
                currentChatId
            );
        }
    } else if (!currentChatId && chatListSubmenu) {
        // Ensure nothing is marked active if on the base /chat/ page
        document
            .querySelectorAll(".submenu-content.active")
            .forEach((el) => el.classList.remove("active"));
        console.log(
            "[script] No current chat ID, ensured no sidebar item is active."
        );
    }

    console.log("[script] Initialization complete.");
});

// Helper for simple notifications (can be expanded later)
function showNotification(message, type = "info") {
    // For now, just log it
    console.log(`[Notification] [${type.toUpperCase()}]: ${message}`);
    // TODO: Implement a visual notification element if needed
}

// Helper for confirmation dialogs
function showConfirmation(message, onConfirm, onCancel) {
    if (window.confirm(message)) {
        if (onConfirm) onConfirm();
    } else {
        if (onCancel) onCancel();
    }
}
