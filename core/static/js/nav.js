document.addEventListener("DOMContentLoaded", function () {
    const sidebar = document.getElementById("sidebar");
    const dropdownBtn = document.getElementById("dropdown-btn");
    const toggleNavBtn = document.getElementById("toggle-navigation");

    if (!sidebar) console.error("[nav] #sidebar not found.");
    if (!dropdownBtn) console.error("[nav] #dropdown-btn not found.");
    if (!toggleNavBtn) console.error("[nav] #toggle-navigation not found.");

    function toggleSideBar(e) {
        if (e) e.preventDefault();
        if (!sidebar) return;

        const nav_icon = document.getElementById("toggle-navigation-icon");
        const title = sidebar.querySelector(".logo-title");
        const logout_btn = document.getElementById("logout-btn");
        const logout_span = logout_btn
            ? logout_btn.querySelector("span")
            : null;

        if (!nav_icon) {
            console.error("[nav] #toggle-navigation-icon not found.");
            return;
        }

        nav_icon.classList.toggle("bxs-chevrons-left");
        nav_icon.classList.toggle("bxs-chevrons-right");
        sidebar.classList.toggle("close");

        if (sidebar.classList.contains("close")) {
            const submenu = sidebar.querySelector(".submenu");
            const drop_icon = document.getElementById("dropdown-icon");
            if (submenu && !submenu.classList.contains("hidden")) {
                submenu.classList.add("hidden");
                if (
                    drop_icon &&
                    drop_icon.classList.contains("bxs-chevron-up")
                ) {
                    drop_icon.classList.replace(
                        "bxs-chevron-up",
                        "bxs-chevron-down"
                    );
                }
            }
        }
    }

    function toggleSubmenu(e) {
        e.preventDefault();
        if (!sidebar) return;

        const drop_icon = document.getElementById("dropdown-icon");
        const submenu = sidebar.querySelector(".submenu");

        if (!drop_icon || !submenu) {
            console.error("[nav] Dropdown icon or submenu not found.");
            return;
        }

        drop_icon.classList.toggle("bxs-chevron-down");
        drop_icon.classList.toggle("bxs-chevron-up");
        submenu.classList.toggle("hidden");

        if (
            sidebar.classList.contains("close") &&
            !submenu.classList.contains("hidden")
        ) {
            toggleSideBar();
        }
    }

    if (dropdownBtn) {
        dropdownBtn.addEventListener("click", toggleSubmenu);
    }
    if (toggleNavBtn) {
        toggleNavBtn.addEventListener("click", toggleSideBar);
    }

    document.querySelectorAll(".navigation li a").forEach((link) => {
        link.addEventListener("click", (event) => {
            if (
                sidebar &&
                sidebar.classList.contains("close") &&
                !event.target.closest("#toggle-navigation")
            ) {
                toggleSideBar();
            }
        });
    });

    console.log("[nav] Loaded and listeners attached.");
});
