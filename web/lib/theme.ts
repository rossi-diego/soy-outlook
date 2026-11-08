// Theme storage key and the pre-paint boot script. Kept out of components/ThemeToggle.tsx (a
// "use client" module): a server component importing a string from a client module receives a
// client reference, not the string, and the inline script would silently be empty.
export const THEME_KEY = "wasde-theme";

/** Runs before paint (inlined in <head>) so there is no theme flash. */
export const themeBootScript = `try{var m=localStorage.getItem("${THEME_KEY}");if(m==="light"||m==="dark")document.documentElement.setAttribute("data-theme",m)}catch(e){}`;
