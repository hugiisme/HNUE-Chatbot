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
            currentlyOpenMenu.style.display = "";
        }
        currentlyOpenMenu = null;
    }
}

function exitEditMode(listItem, restoreOriginal = false) {
    if (!listItem || !listItem.classList.contains("editing")) return;
    const editContainer = listItem.querySelector(".edit-title-container");
    const inputElement = listItem.querySelector(".edit-title-input");
    if (restoreOriginal && inputElement && inputElement.dataset.originalTitle) {
        inputElement.value = inputElement.dataset.originalTitle;
    }
    listItem.classList.remove("editing");
    if (listItem === activeEditItem) {
        activeEditItem = null;
    }
}

function updateMainTitle(forceTitle = null) {
    if (!mainTitleElement) {
        console.error("[script] mainTitleElement missing");
        return;
    }
    let finalTitle = "Gemini Chat";
    const safeChatListSubmenu = document.querySelector(".chatlist .submenu");

    if (
        forceTitle !== null &&
        typeof forceTitle === "string" &&
        forceTitle.trim() !== ""
    ) {
        finalTitle = forceTitle.trim();
    } else if (currentChatId && safeChatListSubmenu) {
        try {
            const targetListItem = safeChatListSubmenu.querySelector(
                `.submenu-content[data-chat-id="${currentChatId}"]`
            );
            if (targetListItem) {
                const titleSpan =
                    targetListItem.querySelector(".chat-title-text");
                finalTitle =
                    titleSpan?.textContent?.trim() ||
                    `Chat (${currentChatId.substring(0, 8)}...)`;
            } else {
                finalTitle = `Chat (${currentChatId.substring(0, 8)}...)`;
            }
        } catch (e) {
            finalTitle = `Chat (${currentChatId.substring(0, 8)}...)`;
        }
    }
    mainTitleElement.textContent = finalTitle;
    document.title = `${finalTitle} - Gemini Chatbot`;
}

