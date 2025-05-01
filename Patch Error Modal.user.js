// ==UserScript==
// @name         Patch Error Modal - Tradeling
// @namespace    http://tampermonkey.net/
// @version      2025-04-16
// @description  Show fullscreen modal on SKU error using MutationObserver
// @author       You
// @match        https://tradeling.vineretail.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const TARGET_ERROR = 'SKU is not associated with Picklist for Picking.';

  function createBlockingModal(message) {
    if (document.getElementById('customBlockingModal')) return;

    const modal = document.createElement('div');
    modal.id = 'customBlockingModal';
    modal.style.position = 'fixed';
    modal.style.top = 0;
    modal.style.left = 0;
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
    modal.style.zIndex = '99999';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';

    const content = document.createElement('div');
    content.style.backgroundColor = '#fff';
    content.style.color = '#000';
    content.style.padding = '30px 40px';
    content.style.borderRadius = '10px';
    content.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
    content.style.maxWidth = '500px';
    content.style.textAlign = 'center';

    const text = document.createElement('div');
    text.textContent = message;
    text.style.marginBottom = '20px';

    const button = document.createElement('button');
    button.textContent = 'Okay';
    button.style.padding = '10px 20px';
    button.style.fontSize = '16px';
    button.style.backgroundColor = '#fb641e';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';

    button.onclick = () => {
      modal.remove();
      const parentDiv = document.getElementById('mesgParentDiv');
      if (parentDiv) parentDiv.style.display = 'none';
    };

    content.appendChild(text);
    content.appendChild(button);
    modal.appendChild(content);
    document.body.appendChild(modal);
  }

  function observeMessageBox() {
    const mesgDiv = document.getElementById('mesgParentDiv');
    if (!mesgDiv) return;

    const observer = new MutationObserver(() => {
      const isVisible = mesgDiv.style.display !== 'none';
      const message = document.getElementById('messageLabel')?.textContent?.trim();

      if (isVisible && message === TARGET_ERROR) {
        createBlockingModal('ATTENTION!: ' + message + 'The item shouldn\'t be Packed');
      }
    });

    observer.observe(mesgDiv, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['style']
    });
  }

  // Wait until the element is present
  function waitForMessageElementAndStartObserver() {
    const interval = setInterval(() => {
      const mesgDiv = document.getElementById('mesgParentDiv');
      if (mesgDiv) {
        clearInterval(interval);
        observeMessageBox();
      }
    }, 300);
  }

  waitForMessageElementAndStartObserver();
})();
