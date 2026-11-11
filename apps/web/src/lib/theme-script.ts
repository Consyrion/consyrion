/**
 * Inline script of the root layout, run before first paint.
 * 1. Moves browser storage keys written before the rename to CONSYRIUM AI (consyrion-… / consyrion.…, 11 Nov 2026) to
 *    their new names, so theme, drafts and panel state survive. The keys are collected first: adding and removing
 *    while walking the storage by index skipped one.
 * 2. Applies the stored theme to avoid a flash; without one the OS preference decides.
 */
export const themeScript = `try{Object.keys(localStorage).forEach(function(k){if(/^consyrion[-.]/.test(k)){var n="consyrium"+k.slice(9);if(localStorage.getItem(n)===null)localStorage.setItem(n,localStorage.getItem(k));localStorage.removeItem(k)}})}catch(e){}try{var t=localStorage.getItem("consyrium-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
