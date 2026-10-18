/**
 * Inline script applied in each app's root layout `<head>` before hydration
 * so a stored light-mode preference paints immediately (no dark flash).
 *
 * Kept dependency-free and defensive — it runs before React exists.
 * Lives in a non-"use client" module so server components can inline it.
 */
export const themeInitScript = `(function(){try{if(window.localStorage.getItem("em-theme")==="light"){document.documentElement.setAttribute("data-theme","light");var m=document.querySelector('meta[name="theme-color"]');if(m){m.setAttribute("content","#F8FAFC");}}}catch(e){}})();`;
