// ==UserScript==
// @name         Vinculum Serial Box - 2D Barcode Auto-Parser
// @namespace    http://tampermonkey.net/
// @version      1.1.1
// @description  Auto-parse 2D barcodes (GS1/Apple, Samsung, Huawei/Honor Data Matrix, raw IMEI) into line-separated serials/IMEIs in the "Enter SKU Serial No." modal. Appends across scans, silently rejects duplicates with toast, blocks Chrome shortcut hijack from scanner LF.
// @author       Moataz
// @match        https://tradeling.vineretail.com/eRetailWeb/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=vineretail.com
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  //  BARCODE PARSER
  // ════════════════════════════════════════════════════════════════

  const CTRL_SEP = /[\x1c\x1d\x1e]/; // FS / GS / RS — standard Data Matrix separators

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
    if (CTRL_SEP.test(s)) return 'ctrlsep';
    if (/,/.test(s) && /(^|,)(SSCC|GTIN|IMEI|SCC3|MPN|QTY)/i.test(s)) return 'gs1';
    if (/^\d{15}$/.test(s)) return 'imei';
    if (/^\d{30,}$/.test(s) && s.length % 15 === 0) return 'concat-imei';
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

  function extractCtrlSep(raw) {
    return {
      format: 'Data Matrix (GS-separated)',
      meta: {},
      identifiers: raw.split(CTRL_SEP).map(t => t.trim()).filter(Boolean).map(classifyToken),
    };
  }

  function extractConcatImei(raw) {
    const s = raw.trim();
    const ids = [];
    for (let i = 0; i < s.length; i += 15) ids.push(classifyToken(s.substr(i, 15)));
    return { format: 'Concatenated IMEI', meta: {}, identifiers: ids };
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

  function extractIMEI(raw)    { return { format: 'Raw IMEI',         meta: {}, identifiers: [classifyToken(raw.trim())] }; }
  function extractSamsung(raw) { const p = raw.trim().split(/\s+/); return { format: 'Samsung', meta: { boxId: p[0] }, identifiers: p.slice(1).map(classifyToken) }; }
  function extractComma(raw)   { return { format: 'Comma-separated',  meta: {}, identifiers: raw.split(',').map(t => t.trim()).filter(Boolean).map(classifyToken) }; }
  function extractAuto(raw, sep) { return { format: 'Auto-detect',    meta: {}, identifiers: raw.split(sep).map(t => t.trim()).filter(Boolean).map(classifyToken) }; }

  function parseBarcode(raw) {
    const fmt = detectFormat(raw);
    let result;
    if (fmt === 'ctrlsep')           result = extractCtrlSep(raw);
    else if (fmt === 'gs1')          result = extractGS1(raw);
    else if (fmt === 'imei')         result = extractIMEI(raw);
    else if (fmt === 'concat-imei')  result = extractConcatImei(raw);
    else if (fmt === 'samsung')      result = extractSamsung(raw);
    else if (fmt === 'comma')        result = extractComma(raw);
    else if (fmt.startsWith('auto:')) result = extractAuto(raw, fmt.substring(5));
    else                              result = { format: 'Raw', meta: {}, identifiers: [{ value: raw.trim(), type: 'Raw' }] };
    result.lines = result.identifiers.map(id => id.value).join('\n');
    result.count = result.identifiers.length;
    return result;
  }

  // ════════════════════════════════════════════════════════════════
  //  MODAL DETECTION & AUTO-PARSE LOGIC
  // ════════════════════════════════════════════════════════════════

  const PARSE_DEBOUNCE_MS = 400;
  const SCAN_CHECK_INTERVAL_MS = 500;
  const SCANNER_BURST_GAP_MS = 30; // keystrokes closer than this = scanner

  const hookedTextareas = new WeakSet();

  function hookSerialTextarea(doc) {
    try {
      const textarea = doc.getElementById('serialNoDatas');
      if (!textarea || hookedTextareas.has(textarea)) return;

      hookedTextareas.add(textarea);
      console.log('[Serial Parser] Hooked textarea');

      installShortcutGuard(doc, textarea);
      addParserBadge(textarea, doc);

      let snapshot = '';
      let debounceTimer = null;

      const scheduleProcess = (delay) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(
          () => processTextarea(textarea, doc, snapshot, (newSnap) => { snapshot = newSnap; }),
          delay
        );
      };

      textarea.addEventListener('input', () => scheduleProcess(PARSE_DEBOUNCE_MS));
      textarea.addEventListener('paste', () => scheduleProcess(100));

      let lastSeen = '';
      const valueObserver = setInterval(() => {
        if (textarea.value !== lastSeen && textarea.value.trim() !== '') {
          lastSeen = textarea.value;
          scheduleProcess(PARSE_DEBOUNCE_MS);
        }
      }, 300);

      const cleanupObserver = new MutationObserver(() => {
        if (!doc.body.contains(textarea)) {
          clearInterval(valueObserver);
          cleanupObserver.disconnect();
        }
      });
      cleanupObserver.observe(doc.body, { childList: true, subtree: true });
    } catch (e) { /* cross-origin iframe */ }
  }

  function processTextarea(textarea, doc, snapshot, updateSnapshot) {
    const current = textarea.value;
    if (!current.trim()) { updateSnapshot(''); return; }

    const newPart = current.startsWith(snapshot) ? current.slice(snapshot.length).trim() : current.trim();
    if (!newPart) return;

    const hasCtrl = CTRL_SEP.test(newPart);
    if (!hasCtrl && !/[,\s|;]/.test(newPart) &&
        !/^(SSCC|GTIN|IMEI|SCC3|MPN|QTY|V\d)/i.test(newPart) && newPart.length <= 20) {
      // Manual single-token entry — treat as confirmed without re-parsing
      updateSnapshot(current);
      return;
    }

    const parsed = parseBarcode(newPart);
    if (parsed.count === 0) return;
    if (parsed.format === 'Raw' && parsed.count === 1) {
      updateSnapshot(current);
      return;
    }

    const existing = snapshot.split('\n').map(l => l.trim()).filter(Boolean);
    const existingSet = new Set(existing);
    const newTokens = parsed.identifiers.map(id => id.value);
    const dups = newTokens.filter(t => existingSet.has(t));
    const fresh = newTokens.filter(t => !existingSet.has(t));

    const commit = (tokensToAdd) => {
      const merged = [...existing, ...tokensToAdd];
      textarea.value = merged.join('\n');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      updateSnapshot(textarea.value);
      flashBadge(textarea, { count: tokensToAdd.length, format: parsed.format });
    };

    if (dups.length === 0) {
      commit(newTokens);
      return;
    }

    // Duplicates are silently rejected — never added.
    if (fresh.length > 0) {
      commit(fresh);
      showToast(doc,
        `⚠️ ${dups.length} duplicate ${dups.length === 1 ? 'serial' : 'serials'} skipped, ${fresh.length} added`,
        'warn', dups);
    } else {
      // All duplicates — drop the scan, restore snapshot
      textarea.value = snapshot;
      updateSnapshot(snapshot);
      showToast(doc,
        `❌ Scan ignored — all ${dups.length} ${dups.length === 1 ? 'serial is a duplicate' : 'serials are duplicates'}`,
        'error', dups);
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  TOAST — non-blocking duplicate notice
  // ════════════════════════════════════════════════════════════════

  function showToast(doc, message, severity, dupList) {
    doc.querySelectorAll(`.serialToast[data-sev="${severity}"]`).forEach(t => t.remove());

    const colors = {
      warn:  { bg: '#f39c12', fg: '#fff' },
      error: { bg: '#c0392b', fg: '#fff' },
      ok:    { bg: '#27ae60', fg: '#fff' },
    };
    const c = colors[severity] || colors.warn;

    const toast = doc.createElement('div');
    toast.className = 'serialToast';
    toast.dataset.sev = severity;
    toast.style.cssText = `
      position: fixed; right: 16px; top: 16px; z-index: 2147483647;
      background: ${c.bg}; color: ${c.fg};
      padding: 10px 14px; border-radius: 4px;
      font: 13px -apple-system, "Segoe UI", Arial, sans-serif;
      box-shadow: 0 6px 24px rgba(0,0,0,0.25);
      max-width: 360px; cursor: pointer;
      transition: opacity .25s, transform .25s;
      opacity: 0; transform: translateY(-8px);
    `;

    const main = doc.createElement('div');
    main.style.fontWeight = 'bold';
    main.textContent = message;
    toast.appendChild(main);

    if (dupList && dupList.length) {
      const detail = doc.createElement('div');
      detail.style.cssText = 'margin-top:6px;font-family:monospace;font-size:11px;opacity:.9;';
      detail.textContent = dupList.slice(0, 4).join(', ') + (dupList.length > 4 ? `, +${dupList.length - 4} more` : '');
      toast.appendChild(detail);
    }

    const dismiss = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      setTimeout(() => toast.remove(), 250);
    };
    toast.addEventListener('click', dismiss);

    doc.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(dismiss, severity === 'error' ? 5000 : 3500);
  }

  // ════════════════════════════════════════════════════════════════
  //  SHORTCUT GUARD — kills Ctrl+J etc. when modal is open
  // ════════════════════════════════════════════════════════════════

  const PROTECTED_KEYS = /^(j|o|s|p|f|d)$/i;

  function installShortcutGuard(doc, textarea) {
    if (doc._serialShortcutGuard) return;
    doc._serialShortcutGuard = true;

    let lastKeyAt = 0;

    const guard = (e) => {
      if (!doc.body.contains(textarea)) return;
      if (doc.activeElement !== textarea) return;

      const now = performance.now();
      const delta = now - lastKeyAt;
      lastKeyAt = now;

      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;

      const inBurst = delta < SCANNER_BURST_GAP_MS;
      const isProtected = PROTECTED_KEYS.test(e.key);

      if (inBurst || isProtected) {
        e.preventDefault();
        e.stopPropagation();

        // Ctrl+J = scanner LF; convert to a literal newline in the textarea
        if (e.key && e.key.toLowerCase() === 'j') {
          const start = textarea.selectionStart, end = textarea.selectionEnd;
          textarea.value = textarea.value.slice(0, start) + '\n' + textarea.value.slice(end);
          textarea.selectionStart = textarea.selectionEnd = start + 1;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    };

    doc.defaultView.addEventListener('keydown', guard, true);
    doc.addEventListener('keydown', guard, true);
  }

  // ════════════════════════════════════════════════════════════════
  //  BADGE
  // ════════════════════════════════════════════════════════════════

  function addParserBadge(textarea, doc) {
    const badge = doc.createElement('div');
    badge.id = 'serialParserBadge';
    badge.style.cssText = `
      display:inline-block;padding:2px 8px;margin:4px 0;font-size:11px;
      font-weight:bold;color:#fff;background:#3c8dbc;border-radius:3px;transition:background .3s;
    `;
    badge.textContent = '🔍 2D Parser Active (v1.1.1)';
    textarea.parentNode.insertBefore(badge, textarea);
    textarea._parserBadge = badge;
  }

  function flashBadge(textarea, info) {
    const badge = textarea._parserBadge;
    if (!badge) return;
    badge.style.background = '#00a65a';
    badge.textContent = `✅ +${info.count} ${info.count === 1 ? 'serial' : 'serials'} (${info.format})`;
    setTimeout(() => {
      badge.style.background = '#3c8dbc';
      badge.textContent = '🔍 2D Parser Active (v1.1.1)';
    }, 3000);
  }

  // ════════════════════════════════════════════════════════════════
  //  IFRAME SCANNER
  // ════════════════════════════════════════════════════════════════

  function scanForModals() {
    hookSerialTextarea(document);
    document.querySelectorAll('iframe').forEach((iframe) => {
      try {
        const d = iframe.contentDocument || iframe.contentWindow?.document;
        if (d) hookSerialTextarea(d);
      } catch (e) { /* cross-origin */ }
    });
  }

  setInterval(scanForModals, SCAN_CHECK_INTERVAL_MS);
  console.log('[Serial Parser v1.1.1] Loaded — monitoring for serial modals.');
})();
