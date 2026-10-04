/**
 * AxisDB - Engine de banco de dados do lado do cliente para o MeuFinanceiro
 * Arquitetura Dual-Storage: LocalStorage (síncrono rápido) + IndexedDB (backup durável e estruturado)
 */

(function(global) {
    'use strict';

    const STORAGE_KEY = 'meufinanceiro_data';
    const DB_NAME = 'MeuFinanceiroDB';
    const DB_VERSION = 1;
    const MAX_BACKUPS = 30;
    const BACKUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
    const DEBOUNCE_DELAY_MS = 2000; // 2 segundos

    const defaultData = {
        userName: 'Usuário',
        savingsPercent: 20,
        minSavingsPercent: 5,
        savingsRuleMode: 'income',
        darkMode: false,
        privacyMode: false,
        salary: null,
        incomes: [],
        expenses: [],
        fixedExpenses: [],
        detailedExpenses: [],
        savingsTransactions: [],
        savingsGoals: [],
        savingsBalance: 0,
        budgetLimits: {},
        investments: [],
        quarantineItems: [],
        totalAvoidedImpulses: 0,
        extraIncomeCategories: ['Fotos', 'Freelance', 'Bicos', 'Outros'],
        minWageBase: 1412.00,
        minWageDivisorAllocation: { essencial: 50, pessoal: 30, poupanca: 20 }
    };

    // Estado interno
    let dbInstance = null;
    let saveQueue = Promise.resolve();
    let isEncrypted = false;
    let isLocked = false;
    let currentKey = null; // CryptoKey para AES-GCM
    let saltHex = null; // Salt para derivar a chave
    let ivHex = null; // IV inicial, embora devamos gerar um IV por salvamento
    let lastBackupTime = Date.now();
    let backupTimer = null;
    
    // Utilitários de log e eventos
    const logInfo = (msg, ...args) => console.log(`[AxisDB] ${msg}`, ...args);
    const logWarn = (msg, ...args) => console.warn(`[AxisDB] ${msg}`, ...args);
    const logError = (msg, ...args) => console.error(`[AxisDB] ${msg}`, ...args);

    const dispatchEvent = (name, detail = {}) => {
        try {
            document.dispatchEvent(new CustomEvent(`axisdb:${name}`, { detail }));
        } catch (e) {
            logError('Erro ao disparar evento', e);
        }
    };

    // ============================================================================
    // Criptografia e Hashes (Web Crypto API)
    // ============================================================================

    const buf2hex = (buffer) => Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
    const hex2buf = (hex) => new Uint8Array(hex.match(/[\da-f]{2}/gi).map(h => parseInt(h, 16))).buffer;

    const computeSHA256 = async (str) => {
        try {
            const msgBuffer = new TextEncoder().encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            return buf2hex(hashBuffer);
        } catch (e) {
            logError('Erro ao calcular SHA-256', e);
            return null;
        }
    };

    const deriveKey = async (pin, saltStr) => {
        try {
            const enc = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey(
                "raw",
                enc.encode(pin),
                { name: "PBKDF2" },
                false,
                ["deriveBits", "deriveKey"]
            );
            const saltBuffer = hex2buf(saltStr);
            return await crypto.subtle.deriveKey(
                {
                    name: "PBKDF2",
                    salt: saltBuffer,
                    iterations: 100000,
                    hash: "SHA-256"
                },
                keyMaterial,
                { name: "AES-GCM", length: 256 },
                false,
                ["encrypt", "decrypt"]
            );
        } catch (e) {
            logError('Erro ao derivar chave', e);
            throw e;
        }
    };

    const encryptData = async (dataStr, key) => {
        try {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const enc = new TextEncoder();
            const encryptedBuffer = await crypto.subtle.encrypt(
                { name: "AES-GCM", iv: iv },
                key,
                enc.encode(dataStr)
            );
            return {
                iv: buf2hex(iv),
                data: buf2hex(encryptedBuffer)
            };
        } catch (e) {
            logError('Erro na criptografia', e);
            throw e;
        }
    };

    const decryptData = async (encryptedHex, ivHex, key) => {
        try {
            const decryptedBuffer = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: hex2buf(ivHex) },
                key,
                hex2buf(encryptedHex)
            );
            return new TextDecoder().decode(decryptedBuffer);
        } catch (e) {
            logError('Erro na descriptografia', e);
            return null;
        }
    };

    // ============================================================================
    // IndexedDB Wrapper
    // ============================================================================

    const openDB = () => {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB não suportado'));
            if (dbInstance) return resolve(dbInstance);
            try {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
            
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('mainData')) {
                    db.createObjectStore('mainData', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('backups')) {
                    db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('auditLog')) {
                    db.createObjectStore('auditLog', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: 'key' });
                }
            };
            
            req.onsuccess = (e) => {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };
            
            req.onerror = (e) => reject(e.target.error);
            } catch (err) {
                reject(err);
            }
        });
    };

    const idbPut = async (storeName, data) => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    };

    const idbGet = async (storeName, key) => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    };

    const idbDelete = async (storeName, key) => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    };

    const idbGetAll = async (storeName) => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    };

    const idbClear = async (storeName) => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    };

    const addAuditLog = async (action, details, success = true) => {
        try {
            const entry = { timestamp: Date.now(), action, details, success };
            await idbPut('auditLog', entry);
            
            // Manter apenas 200 logs
            const db = await openDB();
            const tx = db.transaction('auditLog', 'readwrite');
            const store = tx.objectStore('auditLog');
            const countReq = store.count();
            countReq.onsuccess = () => {
                if (countReq.result > 200) {
                    store.openCursor().onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            cursor.delete();
                            if (countReq.result-- > 200) cursor.continue();
                        }
                    };
                }
            };
        } catch (e) {
            logError('Erro ao salvar log de auditoria', e);
        }
    };

    // ============================================================================
    // Validação e Esquema Robusto (Deep Sanitization)
    // ============================================================================

    const sanitizeItem = (key, item) => {
        if (!item || typeof item !== 'object') return null;
        const copy = { ...item };
        
        // Garante identificador único íntegro
        if (!copy.id || typeof copy.id !== 'string') {
            copy.id = key.substr(0, 3) + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        }
        
        // Sanear campos monetários/numéricos
        const numFields = ['value', 'invested', 'current', 'investedAmount', 'currentAmount', 'target', 'monthlyYield', 'quarantineDays', 'costInDays', 'costInHours', 'dueDay'];
        numFields.forEach(field => {
            if (field in copy) {
                const parsed = parseFloat(copy[field]);
                copy[field] = (!isNaN(parsed) && isFinite(parsed)) ? Math.round(parsed * 100) / 100 : 0;
            }
        });

        // Sanear strings essenciais
        if ('desc' in copy && typeof copy.desc !== 'string') copy.desc = String(copy.desc || '');
        if ('name' in copy && typeof copy.name !== 'string') copy.name = String(copy.name || '');
        if ('category' in copy && typeof copy.category !== 'string') copy.category = String(copy.category || 'Outros');
        
        // Validar e padronizar formato de data (YYYY-MM-DD)
        if ('date' in copy) {
            if (typeof copy.date !== 'string' || copy.date.length < 8) {
                copy.date = new Date().toISOString().split('T')[0];
            } else if (copy.date.length > 10) {
                copy.date = copy.date.substr(0, 10);
            }
        }

        return copy;
    };

    const validateData = (data) => {
        const result = { valid: true, fixed: [], errors: [] };
        if (!data || typeof data !== 'object') {
            return { valid: false, fixed: ['Root'], errors: ['Data is not an object'], data: { ...defaultData } };
        }

        const cleanData = {};
        
        // 1. Validar e preencher chaves padrão do sistema
        for (const [key, defVal] of Object.entries(defaultData)) {
            let val = data[key];
            const defType = typeof defVal;
            
            if (val === undefined || val === null) {
                if (defVal === null) {
                    cleanData[key] = null;
                } else {
                    cleanData[key] = Array.isArray(defVal) ? [...defVal] : (typeof defVal === 'object' ? { ...defVal } : defVal);
                    result.fixed.push(key);
                    result.valid = false;
                }
                continue;
            }

            if (Array.isArray(defVal)) {
                if (!Array.isArray(val)) {
                    cleanData[key] = [];
                    result.fixed.push(key);
                    result.valid = false;
                } else {
                    // Saneamento profundo: remove nulos e recupera campos corrompidos
                    cleanData[key] = val
                        .map(item => sanitizeItem(key, item))
                        .filter(item => item !== null);
                }
            } else if (defType === 'number') {
                const parsedNum = parseFloat(val);
                if (isNaN(parsedNum) || !isFinite(parsedNum)) {
                    cleanData[key] = defVal;
                    result.fixed.push(key);
                    result.valid = false;
                    if (key === 'savingsBalance') cleanData._recalcSavings = true;
                } else {
                    cleanData[key] = parsedNum;
                }
            } else if (defType === 'boolean') {
                cleanData[key] = Boolean(val);
            } else if (defType === 'string') {
                cleanData[key] = typeof val === 'string' ? val : String(val);
            } else if (defVal === null) {
                // salary ou campos anuláveis
                if (key === 'salary') {
                    if (val && typeof val === 'object') {
                        cleanData[key] = {
                            desc: typeof val.desc === 'string' ? val.desc : 'Salário Fixo',
                            value: (parseFloat(val.value) > 0) ? parseFloat(val.value) : 1412.00,
                            payDay: (parseInt(val.payDay) >= 1 && parseInt(val.payDay) <= 31) ? parseInt(val.payDay) : 5,
                            autoRegister: Boolean(val.autoRegister)
                        };
                    } else {
                        cleanData[key] = null;
                    }
                } else {
                    cleanData[key] = val;
                }
            } else if (typeof defVal === 'object') {
                cleanData[key] = (val && typeof val === 'object' && !Array.isArray(val)) ? { ...val } : { ...defVal };
            } else {
                cleanData[key] = val;
            }
        }

        // 2. Proteção e Recálculo de Integridade de savingsBalance
        if (cleanData._recalcSavings || typeof cleanData.savingsBalance !== 'number' || isNaN(cleanData.savingsBalance) || cleanData.savingsBalance < 0) {
            delete cleanData._recalcSavings;
            if (Array.isArray(cleanData.savingsTransactions) && cleanData.savingsTransactions.length > 0) {
                cleanData.savingsBalance = cleanData.savingsTransactions.reduce((acc, tx) => {
                    const v = typeof tx.value === 'number' ? tx.value : 0;
                    return tx.type === 'withdraw' ? acc - v : acc + v;
                }, 0);
                cleanData.savingsBalance = Math.max(0, Math.round(cleanData.savingsBalance * 100) / 100);
            } else {
                cleanData.savingsBalance = 0;
            }
            result.fixed.push('savingsBalance_recalc');
        }

        // 3. PRESERVAÇÃO DE CAMPOS DINÂMICOS E FUTUROS
        // Não descarta propriedades seguras que existam em data e não estejam no defaultData
        for (const [key, val] of Object.entries(data)) {
            if (!(key in cleanData) && key !== '__proto__' && key !== 'constructor') {
                cleanData[key] = val;
            }
        }
        
        result.data = cleanData;
        return result;
    };

    // ============================================================================
    // Engine Principal e Sincronização Sólida
    // ============================================================================

    let debounceTimer = null;
    let pendingDataStr = null;

    const flushIDBSync = async () => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        if (!pendingDataStr) return;
        const dataToSave = pendingDataStr;
        pendingDataStr = null;

        try {
            const checksum = await computeSHA256(dataToSave);
            await idbPut('mainData', { id: 1, data: dataToSave, checksum, timestamp: Date.now() });
            addAuditLog('save_flush', 'Sincronização imediata com IndexedDB concluída');
            
            // Backup automático se o intervalo foi atingido
            if (Date.now() - lastBackupTime > BACKUP_INTERVAL_MS) {
                await createBackup(dataToSave, checksum);
                lastBackupTime = Date.now();
            }
        } catch (e) {
            logError('Erro no flush IDB', e);
            addAuditLog('flush_error', e.message, false);
        }
    };

    const enqueueIDBSync = (dataStr) => {
        pendingDataStr = dataStr;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            saveQueue = saveQueue.then(() => flushIDBSync());
        }, DEBOUNCE_DELAY_MS);
    };

    // Garantir persistência ao fechar ou ocultar a aba
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('beforeunload', () => { flushIDBSync(); });
        window.addEventListener('pagehide', () => { flushIDBSync(); });
    }

    const createBackup = async (dataStr, checksum) => {
        try {
            await idbPut('backups', {
                timestamp: Date.now(),
                dataSize: dataStr.length,
                data: dataStr,
                checksum
            });
            addAuditLog('backup_created', 'Backup automático criado');
            dispatchEvent('backup', { timestamp: Date.now() });

            // Pruning
            const backups = await idbGetAll('backups');
            if (backups.length > MAX_BACKUPS) {
                backups.sort((a, b) => a.timestamp - b.timestamp);
                for (let i = 0; i < backups.length - MAX_BACKUPS; i++) {
                    await idbDelete('backups', backups[i].id);
                }
            }
        } catch (e) {
            logError('Erro ao criar backup', e);
        }
    };

    const readLocalStorage = () => {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            logError('Erro no localStorage.getItem', e);
            return null;
        }
    };

    const writeLocalStorage = (str) => {
        try {
            localStorage.setItem(STORAGE_KEY, str);
            return true;
        } catch (e) {
            logError('Erro no localStorage.setItem', e);
            if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
                addAuditLog('quota_exceeded', 'LocalStorage cheio. Dados preservados no IndexedDB.', false);
                dispatchEvent('warning', { type: 'quota_exceeded', message: 'Limite de armazenamento do navegador atingido.' });
                flushIDBSync();
            }
            return false;
        }
    };

    // ============================================================================
    // API Pública AxisDB
    // ============================================================================

    const AxisDB = {
        STORAGE_KEY,
        DB_VERSION,

        async init() {
            try {
                await openDB();
                const metaEnc = await idbGet('metadata', 'encryption');
                if (metaEnc && metaEnc.enabled) {
                    isEncrypted = true;
                    isLocked = true;
                    saltHex = metaEnc.salt;
                }
                addAuditLog('init', 'AxisDB inicializado');
                dispatchEvent('ready');
                return true;
            } catch (e) {
                logError('Erro no init', e);
                return false;
            }
        },

        load() {
            try {
                if (isLocked) {
                    logWarn('Tentativa de ler dados bloqueados');
                    return null;
                }

                // Se há cache na memória (pós-unlock ou pós-save), retornar
                if (this._memCache) return this._memCache;

                const rawData = readLocalStorage();
                if (!rawData) {
                    addAuditLog('load', 'Nenhum dado encontrado, usando padrão');
                    this._memCache = { ...defaultData };
                    return this._memCache;
                }

                // Parsear do localStorage com detecção de segurança
                try {
                    const parsed = JSON.parse(rawData);

                    // DETECÇÃO AUTOMÁTICA DE PAYLOAD CRIPTOGRAFADO NO STORAGE
                    if (parsed && typeof parsed === 'object' && parsed.iv && parsed.data && typeof parsed.data === 'string' && !parsed.userName) {
                        isEncrypted = true;
                        isLocked = true;
                        logInfo('Detectado payload criptografado no storage. Bloqueando até unlock().');
                        return null;
                    }

                    if (isEncrypted) {
                        logError('load() síncrono chamado em dados encriptados sem cache. Chame unlock() primeiro.');
                        return null;
                    }

                    // Formato envelope { data: ... } de backups importados
                    const actualData = (parsed && parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) && parsed.data.userName)
                        ? parsed.data
                        : parsed;

                    const validation = validateData(actualData);
                    if (validation.fixed.length > 0) {
                        addAuditLog('validation_fix', 'Campos corrigidos: ' + validation.fixed.join(', '));
                    }
                    this._memCache = validation.data;

                    // Verificação de integridade assíncrona em background
                    this._asyncIntegrityCheck(rawData);

                    return validation.data;
                } catch (e) {
                    logError('Erro no JSON.parse do localStorage, tentando recovery', e);
                    addAuditLog('load_error', 'JSON corrupto no localStorage: ' + e.message, false);
                    this._asyncRecovery();
                    this._memCache = { ...defaultData };
                    return this._memCache;
                }
            } catch (e) {
                logError('Erro fatal no load()', e);
                this._memCache = { ...defaultData };
                return this._memCache;
            }
        },

        // Verificação de integridade assíncrona (não bloqueia o load)
        async _asyncIntegrityCheck(currentLSData) {
            try {
                const mainData = await idbGet('mainData', 1);
                if (!mainData) {
                    // Primeira vez — sincronizar localStorage → IndexedDB
                    const checksum = await computeSHA256(currentLSData);
                    await idbPut('mainData', { id: 1, data: currentLSData, checksum, timestamp: Date.now() });
                    addAuditLog('init_sync', 'Dados sincronizados localStorage → IndexedDB');
                }
            } catch (e) {
                logError('Erro na verificação assíncrona', e);
            }
        },

        // Recuperação assíncrona do IndexedDB quando localStorage está corrupto
        async _asyncRecovery() {
            try {
                logInfo('Iniciando recuperação assíncrona do IndexedDB...');
                const mainData = await idbGet('mainData', 1);
                if (mainData && mainData.data) {
                    const parsed = JSON.parse(mainData.data);
                    const validation = validateData(parsed);
                    this._memCache = validation.data;
                    writeLocalStorage(JSON.stringify(validation.data));
                    addAuditLog('recovery', 'Dados recuperados do IndexedDB mainData');
                    dispatchEvent('recovery', { source: 'mainData' });
                    logInfo('Dados recuperados com sucesso do IndexedDB!');
                    return;
                }

                // Se mainData falhou, tentar último backup
                const backups = await idbGetAll('backups');
                if (backups.length > 0) {
                    backups.sort((a, b) => b.timestamp - a.timestamp);
                    const latest = backups[0];
                    const parsed = JSON.parse(latest.data);
                    const validation = validateData(parsed);
                    this._memCache = validation.data;
                    writeLocalStorage(JSON.stringify(validation.data));
                    addAuditLog('recovery', `Dados recuperados do backup #${latest.id}`);
                    dispatchEvent('recovery', { source: 'backup', id: latest.id });
                    logInfo('Dados recuperados do backup mais recente!');
                    return;
                }

                logWarn('Nenhum backup disponível para recovery. Usando dados padrão.');
                addAuditLog('recovery_failed', 'Sem backups disponíveis', false);
            } catch (e) {
                logError('Falha total na recovery assíncrona', e);
                addAuditLog('recovery_failed', e.message, false);
            }
        },

        save(data) {
            try {
                if (isLocked) {
                    logWarn('Tentativa de salvar com DB bloqueado. Ignorado.');
                    return false;
                }
                const validation = validateData(data);
                if (!validation.valid) {
                    addAuditLog('validation_fix_on_save', validation.fixed.join(', '));
                }
                const cleanData = validation.data;
                this._memCache = cleanData; // atualizar cache na memória

                const jsonStr = JSON.stringify(cleanData);
                
                if (isEncrypted && currentKey) {
                    // O save síncrono em localStorage precisaria ser async para encrypt.
                    // Contorno: salvamos um "placeholder" ou disparamos processo assíncrono para o LS também?
                    // Como save() deve ser SYNC, vamos encriptar de forma assíncrona e atualizar o LS logo após.
                    // Isso pode deixar o LS desatualizado por milisegundos, mas é a limitação da WebCrypto API.
                    (async () => {
                        try {
                            const enc = await encryptData(jsonStr, currentKey);
                            writeLocalStorage(JSON.stringify(enc));
                            const checksum = await computeSHA256(jsonStr);
                            enqueueIDBSync(JSON.stringify({ encrypted: enc, checksum }));
                        } catch (e) { logError(e); }
                    })();
                } else {
                    // Texto plano
                    writeLocalStorage(jsonStr); // O código antigo já salva raw object. Pra não quebrar, salvar raw object
                    enqueueIDBSync(jsonStr);
                }

                dispatchEvent('saved');
                return true;
            } catch (e) {
                logError('Erro no save()', e);
                dispatchEvent('error', { msg: 'Erro no save', error: e.message });
                return false;
            }
        },

        async setPin(pin) {
            try {
                if (!pin || pin.length < 4 || pin.length > 8) throw new Error("PIN deve ter 4 a 8 dígitos");
                const salt = crypto.getRandomValues(new Uint8Array(16));
                saltHex = buf2hex(salt);
                currentKey = await deriveKey(pin, saltHex);
                
                await idbPut('metadata', { key: 'encryption', enabled: true, salt: saltHex });
                isEncrypted = true;
                isLocked = false;
                
                // Criptografar dados existentes
                const currentData = this.load() || defaultData;
                this.save(currentData);
                
                addAuditLog('pin_set', 'PIN configurado');
                return true;
            } catch (e) {
                logError('Erro ao definir PIN', e);
                return false;
            }
        },

        async removePin(currentPin) {
            try {
                if (!isEncrypted) return true;
                const testKey = await deriveKey(currentPin, saltHex);
                // testar descriptografia para validar PIN
                const rawLS = readLocalStorage();
                if (rawLS) {
                    const parsed = JSON.parse(rawLS);
                    if (parsed.iv && parsed.data) {
                        const dec = await decryptData(parsed.data, parsed.iv, testKey);
                        if (!dec) throw new Error("PIN incorreto");
                    }
                }
                
                // Remover pin
                await idbDelete('metadata', 'encryption');
                isEncrypted = false;
                isLocked = false;
                currentKey = null;
                saltHex = null;
                
                const currentData = this._memCache || defaultData;
                this.save(currentData);
                
                addAuditLog('pin_removed', 'PIN removido');
                return true;
            } catch (e) {
                logError('Erro ao remover PIN', e);
                return false;
            }
        },

        async changePin(oldPin, newPin) {
            try {
                const unlocked = await this.unlock(oldPin);
                if (!unlocked) return false;
                return await this.setPin(newPin);
            } catch (e) {
                logError('Erro ao alterar PIN', e);
                return false;
            }
        },

        isLocked() {
            return isLocked;
        },

        isEncrypted() {
            return isEncrypted;
        },

        async unlock(pin) {
            try {
                if (!isEncrypted) return true;
                const testKey = await deriveKey(pin, saltHex);
                
                // Testar com localStorage
                const rawLS = readLocalStorage();
                if (!rawLS) return false;
                
                const parsed = JSON.parse(rawLS);
                if (!parsed.iv || !parsed.data) throw new Error("Dados não criptografados no storage");
                
                const decryptedStr = await decryptData(parsed.data, parsed.iv, testKey);
                if (!decryptedStr) {
                    logError('Falha ao descriptografar (PIN incorreto?)');
                    return false;
                }
                
                currentKey = testKey;
                isLocked = false;
                this._memCache = JSON.parse(decryptedStr);
                
                addAuditLog('unlock', 'Desbloqueado com sucesso');
                dispatchEvent('unlocked');
                return true;
            } catch (e) {
                logError('Erro no unlock()', e);
                return false;
            }
        },

        async verify() {
            try {
                const mainData = await idbGet('mainData', 1);
                if (!mainData) return { status: 'warning', details: ['Nenhum dado no IndexedDB'] };
                
                let dataStr = mainData.data;
                if (isEncrypted && mainData.data.startsWith('{')) { // format {encrypted:{iv, data}, checksum}
                    const parsed = JSON.parse(mainData.data);
                    dataStr = parsed.encrypted ? JSON.stringify(parsed.encrypted) : mainData.data;
                }
                
                const calcChecksum = await computeSHA256(dataStr);
                if (calcChecksum !== mainData.checksum) {
                    addAuditLog('integrity_fail', 'Checksum incorreto na verificação');
                    return { status: 'error', details: ['Falha de integridade. Checksum não confere.'] };
                }
                
                return { status: 'ok', details: ['Banco de dados íntegro'] };
            } catch (e) {
                return { status: 'error', details: [e.message] };
            }
        },

        async getBackups() {
            try {
                const backups = await idbGetAll('backups');
                return backups.map(b => ({
                    id: b.id,
                    timestamp: b.timestamp,
                    size: b.dataSize
                })).sort((a, b) => b.timestamp - a.timestamp);
            } catch (e) {
                logError('Erro ao listar backups', e);
                return [];
            }
        },

        async restoreBackup(id) {
            try {
                const backup = await idbGet('backups', id);
                if (!backup) throw new Error("Backup não encontrado");
                
                let restoreStr = backup.data;
                if (isEncrypted && currentKey) {
                    const parsed = JSON.parse(backup.data);
                    if (parsed.encrypted) {
                        restoreStr = await decryptData(parsed.encrypted.data, parsed.encrypted.iv, currentKey);
                        if (!restoreStr) throw new Error("Falha na descriptografia do backup");
                    }
                }
                
                const validation = validateData(JSON.parse(restoreStr));
                this._memCache = validation.data;
                this.save(validation.data);
                
                addAuditLog('backup_restored', `Restaurado backup ${id}`);
                dispatchEvent('recovery', { id });
                return validation.data;
            } catch (e) {
                logError('Erro ao restaurar', e);
                return null;
            }
        },

        async exportEncrypted(pin) {
            try {
                const data = this._memCache || this.load();
                const str = JSON.stringify(data);
                // Criar chave temporária para exportação
                const salt = crypto.getRandomValues(new Uint8Array(16));
                const exportSalt = buf2hex(salt);
                const exportKey = await deriveKey(pin, exportSalt);
                const enc = await encryptData(str, exportKey);
                
                return JSON.stringify({
                    salt: exportSalt,
                    iv: enc.iv,
                    data: enc.data,
                    timestamp: Date.now()
                });
            } catch (e) {
                logError('Erro no export', e);
                return null;
            }
        },

        async importEncrypted(blobStr, pin) {
            try {
                const blob = JSON.parse(blobStr);
                const importKey = await deriveKey(pin, blob.salt);
                const decryptedStr = await decryptData(blob.data, blob.iv, importKey);
                if (!decryptedStr) throw new Error("Falha na descriptografia da importação");
                
                const validation = validateData(JSON.parse(decryptedStr));
                this._memCache = validation.data;
                this.save(validation.data);
                return true;
            } catch (e) {
                logError('Erro no import', e);
                return false;
            }
        },

        async getStats() {
            try {
                const backups = await idbGetAll('backups');
                const mainData = await idbGet('mainData', 1);
                return {
                    totalSaves: 0, // Daria para computar usando o audit log ou um contador no IDB
                    backupCount: backups.length,
                    dbSize: mainData ? mainData.data.length : 0,
                    lastSave: mainData ? mainData.timestamp : null,
                    lastBackup: backups.length > 0 ? backups[backups.length - 1].timestamp : null,
                    encrypted: isEncrypted
                };
            } catch (e) {
                logError('Erro em getStats', e);
                return null;
            }
        },

        async getAuditLog(limit = 50) {
            try {
                const logs = await idbGetAll('auditLog');
                return logs.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
            } catch (e) {
                return [];
            }
        },

        async flushSync() {
            return await flushIDBSync();
        },

        async clearAllData() {
            try {
                localStorage.removeItem(STORAGE_KEY);
                await idbClear('mainData');
                await idbClear('backups');
                await idbClear('auditLog');
                await idbClear('metadata');
                isEncrypted = false;
                isLocked = false;
                currentKey = null;
                this._memCache = null;
                addAuditLog('clear_all', 'Todos os dados apagados');
                return true;
            } catch (e) {
                logError('Erro no clearAllData', e);
                return false;
            }
        }
    };

    global.AxisDB = AxisDB;

})(window);
