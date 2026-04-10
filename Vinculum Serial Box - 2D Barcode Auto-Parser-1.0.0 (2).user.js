// ==UserScript==
// @name         Vinculum Serial Box - 2D Barcode Auto-Parser
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Auto-parse 2D barcodes (GS1/Apple, Samsung, Huawei, raw IMEI, etc.) into line-separated serials/IMEIs in the "Enter SKU Serial No." modal
// @author       Moataz
// @match        https://tradelinguat.vineretail.com/eRetailWeb/selCompanyLocationBS.action
// @icon         https://www.google.com/s2/favicons?sz=64&domain=vineretail.com
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  //  BARCODE PARSER (embedded from barcode_parser.js)
  // ════════════════════════════════════════════════════════════════

  function luhnCheck(imei) {
    if (!/^\d{15}$/.test(imei)) return false;
    let sum = 0;
    for (let i = 0; i < 15; i++) {
      let d = parseInt(imei[i], 10);
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return sum % 10 === 0;
  }

  function classifyToken(token) {
    if (/^\d{15}$/.test(token)) {
      return { value: token, type: luhnCheck(token) ? 'IMEI ✓' : 'IMEI (no checksum)' };
    }
    return { value: token, type: 'Serial' };
  }

  function detectFormat(raw) {
    const s = raw.trim();
    if (/,/.test(s) && /(^|,)(SSCC|GTIN|IMEI|SCC3|MPN|QTY)/i.test(s)) return 'gs1';
    if (/^\d{15}$/.test(s)) return 'imei';
    if (/\s/.test(s) && !/(SSCC|GTIN|IMEI)/i.test(s)) {
      const parts = s.split(/\s+/);
      if (parts.length >= 3) {
        const first = parts[0], rest = parts.slice(1);
        const firstLooksLikeBoxId = /^[A-Z0-9]{5,12}$/i.test(first) && !/^\d{15}$/.test(first);
        const restLookLikeIds = rest.every(t => /^\d{15}$/.test(t) || /^[A-Z0-9]{8,15}$/i.test(t));
        if (firstLooksLikeBoxId && restLookLikeIds) return 'samsung';
      }
    }
    if (/,/.test(s) && !/(SSCC|GTIN|IMEI)/i.test(s)) {
      if (s.split(',').map(p => p.trim()).filter(Boolean).length >= 2) return 'comma';
    }
    for (const d of ['|', ';', '\t', '\n', ' ']) {
      if (s.split(d).map(p => p.trim()).filter(Boolean).length >= 2) return 'auto:' + d;
    }
    return 'raw';
  }

  function extractGS1(raw) {
    const tokens = raw.split(',').map(t => t.trim()).filter(Boolean);
    const meta = {}, identifiers = [];
    for (const t of tokens) {
      if (/^V\d+$/i.test(t))  { meta.version = t; continue; }
      if (/^SSCC/i.test(t))   { meta.sscc = t.replace(/^SSCC/i, ''); continue; }
      if (/^GTIN/i.test(t))   { meta.gtin = t.replace(/^GTIN/i, ''); continue; }
      if (/^SCC3/i.test(t))   { meta.scc = t.replace(/^SCC3/i, ''); continue; }
      if (/^MPN/i.test(t))    { meta.mpn = t.replace(/^MPN/i, ''); continue; }
      if (/^QTY/i.test(t))    { meta.qty = t.replace(/^QTY/i, ''); continue; }
      if (/^IMEI/i.test(t))   { identifiers.push(classifyToken(t.replace(/^IMEI/i, ''))); continue; }
      if (/^S[A-Z0-9]{8,14}$/i.test(t)) {
        const serial = t.substring(1).replace(/O/g, '0').replace(/I/g, '1');
        identifiers.push({ value: serial, type: 'Serial (Apple)' });
        continue;
      }
      identifiers.push(classifyToken(t));
    }
    return { format: 'GS1 / Apple', meta, identifiers };
  }

  function extractIMEI(raw) {
    return { format: 'Raw IMEI', meta: {}, identifiers: [classifyToken(raw.trim())] };
  }

  function extractSamsung(raw) {
    const parts = raw.trim().split(/\s+/);
    return { format: 'Samsung', meta: { boxId: parts[0] }, identifiers: parts.slice(1).map(t => classifyToken(t)) };
  }

  function extractComma(raw) {
    return { format: 'Comma-separated', meta: {}, identifiers: raw.split(',').map(t => t.trim()).filter(Boolean).map(t => classifyToken(t)) };
  }

  function extractAuto(raw, sep) {
    return { format: 'Auto-detect', meta: {}, identifiers: raw.split(sep).map(t => t.trim()).filter(Boolean).map(t => classifyToken(t)) };
  }

  function parseBarcode(raw) {
    const fmt = detectFormat(raw);
    let result;
    if (fmt === 'gs1')              result = extractGS1(raw);
    else if (fmt === 'imei')        result = extractIMEI(raw);
    else if (fmt === 'samsung')     result = extractSamsung(raw);
    else if (fmt === 'comma')       result = extractComma(raw);
    else if (fmt.startsWith('auto:')) result = extractAuto(raw, fmt.substring(5));
    else                            result = { format: 'Raw', meta: {}, identifiers: [{ value: raw.trim(), type: 'Raw' }] };
    result.lines = result.identifiers.map(id => id.value).join('\n');
    result.count = result.identifiers.length;
    return result;
  }

  // ════════════════════════════════════════════════════════════════
  //  MODAL DETECTION & AUTO-PARSE LOGIC
  // ════════════════════════════════════════════════════════════════

  const PARSE_DEBOUNCE_MS = 400;      // wait after last keystroke before parsing
  const SCAN_CHECK_INTERVAL_MS = 500;  // how often to scan for new iframes/modals

  // Track which textareas we've already hooked
  const hookedTextareas = new WeakSet();

  /**
   * Given a document (main or iframe), find the serial textarea and hook it.
   */
  function hookSerialTextarea(doc) {
    try {
      const textarea = doc.getElementById('serialNoDatas');
      if (!textarea || hookedTextareas.has(textarea)) return;

      hookedTextareas.add(textarea);
      console.log('[Serial Parser] Hooked textarea in', doc.location?.href || 'iframe');

      let debounceTimer = null;
      let lastRawValue = '';

      // Add a small visual indicator that the parser is active
      addParserBadge(textarea, doc);

      // Listen for input events (covers paste, scan, typing)
      textarea.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          processTextarea(textarea);
        }, PARSE_DEBOUNCE_MS);
      });

      // Also listen for paste specifically (scanners sometimes fire paste)
      textarea.addEventListener('paste', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          processTextarea(textarea);
        }, 100); // faster on paste since it's a single action
      });

      // Handle the case where value is set programmatically
      // (some barcode scanners fill the field via JS, not keyboard events)
      const valueObserver = setInterval(() => {
        if (textarea.value !== lastRawValue && textarea.value.trim() !== '') {
          lastRawValue = textarea.value;
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            processTextarea(textarea);
          }, PARSE_DEBOUNCE_MS);
        }
      }, 300);

      // Clean up when modal closes (textarea removed from DOM)
      const cleanupObserver = new MutationObserver(() => {
        if (!doc.body.contains(textarea)) {
          clearInterval(valueObserver);
          cleanupObserver.disconnect();
          console.log('[Serial Parser] Textarea removed, cleaned up.');
        }
      });
      cleanupObserver.observe(doc.body, { childList: true, subtree: true });

    } catch (e) {
      // Cross-origin or other errors — ignore silently
    }
  }

  /**
   * Core parsing logic: read the textarea, detect if it's a 2D barcode,
   * parse it, and replace the content with line-separated serials/IMEIs.
   */
  function processTextarea(textarea) {
    const raw = textarea.value.trim();
    if (!raw) return;

    // Don't re-parse if it's already line-separated clean serials/IMEIs
    // (i.e., each line is a single IMEI or serial — means we already parsed it)
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const allSingleTokens = lines.every(l => !/[,\s|;]/.test(l) && l.length <= 20);
    if (lines.length > 1 && allSingleTokens) {
      // Already looks parsed — skip
      return;
    }

    // If it's a single short token (likely just one serial/IMEI typed normally), skip
    if (!/[,\s|;]/.test(raw) && !/^(SSCC|GTIN|IMEI|SCC3|MPN|QTY|V\d)/i.test(raw) && raw.length <= 20) {
      return;
    }

    const result = parseBarcode(raw);

    // Only replace if we actually extracted multiple identifiers OR it's a known format
    if (result.count >= 1 && result.format !== 'Raw') {
      textarea.value = result.lines;

      // Trigger input event so Vinculum's own JS picks up the change
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));

      console.log(`[Serial Parser] Parsed ${result.count} identifiers (${result.format})`);

      // Flash the badge green briefly
      flashBadge(textarea, result);
    }
  }

  /**
   * Add a small badge near the textarea to show the parser is active.
   */
  function addParserBadge(textarea, doc) {
    const badge = doc.createElement('div');
    badge.id = 'serialParserBadge';
    badge.style.cssText = `
      display: inline-block;
      padding: 2px 8px;
      margin: 4px 0;
      font-size: 11px;
      font-weight: bold;
      color: #fff;
      background: #3c8dbc;
      border-radius: 3px;
      transition: background 0.3s;
    `;
    badge.textContent = '🔍 2D Parser Active';
    textarea.parentNode.insertBefore(badge, textarea);

    // Store reference on textarea for flash updates
    textarea._parserBadge = badge;
  }

  /**
   * Flash the badge green with the parse result info.
   */
  function flashBadge(textarea, result) {
    const badge = textarea._parserBadge;
    if (!badge) return;

    badge.style.background = '#00a65a';
    badge.textContent = `✅ ${result.count} ${result.count === 1 ? 'serial' : 'serials'} (${result.format})`;

    setTimeout(() => {
      badge.style.background = '#3c8dbc';
      badge.textContent = '🔍 2D Parser Active';
    }, 3000);
  }

  // ════════════════════════════════════════════════════════════════
  //  IFRAME SCANNER — checks main doc + all iframes for the modal
  // ════════════════════════════════════════════════════════════════

  function scanForModals() {
    // Check main document
    hookSerialTextarea(document);

    // Check all iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          hookSerialTextarea(iframeDoc);
        }
      } catch (e) {
        // Cross-origin — can't access, skip
      }
    }
  }

  // Start scanning
  setInterval(scanForModals, SCAN_CHECK_INTERVAL_MS);

  console.log('[Serial Parser] Tampermonkey script loaded. Monitoring for serial modals...');

})();