// static/js/confirmation.js

let confirmationModal = null;
let confirmationMessage = null;
let confirmYesBtn = null;
let confirmNoBtn = null;

// Global state for confirmation callbacks (specific to this module)
let confirmCallback = null;
let cancelCallback = null;

// --- Confirmation Modal System ---
function showConfirmation(message, onConfirm, onCancel = null) {
    if (
        !confirmationModal ||
        !confirmationMessage ||
        !confirmYesBtn ||
        !confirmNoBtn
    ) {
        // Try to find elements again if they weren't ready initially
        if (!initializeConfirmationElements()) {
            console.error("Confirmation modal elements could not be found.");
            return; // Critical failure
        }
    }

    confirmationMessage.textContent = message;
    confirmCallback = onConfirm;
    cancelCallback = onCancel;

    confirmationModal.classList.add("visible");
    requestAnimationFrame(() => confirmYesBtn.focus());
}

function hideConfirmation() {
    if (confirmationModal) {
        confirmationModal.classList.remove("visible");
    }
    confirmCallback = null;
    cancelCallback = null;
}

function handleConfirmYes() {
    const callback = confirmCallback;
    hideConfirmation();
    if (typeof callback === "function") {
        callback();
    }
}

function handleConfirmNo() {
    const callback = cancelCallback;
    hideConfirmation();
    if (typeof callback === "function") {
        callback();
    }
}

// Helper function to find elements, returns true if successful
function initializeConfirmationElements() {
    confirmationModal = document.getElementById("confirmation-modal");
    confirmationMessage = document.getElementById("confirmation-message");
    confirmYesBtn = document.getElementById("confirm-yes-btn");
    confirmNoBtn = document.getElementById("confirm-no-btn");
    return (
        confirmationModal &&
        confirmationMessage &&
        confirmYesBtn &&
        confirmNoBtn
    );
}

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    if (initializeConfirmationElements()) {
        // Add Event Listeners for Confirmation Modal
        confirmYesBtn.addEventListener("click", handleConfirmYes);
        confirmNoBtn.addEventListener("click", handleConfirmNo);

        confirmationModal.addEventListener("click", (event) => {
            if (event.target === confirmationModal) {
                handleConfirmNo();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (
                event.key === "Escape" &&
                confirmationModal.classList.contains("visible")
            ) {
                handleConfirmNo();
            }
        });
        console.log("confirmation.js initialized.");
    } else {
        console.warn("Confirmation modal elements not found on initial load.");
    }
});