function scrollToBottom() {
    if (chatbox) {
        requestAnimationFrame(() => {
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
    messageDiv.innerHTML = text.replace(/\n/g, "<br>");
    if (isLoading) {
        messageDiv.id = "loading-indicator";
        messageDiv.innerHTML = '<div class="dot-flashing"></div>';
    }
    chatbox.appendChild(messageDiv);
    scrollToBottom();
    return messageDiv;
}

function loadInitialHistory() {
    const historyDataElement = document.getElementById("chat-history-data");
    if (!chatbox) {
        console.error("[script] Chatbox missing");
        return;
    }
    chatbox.innerHTML = "";
    if (historyDataElement?.textContent) {
        try {
            const chatHistory = JSON.parse(historyDataElement.textContent);
            if (Array.isArray(chatHistory) && chatHistory.length > 0) {
                console.log(
                    "[script] Loading history for chat_id:",
                    currentChatId
                );
                const fragment = document.createDocumentFragment();
                chatHistory.forEach((message) => {
                    if (message?.role && message.parts?.[0]) {
                        const sender = message.role === "user" ? "user" : "bot";
                        const msgDiv = document.createElement("div");
                        msgDiv.classList.add(
                            "message",
                            sender === "user" ? "user-message" : "bot-message"
                        );
                        msgDiv.innerHTML = message.parts[0].replace(
                            /\n/g,
                            "<br>"
                        );
                        fragment.appendChild(msgDiv);
                    }
                });
                chatbox.appendChild(fragment);
                setTimeout(scrollToBottom, 50);
            } else {
                console.log(
                    "[script] History data empty/invalid for chat_id:",
                    currentChatId
                );
            }
        } catch (e) {
            console.error("[script] Error parsing history:", e);
            const errorMsg = "Lỗi: Không thể tải lịch sử chat.";
            appendMessage(errorMsg, "bot");
            showNotification(errorMsg, "error");
        }
    } else {
        console.log(
            "[script] No history data found in DOM for chat_id:",
            currentChatId
        );
    }
}

function toggleInput(enabled) {
    if (inputField) {
        inputField.disabled = !enabled;
        inputField.classList.toggle("disabled", !enabled);
    }
    if (submitButton) {
        submitButton.disabled = !enabled;
        submitButton.classList.toggle("disabled", !enabled);
    }
}

async function sendMessage() {
    if (isWaitingForResponse || !inputField || !submitButton) return;
    const userInput = inputField.value.trim();
    if (!userInput) return;

    const sentMessageText = userInput;

    console.log(
        `[script] Sending message for chat_id: ${currentChatId || "NEW"}`
    );

    appendMessage(userInput, "user");

    inputField.value = "";
    inputField.style.height = "auto";
    inputField.dispatchEvent(new Event("input"));

    toggleInput(false);
    isWaitingForResponse = true;
    const loadingIndicator = appendMessage("...", "bot", true);

    try {
        const csrftoken = getCookie("csrftoken");
        if (!csrftoken) {
            throw new Error("CSRF token not found.");
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
        if (loadingIndicator && chatbox.contains(loadingIndicator)) {
            chatbox.removeChild(loadingIndicator);
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const responseText = await response.text();
            if (responseText.trim().startsWith("<!DOCTYPE html>")) {
                throw new Error(`Lỗi máy chủ (${response.status}).`);
            } else {
                throw new Error(
                    `Server returned non-JSON response (${
                        response.status
                    }): ${responseText.substring(0, 200)}`
                );
            }
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `Server error: ${response.status}`);
        }

        if (data.response) {
            if (data.new_chat_id && !currentChatId) {
                console.log("[script] Received new chat ID:", data.new_chat_id);
                currentChatId = data.new_chat_id;
                const newUrl = `/chat/?chat_id=${currentChatId}`;
                history.pushState({ chatId: currentChatId }, "", newUrl);
                console.log("[script] Updated browser URL to:", newUrl);
                addChatToSidebar(currentChatId, sentMessageText);
                updateMainTitle();
                appendMessage(data.response, "bot");
            } else {
                appendMessage(data.response, "bot");
            }
        } else if (data.error) {
            const errorMsg = `Lỗi từ Bot: ${data.error}`;
            appendMessage(errorMsg, "bot");
            showNotification(errorMsg, "error");
        } else {
            const errorMsg = "Phản hồi không hợp lệ từ bot.";
            appendMessage(errorMsg, "bot");
            showNotification(errorMsg, "error");
        }
    } catch (error) {
        console.error("[script] Error sending message:", error);
        const loadingElem = document.getElementById("loading-indicator");
        if (loadingElem && chatbox.contains(loadingElem)) {
            chatbox.removeChild(loadingElem);
        }
        const errorMessage = `Lỗi: ${
            error.message || "Không thể gửi tin nhắn."
        }`;
        appendMessage(errorMessage, "bot");
        showNotification(errorMessage, "error");
    } finally {
        toggleInput(true);
        if (inputField) inputField.focus();
        isWaitingForResponse = false;
    }
}

function addChatToSidebar(chatId, firstUserMessage) {
    if (!chatListSubmenu) {
        console.warn("[script] Cannot add chat: chatListSubmenu missing.");
        return;
    }
    const placeholder = chatListSubmenu.querySelector(".no-chats-placeholder");
    if (placeholder) {
        placeholder.remove();
    }

    let title = `Chat ${chatId.substring(0, 8)}...`;
    const maxLen = 35;
    let titleSource = "ID Fallback";

    const trimmedMessage =
        firstUserMessage && typeof firstUserMessage === "string"
            ? firstUserMessage.trim()
            : null;

    if (trimmedMessage) {
        title = trimmedMessage.substring(0, maxLen);
        if (trimmedMessage.length > maxLen) {
            title += "...";
        }
        titleSource = "User Message";
    }

    const newLi = document.createElement("li");
    newLi.classList.add("submenu-content");
    newLi.dataset.chatId = chatId;

    newLi.innerHTML = `
        <div class="chat-list-item">
            <a href="/chat/?chat_id=${chatId}" class="chat-link" title="${title}">
                <span class="chat-title-text">${title}</span>
            </a>
            <button class="chat-settings-btn" title="Tùy chọn"><i class="bx bx-dots-horizontal-rounded"></i></button>
            <div class="edit-title-container" style="display: none;">
                <input type="text" class="edit-title-input" value="${title}">
                <div class="edit-title-actions">
                    <button class="save-title-btn" title="Lưu"><i class="bx bx-check"></i></button>
                    <button class="cancel-title-btn" title="Hủy"><i class="bx bx-x"></i></button>
                </div>
            </div>
        </div>
        <div class="chat-options-menu" style="display: none;">
            <button class="rename-chat-btn"><i class="bx bx-pencil"></i> Đổi tên</button>
            <button class="delete-chat-btn"><i class="bx bx-trash"></i> Xóa</button>
        </div>
    `;
    chatListSubmenu.insertBefore(newLi, chatListSubmenu.firstChild);
    document
        .querySelectorAll(".submenu-content.active")
        .forEach((el) => el.classList.remove("active"));
    newLi.classList.add("active");
    console.log(
        `[script] Dynamically added chat ${chatId} to sidebar. Title source: ${titleSource}. Final Title: "${title}"`
    );
}

async function saveChatTitle(
    chatId,
    inputElement,
    listItem,
    titleSpan,
    linkElement
) {
    console.log("[script] Saving title for chat_id:", chatId);
    const newTitle = inputElement.value.trim();
    const originalTitle =
        inputElement.dataset.originalTitle || titleSpan.textContent.trim();

    if (!newTitle) {
        showNotification("Tiêu đề không được để trống.", "error");
        inputElement.focus();
        return;
    }
    if (newTitle === originalTitle) {
        exitEditMode(listItem, false);
        return;
    }

    const saveButton = listItem.querySelector(".save-title-btn");
    const cancelButton = listItem.querySelector(".cancel-title-btn");
    if (saveButton) saveButton.disabled = true;
    if (cancelButton) cancelButton.disabled = true;

    try {
        const csrftoken = getCookie("csrftoken");
        if (!csrftoken) {
            throw new Error("CSRF token not found.");
        }
        const response = await fetch("/api/update-title/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": csrftoken,
            },
            body: JSON.stringify({ chat_id: chatId, new_title: newTitle }),
        });
        const data = await response.json();
        if (response.ok && data.success) {
            titleSpan.textContent = data.new_title;
            linkElement.setAttribute("title", data.new_title);
            inputElement.dataset.originalTitle = data.new_title;
            exitEditMode(listItem, false);
            showNotification("Tiêu đề đã được cập nhật.", "success");
            document.dispatchEvent(
                new CustomEvent("chatRenamed", {
                    detail: { chatId: chatId, newTitle: data.new_title },
                })
            );
        } else {
            const errorMsg = `Lỗi cập nhật tiêu đề: ${
                data.error || `Lỗi ${response.status}`
            }`;
            showNotification(errorMsg, "error");
            inputElement.focus();
        }
    } catch (error) {
        console.error("[script] Fetch error saving title:", error);
        const errorMsg = `Lỗi kết nối khi cập nhật tiêu đề: ${error.message}`;
        showNotification(errorMsg, "error");
        inputElement.focus();
    } finally {
        if (saveButton) saveButton.disabled = false;
        if (cancelButton) cancelButton.disabled = false;
    }
}

async function deleteChatSession(chatId, listItemElement) {
    console.log("[script] Attempting to delete chat_id:", chatId);

    try {
        const csrftoken = getCookie("csrftoken");
        if (!csrftoken) {
            throw new Error("CSRF token not found.");
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
            console.log(`[script] Chat ${chatId} deleted via API.`);
            showNotification("Cuộc trò chuyện đã được xóa.", "success");

            listItemElement.style.transition =
                "opacity 0.3s ease, height 0.3s ease, margin 0.3s ease, padding 0.3s ease";
            listItemElement.style.height = listItemElement.offsetHeight + "px";
            listItemElement.style.overflow = "hidden";

            requestAnimationFrame(() => {
                listItemElement.style.opacity = "0";
                listItemElement.style.height = "0";
                listItemElement.style.margin = "0";
                listItemElement.style.padding = "0";
                listItemElement.style.border = "none";
            });

            const isDeletingCurrent = chatId === currentChatId;
            document.dispatchEvent(
                new CustomEvent("chatDeleted", { detail: { chatId: chatId } })
            );

            setTimeout(() => {
                const parentList = listItemElement.parentNode;
                if (parentList?.contains(listItemElement)) {
                    parentList.removeChild(listItemElement);
                }
                if (
                    parentList &&
                    !parentList.querySelector(".submenu-content")
                ) {
                    const noChatsLi = document.createElement("li");
                    noChatsLi.classList.add("no-chats-placeholder");
                    noChatsLi.style.cssText =
                        "padding: 10px; color: #888; font-style: italic; text-align: center;";
                    noChatsLi.innerHTML =
                        "<span>Chưa có cuộc trò chuyện nào.</span>";
                    parentList.appendChild(noChatsLi);
                }
                if (isDeletingCurrent) {
                    console.log(
                        "[script] Deleted current chat. Redirecting..."
                    );
                    currentChatId = null;
                    window.location.href = "/chat/";
                }
            }, 300);
        } else {
            const errorMsg = `Lỗi xóa cuộc trò chuyện: ${
                data.error || `Lỗi ${response.status}`
            }`;
            showNotification(errorMsg, "error");
        }
    } catch (error) {
        console.error("[script] Fetch error deleting chat:", error);
        const errorMsg = `Lỗi kết nối khi xóa cuộc trò chuyện: ${error.message}`;
        showNotification(errorMsg, "error");
    }
}

document.addEventListener("DOMContentLoaded", function () {
    console.log("[script] DOM loaded");

    chatListSubmenu = document.querySelector(".chatlist .submenu");
    chatbox = document.querySelector(".chat-area-wrapper .chatbox");
    inputField = document.getElementById("prompt");
    submitButton = document.getElementById("submit-btn");
    mainTitleElement = document.querySelector(".main-title");
    newChatButton = document.getElementById("new-chat-btn");

    const urlParams = new URLSearchParams(window.location.search);
    currentChatId = urlParams.get("chat_id");
    console.log("[script] Initial Current Chat ID from URL:", currentChatId);

    if (newChatButton) {
        newChatButton.addEventListener("click", (e) => {
            if (currentChatId !== null) {
                e.preventDefault();
                console.log("[script] New Chat clicked. Clearing state.");
                currentChatId = null;
                if (chatbox) chatbox.innerHTML = "";
                updateMainTitle();
                if (inputField) inputField.focus();
                history.pushState({ chatId: null }, "", "/chat/");
                if (chatListSubmenu)
                    chatListSubmenu
                        .querySelectorAll(".submenu-content.active")
                        .forEach((el) => el.classList.remove("active"));
            }
        });
    }

    if (chatListSubmenu) {
        chatListSubmenu.addEventListener("click", function (event) {
            const target = event.target;
            const listItem = target.closest(".submenu-content");
            if (!listItem) return;

            const chatId = listItem.dataset.chatId;

            const optionsMenu = listItem.querySelector(".chat-options-menu");
            const editContainer = listItem.querySelector(
                ".edit-title-container"
            );
            const editInput = listItem.querySelector(".edit-title-input");
            const titleSpan = listItem.querySelector(".chat-title-text");
            const chatLink = listItem.querySelector(".chat-link");

            if (target.closest(".chat-settings-btn")) {
                console.log("[script] Settings button clicked for", chatId);
                event.preventDefault();
                event.stopPropagation();

                if (activeEditItem === listItem) exitEditMode(listItem, true);
                if (optionsMenu === currentlyOpenMenu) {
                    closeOpenMenu();
                } else {
                    closeOpenMenu();
                    optionsMenu.style.display = "block";
                    requestAnimationFrame(() => {
                        optionsMenu.classList.add("visible");
                    });
                    currentlyOpenMenu = optionsMenu;
                }
            } else if (target.closest(".rename-chat-btn")) {
                event.preventDefault();
                event.stopPropagation();
                closeOpenMenu();

                if (activeEditItem && activeEditItem !== listItem) {
                    exitEditMode(activeEditItem, true);
                }

                if (editContainer && editInput && titleSpan) {
                    if (!editInput.dataset.originalTitle) {
                        editInput.dataset.originalTitle =
                            titleSpan.textContent.trim();
                    }
                    editInput.value = titleSpan.textContent.trim();
                    listItem.classList.add("editing");
                    editInput.focus();
                    editInput.select();
                    activeEditItem = listItem;
                }
            } else if (target.closest(".delete-chat-btn")) {
                event.preventDefault();
                event.stopPropagation();
                closeOpenMenu();

                const currentTitle = titleSpan
                    ? titleSpan.textContent.trim()
                    : `Chat ID ${chatId.substring(0, 6)}...`;

                showConfirmation(
                    `Bạn có chắc chắn muốn xóa cuộc trò chuyện "${currentTitle}" không?`,
                    () => {
                        deleteChatSession(chatId, listItem);
                    },
                    () => {
                        console.log(
                            "[script] Deletion cancelled for chat:",
                            chatId
                        );
                    }
                );
            } else if (target.closest(".save-title-btn")) {
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
                }
            } else if (target.closest(".cancel-title-btn")) {
                event.preventDefault();
                event.stopPropagation();
                if (listItem.classList.contains("editing")) {
                    exitEditMode(listItem, true);
                }
            } else if (target.closest(".chat-link")) {
                console.log("[script] Chat link clicked for ID:", chatId);
                document
                    .querySelectorAll(".submenu-content.active")
                    .forEach((el) => el.classList.remove("active"));
                listItem.classList.add("active");
                closeOpenMenu();
                if (activeEditItem && activeEditItem !== listItem) {
                    exitEditMode(activeEditItem, true);
                }
            } else if (target.closest(".chat-list-item")) {
                if (currentlyOpenMenu) {
                    closeOpenMenu();
                }
                if (activeEditItem && activeEditItem !== listItem) {
                    exitEditMode(activeEditItem, true);
                }
            }
        });

        chatListSubmenu.addEventListener("keydown", function (event) {
            if (
                activeEditItem &&
                event.target.classList.contains("edit-title-input")
            ) {
                const listItem = event.target.closest(".submenu-content");
                if (!listItem || listItem !== activeEditItem) return;

                const chatId = listItem.dataset.chatId;
                const titleSpan = listItem.querySelector(".chat-title-text");
                const chatLink = listItem.querySelector(".chat-link");
                const editInput = event.target;

                if (event.key === "Enter") {
                    event.preventDefault();
                    saveChatTitle(
                        chatId,
                        editInput,
                        listItem,
                        titleSpan,
                        chatLink
                    );
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    exitEditMode(listItem, true);
                }
            }
        });
    } else {
        console.warn("[script] Chat list submenu not found.");
    }

    document.addEventListener("click", function (event) {
        if (
            currentlyOpenMenu &&
            !currentlyOpenMenu.contains(event.target) &&
            !event.target.closest(".chat-settings-btn")
        ) {
            closeOpenMenu();
        }

        if (
            activeEditItem &&
            !activeEditItem.contains(event.target) &&
            !event.target.closest(".edit-title-actions")
        ) {
            exitEditMode(activeEditItem, true);
        }
    });

    if (submitButton && inputField) {
        submitButton.addEventListener("click", sendMessage);

        inputField.addEventListener("keypress", function (event) {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });

        inputField.addEventListener("input", function () {
            this.style.height = "auto";
            const maxHeight = window.innerHeight * 0.3;
            this.style.height = Math.min(this.scrollHeight, maxHeight) + "px";
        });
    } else {
        console.error("[script] Submit button or input field missing.");
    }

    document.addEventListener("chatRenamed", function (event) {
        const { chatId, newTitle } = event.detail;
        console.log(
            `%c[script] Heard 'chatRenamed' for ${chatId}`,
            "color: purple;"
        );
        if (chatId === currentChatId) {
            updateMainTitle(newTitle);
        }
    });

    document.addEventListener("chatDeleted", function (event) {
        const { chatId } = event.detail;
        console.log(
            `%c[script] Heard 'chatDeleted' for ${chatId}`,
            "color: purple;"
        );
    });

    console.log("[script] Running initial setup...");
    loadInitialHistory();
    updateMainTitle();
    if (inputField) {
        inputField.focus();
        setTimeout(() => {
            if (inputField) inputField.dispatchEvent(new Event("input"));
        }, 100);
    }
    console.log("[script] Initial setup complete.");
});
