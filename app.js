 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/app.js b/app.js
index 27bfddef4fefeb7e8dc2302388f4b5ffc8207122..6deb0f9aed708cbd1cf86ded63f3e63cea03da20 100644
--- a/app.js
+++ b/app.js
@@ -146,114 +146,163 @@ const DB = {
       
       tx.oncomplete = () => resolve(count);
       tx.onerror = () => reject(tx.error);
     });
   },
 
   // Settings
   async getSetting(key, defaultValue = null) {
     try {
       const result = await this._tx('settings', 'readonly', s => s.get(key));
       return result ? result.value : defaultValue;
     } catch {
       return defaultValue;
     }
   },
 
   async setSetting(key, value) {
     return this._tx('settings', 'readwrite', s => s.put({ key, value }));
   }
 };
 
 // ============================================
 // GS1 BARCODE PARSER
 // ============================================
 const GS1 = {
+  _normalize(code) {
+    return (code || '').trim().replace(/[\r\n\t]/g, '');
+  },
+
+  _extractAIs(code) {
+    const fields = {};
+    let input = this._normalize(code).replace(/\u001d/g, String.fromCharCode(29));
+
+    // Support human-readable GS1 format e.g. (01)...(17)...(10)...
+    const bracketRegex = /\((\d{2})\)([^\(]*)/g;
+    let match;
+    while ((match = bracketRegex.exec(input)) !== null) {
+      fields[match[1]] = (match[2] || '').trim();
+    }
+    if (Object.keys(fields).length > 0) return fields;
+
+    // Parse compact GS1 string with AIs and FNC1 separators
+    if (input.startsWith('01') && input.length >= 16) {
+      fields['01'] = input.slice(2, 16);
+      input = input.slice(16);
+    }
+
+    const variableAIs = new Set(['10', '21']);
+
+    while (input.length >= 2) {
+      const ai = input.slice(0, 2);
+      input = input.slice(2);
+
+      if (ai === '17') {
+        fields[ai] = input.slice(0, 6);
+        input = input.slice(6);
+        continue;
+      }
+
+      if (variableAIs.has(ai)) {
+        const stop = input.search(String.fromCharCode(29));
+        if (stop === -1) {
+          fields[ai] = input;
+          break;
+        }
+        fields[ai] = input.slice(0, stop);
+        input = input.slice(stop + 1);
+        continue;
+      }
+
+      break;
+    }
+
+    return fields;
+  },
+
   parse(code) {
     const result = {
       raw: code || '',
       gtin: '',
       expiry: '',
       expiryISO: '',
       expiryDisplay: '',
       batch: '',
       serial: '',
       qty: 1,
       isGS1: false
     };
 
     if (!code || typeof code !== 'string') return result;
 
-    code = code.trim().replace(/[\r\n\t]/g, '');
+    code = this._normalize(code);
 
     // Check for GS1 format (contains AIs)
     const hasAI = code.includes('(') || /^01\d{14}/.test(code);
 
     if (!hasAI) {
       // Plain barcode
       const digits = code.replace(/\D/g, '');
       if (digits.length >= 8 && digits.length <= 14) {
         result.gtin = digits.padStart(14, '0');
       }
       return result;
     }
 
     result.isGS1 = true;
 
+    const aiFields = this._extractAIs(code);
+
     // Parse GTIN (01)
-    const gtinMatch = code.match(/\(01\)(\d{14})|^01(\d{14})/);
-    if (gtinMatch) {
-      result.gtin = gtinMatch[1] || gtinMatch[2];
+    if (aiFields['01'] && /^\d{14}$/.test(aiFields['01'])) {
+      result.gtin = aiFields['01'];
     }
 
     // Parse Expiry (17)
-    const expiryMatch = code.match(/\(17\)(\d{6})|17(\d{6})/);
-    if (expiryMatch) {
-      const yymmdd = expiryMatch[1] || expiryMatch[2];
+    if (aiFields['17'] && /^\d{6}$/.test(aiFields['17'])) {
+      const yymmdd = aiFields['17'];
       result.expiry = yymmdd;
 
       const yy = parseInt(yymmdd.substring(0, 2));
       const mm = parseInt(yymmdd.substring(2, 4));
       let dd = parseInt(yymmdd.substring(4, 6));
 
       const year = 2000 + yy;
       if (dd === 0) dd = new Date(year, mm, 0).getDate();
 
       result.expiryISO = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
       result.expiryDisplay = `${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${year}`;
     }
 
     // Parse Batch (10)
-    const batchMatch = code.match(/\(10\)([^\(]+)|10([A-Za-z0-9\-]+)/);
-    if (batchMatch) {
-      result.batch = (batchMatch[1] || batchMatch[2] || '').replace(/[^\w\-]/g, '').substring(0, 20);
+    if (aiFields['10']) {
+      result.batch = aiFields['10'].replace(/[^\w\-]/g, '').substring(0, 20);
     }
 
     // Parse Serial (21)
-    const serialMatch = code.match(/\(21\)([^\(]+)|21([A-Za-z0-9]+)/);
-    if (serialMatch) {
-      result.serial = (serialMatch[1] || serialMatch[2] || '').substring(0, 20);
+    if (aiFields['21']) {
+      result.serial = aiFields['21'].replace(/[^\w\-]/g, '').substring(0, 20);
     }
 
     return result;
   },
 
   getExpiryStatus(expiryISO) {
     if (!expiryISO) return 'unknown';
 
     const today = new Date();
     today.setHours(0, 0, 0, 0);
 
     const expiry = new Date(expiryISO);
     expiry.setHours(0, 0, 0, 0);
 
     const diffDays = Math.floor((expiry - today) / (1000 * 60 * 60 * 24));
 
     if (diffDays < 0) return 'expired';
     if (diffDays <= CONFIG.EXPIRY_SOON_DAYS) return 'expiring';
     return 'ok';
   }
 };
 
 // ============================================
 // PRODUCT MATCHING
 // ============================================
@@ -314,109 +363,127 @@ const Matcher = {
       return {
         name: App.masterIndex.get(gtin13),
         rms: App.masterRMS.get(gtin13) || '',
         matchType: 'GTIN13'
       };
     }
 
     // Last 8 digits
     const last8 = gtin.slice(-8);
     if (App.masterIndex.has(last8)) {
       return {
         name: App.masterIndex.get(last8),
         rms: App.masterRMS.get(last8) || '',
         matchType: 'LAST8'
       };
     }
 
     return { name: '', rms: '', matchType: 'NONE' };
   }
 };
 
 // ============================================
 // EXTERNAL API LOOKUPS
 // ============================================
 const API = {
+  _cleanName(value) {
+    return typeof value === 'string' ? value.trim() : '';
+  },
+
   async lookup(gtin) {
     if (!App.settings.apiEnabled || !navigator.onLine) return null;
 
     const cleanGtin = gtin.replace(/\D/g, '').padStart(14, '0');
 
     // Try Brocade (best for medicines)
     let result = await this.brocade(cleanGtin);
     if (result) return result;
 
     // Try OpenFoodFacts
     result = await this.openFoodFacts(cleanGtin);
     if (result) return result;
 
     // Try UPCitemdb
     result = await this.upcItemDb(cleanGtin);
     if (result) return result;
 
     return null;
   },
 
   async brocade(gtin) {
     try {
       const res = await fetch(`https://www.brocade.io/api/items/${gtin}`, {
         signal: AbortSignal.timeout(5000)
       });
       if (!res.ok) return null;
       const data = await res.json();
-      if (data.name) {
-        return { name: data.name, source: 'Brocade' };
+      const name = this._cleanName(data.name || data.description || data.title || data.product_name);
+      if (name) {
+        return { name, source: 'Brocade' };
       }
     } catch (e) {
       console.log('Brocade API:', e.message);
     }
     return null;
   },
 
   async openFoodFacts(gtin) {
     try {
       const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${gtin}.json`, {
         signal: AbortSignal.timeout(5000)
       });
       const data = await res.json();
-      if (data.status === 1 && data.product?.product_name) {
-        return { name: data.product.product_name, source: 'OpenFoodFacts' };
+      if (data.status === 1 && data.product) {
+        const product = data.product;
+        const name = this._cleanName(
+          product.product_name ||
+          product.product_name_en ||
+          product.generic_name ||
+          product.brands
+        );
+        if (name) {
+          return { name, source: 'OpenFoodFacts' };
+        }
       }
     } catch (e) {
       console.log('OpenFoodFacts API:', e.message);
     }
     return null;
   },
 
   async upcItemDb(gtin) {
     try {
       const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${gtin}`, {
         signal: AbortSignal.timeout(5000)
       });
       const data = await res.json();
-      if (data.code === 'OK' && data.items?.[0]?.title) {
-        return { name: data.items[0].title, source: 'UPCitemdb' };
+      if (data.code === 'OK' && data.items?.[0]) {
+        const item = data.items[0];
+        const name = this._cleanName(item.title || item.description || item.brand);
+        if (name) {
+          return { name, source: 'UPCitemdb' };
+        }
       }
     } catch (e) {
       console.log('UPCitemdb API:', e.message);
     }
     return null;
   }
 };
 
 // ============================================
 // BARCODE PROCESSING
 // ============================================
 async function processBarcode(code, options = {}) {
   const { silent = false, skipRefresh = false } = options;
 
   if (!code || typeof code !== 'string') return null;
   code = code.trim();
   if (!code) return null;
 
   // Parse GS1
   const parsed = GS1.parse(code);
 
   // If no GTIN found, try to use raw as barcode
   if (!parsed.gtin) {
     const digits = code.replace(/\D/g, '');
     if (digits.length >= 8) {
@@ -878,90 +945,136 @@ async function saveEdit() {
       rms: item.rms
     });
     await refreshMasterCount();
   }
 
   closeModal();
   await refreshUI();
   toast('Item updated', 'success');
 }
 
 function closeModal() {
   document.getElementById('editModal').classList.remove('active');
 }
 
 async function deleteItem(id) {
   if (!confirm('Delete this item?')) return;
 
   await DB.deleteHistory(id);
   await refreshUI();
   toast('Item deleted', 'success');
 }
 
 // ============================================
 // MASTER DATA MANAGEMENT
 // ============================================
+function detectMasterDelimiter(headerLine) {
+  const options = ['	', ',', ';', '|'];
+  let best = ',';
+  let maxCount = -1;
+
+  for (const delim of options) {
+    const count = headerLine.split(delim).length;
+    if (count > maxCount) {
+      maxCount = count;
+      best = delim;
+    }
+  }
+
+  return best;
+}
+
+function parseDelimitedLine(line, delimiter) {
+  const cells = [];
+  let current = '';
+  let inQuotes = false;
+
+  for (let i = 0; i < line.length; i++) {
+    const char = line[i];
+
+    if (char === '"') {
+      if (inQuotes && line[i + 1] === '"') {
+        current += '"';
+        i++;
+      } else {
+        inQuotes = !inQuotes;
+      }
+      continue;
+    }
+
+    if (char === delimiter && !inQuotes) {
+      cells.push(current.trim());
+      current = '';
+      continue;
+    }
+
+    current += char;
+  }
+
+  cells.push(current.trim());
+  return cells.map(cell => cell.replace(/^['"]|['"]$/g, '').trim());
+}
+
 async function uploadMaster(file, append = false) {
   showLoading('Uploading...');
 
   try {
     const text = await file.text();
-    const lines = text.trim().split(/[\r\n]+/);
+    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
 
     if (lines.length < 2) {
       toast('Invalid file format', 'error');
       hideLoading();
       return;
     }
 
-    // Parse header
-    const header = lines[0].toLowerCase();
-    const delim = header.includes('\t') ? '\t' : ',';
-    const cols = header.split(delim).map(c => c.trim().replace(/['"]/g, ''));
+    // Parse header with robust delimiter and quoted cell support
+    const delimiter = detectMasterDelimiter(lines[0]);
+    const cols = parseDelimitedLine(lines[0].toLowerCase(), delimiter);
 
     // Find columns
     const barcodeIdx = cols.findIndex(c => ['barcode', 'gtin', 'ean', 'upc', 'code'].includes(c));
-    const nameIdx = cols.findIndex(c => ['name', 'description', 'product', 'productname'].includes(c));
+    const nameIdx = cols.findIndex(c => ['name', 'description', 'product', 'productname', 'item description'].includes(c));
     const rmsIdx = cols.findIndex(c => ['rms', 'rmscode', 'rms code', 'rms_code'].includes(c));
 
     if (barcodeIdx === -1) {
       toast('No barcode column found (need: barcode, gtin, ean, or code)', 'error');
       hideLoading();
       return;
     }
 
     if (!append) {
       await DB.clearMaster();
     }
 
     // Parse rows
     const items = [];
     for (let i = 1; i < lines.length; i++) {
-      const row = lines[i].split(delim).map(c => c.trim().replace(/['"]/g, ''));
-      const barcode = row[barcodeIdx];
-      const name = nameIdx >= 0 ? row[nameIdx] : '';
-      const rms = rmsIdx >= 0 ? row[rmsIdx] : '';
+      const row = parseDelimitedLine(lines[i], delimiter);
+      const barcode = (row[barcodeIdx] || '').replace(/\s+/g, '');
+      const name = nameIdx >= 0 ? (row[nameIdx] || '') : '';
+      const rms = rmsIdx >= 0 ? (row[rmsIdx] || '') : '';
 
       if (barcode && barcode.length >= 8) {
         items.push({ barcode, name, rms });
       }
     }
 
     const count = await DB.bulkAddMaster(items);
     await refreshMasterCount();
 
     toast(`${append ? 'Appended' : 'Uploaded'} ${count} products`, 'success');
   } catch (e) {
     console.error('Upload error:', e);
     toast('Upload failed: ' + e.message, 'error');
   }
 
   hideLoading();
 }
 
 async function resetMaster() {
   if (!confirm('Reset all product data? This cannot be undone.')) return;
 
   await DB.clearMaster();
   await refreshMasterCount();
   toast('Master data cleared', 'success');
 }
 
EOF
)
