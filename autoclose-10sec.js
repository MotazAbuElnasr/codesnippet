// ==UserScript==
// @name         Close AWB download tab after 10 s
// @namespace    tradeling
// @version      1.0
// @description  Auto-closes AWB download tabs 10 seconds after they open
// @match        https://api.tradeling.com/api/shipping/v1/fulfillment-operations/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  setTimeout(() => {
    // Try to close the window politely first…
    window.close();

    // …but if the browser blocks window.close() on an opener-less tab,
    // navigate away to an empty page to achieve the same effect.
    setTimeout(() => { location.replace('about:blank'); }, 100);
  }, 10000);
})();
