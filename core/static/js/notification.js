// static/js/notification.js

let notificationContainer = null;

// --- Notification System ---
function showNotification(message, type = "info", duration = 4000) {
    if (!notificationContainer) {
        // Try to find the container again if it wasn't ready initially
        notificationContainer = document.getElementById(
            "notification-container"
        );
        if (!notificationContainer) {
            console.error("Notification container not found.");
            return;
        }
    }

    const notification = document.createElement("div");
    notification.classList.add("notification", type);
    notification.textContent = message;

    const closeBtn = document.createElement("button");
    closeBtn.innerHTML = "×";
    closeBtn.classList.add("notification-close-btn");
    closeBtn.setAttribute("aria-label", "Close notification");
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeNotification(notification);
    };
    notification.appendChild(closeBtn);

    notificationContainer.appendChild(notification);

    requestAnimationFrame(() => {
        notification.classList.add("show");
    });

    const timeoutId = setTimeout(() => {
        closeNotification(notification);
    }, duration);

    notification.dataset.timeoutId = timeoutId;
}

function closeNotification(notification) {
    if (!notification || !document.body.contains(notification)) return;

    if (notification.dataset.timeoutId) {
        clearTimeout(parseInt(notification.dataset.timeoutId, 10));
    }

    notification.classList.remove("show");

    const handleTransitionEnd = () => {
        notification.removeEventListener("transitionend", handleTransitionEnd);
        if (notification.parentNode) {
            notification.remove();
        }
    };
    notification.addEventListener("transitionend", handleTransitionEnd);

    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 600);
}

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    notificationContainer = document.getElementById("notification-container");
    if (!notificationContainer) {
        console.warn(
            "Notification container element not found on initial load."
        );
    }
    console.log("notification.js initialized.");
});
