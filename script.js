document.addEventListener('DOMContentLoaded', () => {
    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    // DOM refs
    const symptomInput = $('#symptomInput');
    const analyzeBtn = $('#analyzeBtn');
    const clearInputBtn = $('#clearInputBtn');
    const voiceBtn = $('#voiceBtn');
    const voiceStatus = $('#voiceStatus');
    const themeToggle = $('#themeToggle');
    const historyBtn = $('#historyBtn');
    const historyModal = $('#historyModal');
    const closeHistory = $('#closeHistory');
    const historyList = $('#historyList');
    const historyEmpty = $('#historyEmpty');
    const clearHistoryBtn = $('#clearHistoryBtn');
    const apiKeyModal = $('#apiKeyModal');
    const apiKeyInput = $('#apiKeyInput');
    const saveApiKeyBtn = $('#saveApiKey');
    const closeApiModal = $('#closeApiModal');
    const emergencyBanner = $('#emergencyBanner');
    const welcomeState = $('#welcomeState');
    const loadingState = $('#loadingState');
    const resultsState = $('#resultsState');
    const trendCard = $('#trendCard');
    const trendText = $('#trendText');
    const findHelpBtn = $('#findHelpBtn');
    const progressFill = $('#progressFill');
    const loadingStep = $('#loadingStep');

    if (!symptomInput || !analyzeBtn) return;

    // ── Theme ──
    function setTheme(t) {
        document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem('symptosense-theme', t);
    }
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-theme');
            setTheme(cur === 'dark' ? 'light' : 'dark');
        });
    }
    setTheme(localStorage.getItem('symptosense-theme') || 'light');

    // ── Voice Input ──
    let recognition = null, isRec = false;
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SR();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.onresult = e => {
            let t = '';
            for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
            symptomInput.value = t;
            if (voiceStatus) voiceStatus.textContent = 'Listening...';
        };
        recognition.onend = () => {
            isRec = false;
            if (voiceBtn) voiceBtn.classList.remove('recording');
            if (voiceStatus) {
                voiceStatus.textContent = symptomInput.value ? 'Captured' : '';
                setTimeout(() => voiceStatus.textContent = '', 2000);
            }
        };
        recognition.onerror = () => {
            isRec = false;
            if (voiceBtn) voiceBtn.classList.remove('recording');
            if (voiceStatus) {
                voiceStatus.textContent = 'Error listening';
                setTimeout(() => voiceStatus.textContent = '', 3000);
            }
        };
    }
    if (voiceBtn) {
        voiceBtn.addEventListener('click', () => {
            if (!recognition) { if (voiceStatus) voiceStatus.textContent = 'Not supported'; return; }
            if (isRec) { recognition.stop(); } else {
                isRec = true;
                voiceBtn.classList.add('recording');
                if (voiceStatus) voiceStatus.textContent = 'Listening...';
                recognition.start();
            }
        });
    }

    // ── Chips ──
    $$('.chip').forEach(c => {
        c.addEventListener('click', () => {
            const s = c.dataset.symptom;
            let v = symptomInput.value || '';
            if (v.toLowerCase().includes(s.toLowerCase())) {
                c.classList.remove('active');
                let parts = v.split(/,\s*/);
                parts = parts.filter(p => p.toLowerCase() !== s.toLowerCase());
                symptomInput.value = parts.join(', ');
            } else {
                c.classList.add('active');
                symptomInput.value = v ? v + ', ' + s : s;
            }
            symptomInput.focus();
        });
    });

    // ── Clear Input ──
    if (clearInputBtn) {
        clearInputBtn.addEventListener('click', () => {
            symptomInput.value = '';
            $$('.chip').forEach(c => c.classList.remove('active'));
            if (emergencyBanner) emergencyBanner.classList.remove('active');
            symptomInput.focus();
        });
    }

    // ── Find Help ──
    if (findHelpBtn) {
        findHelpBtn.addEventListener('click', () => {
            window.open('https://www.google.com/maps/search/hospitals+near+me', '_blank');
        });
    }

    // ── API Key ──
    function getApiKey() { return localStorage.getItem('symptosense-gemini-key') || ''; }
    if (saveApiKeyBtn) {
        saveApiKeyBtn.addEventListener('click', () => {
            const k = apiKeyInput.value.trim();
            if (k) {
                localStorage.setItem('symptosense-gemini-key', k);
                if (apiKeyModal) apiKeyModal.classList.remove('active');
                if (symptomInput.value.trim()) runAnalysis(symptomInput.value.trim());
            }
        });
    }
    if (closeApiModal) closeApiModal.addEventListener('click', () => apiKeyModal.classList.remove('active'));
    if (apiKeyModal) apiKeyModal.addEventListener('click', e => { if (e.target === apiKeyModal) apiKeyModal.classList.remove('active'); });

    // ── Red Flags (SMARTER matching) ──
    const RED_FLAGS = [
        'chest pain', 'breath', 'breathing', 'shortness',
        'unconscious', 'bleeding', 'heart', 'stroke',
        'seizure', 'choking', 'collapse', 'faint'
    ];
    function checkRedFlags(s) {
        const text = s.toLowerCase();
        return RED_FLAGS.some(flag => text.includes(flag));
    }

    // ── Analyze Button ──
    analyzeBtn.addEventListener('click', () => {
        const s = symptomInput.value.trim();
        if (!s) {
            symptomInput.style.borderColor = 'var(--red)';
            setTimeout(() => symptomInput.style.borderColor = '', 1500);
            return;
        }

        // 🔴 Check emergency FIRST — before anything else
        if (checkRedFlags(s) && emergencyBanner) {
            emergencyBanner.classList.add('active');
        } else if (emergencyBanner) {
            emergencyBanner.classList.remove('active');
        }

        if (!getApiKey()) {
            if (apiKeyModal) apiKeyModal.classList.add('active');
            if (apiKeyInput) apiKeyInput.focus();
            return;
        }
        runAnalysis(s);
    });

    symptomInput.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') analyzeBtn.click();
    });

    // ── Loading: Progress Bar + Steps ──
    let ltimers = [];
    let progressInterval = null;

    function resetSteps() {
        ltimers.forEach(t => clearTimeout(t));
        ltimers = [];
        if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
        ['ls1', 'ls2', 'ls3'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('done', 'active');
        });
        if (progressFill) progressFill.style.width = '0%';
        if (loadingStep) loadingStep.textContent = 'Starting analysis…';
    }

    function showLoading() {
        resetSteps();
        if (loadingState) loadingState.classList.add('active');

        const steps = ['Analyzing symptoms…', 'Evaluating severity…', 'Generating care plan…'];
        let progress = 0;
        let stepIndex = 0;

        // Animate steps
        const s1 = document.getElementById('ls1');
        const s2 = document.getElementById('ls2');
        const s3 = document.getElementById('ls3');
        if (s1) s1.classList.add('active');

        ltimers.push(setTimeout(() => {
            if (s1) { s1.classList.remove('active'); s1.classList.add('done'); }
            if (s2) s2.classList.add('active');
        }, 1500));

        ltimers.push(setTimeout(() => {
            if (s2) { s2.classList.remove('active'); s2.classList.add('done'); }
            if (s3) s3.classList.add('active');
        }, 3000));

        // Animate progress bar
        progressInterval = setInterval(() => {
            progress += 10;
            if (progressFill) progressFill.style.width = Math.min(progress, 90) + '%';
            if (stepIndex < steps.length && loadingStep) {
                loadingStep.textContent = steps[stepIndex];
                stepIndex++;
            }
            if (progress >= 90) {
                clearInterval(progressInterval);
                progressInterval = null;
            }
        }, 800);
    }

    function hideLoading() {
        // Complete progress to 100%
        ltimers.forEach(t => clearTimeout(t));
        ltimers = [];
        if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }

        ['ls1', 'ls2', 'ls3'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.classList.remove('active'); el.classList.add('done'); }
        });
        if (progressFill) progressFill.style.width = '100%';
        if (loadingStep) loadingStep.textContent = 'Complete!';

        // Delay before hiding for UX
        setTimeout(() => {
            if (loadingState) loadingState.classList.remove('active');
        }, 500);
    }

    // ── View Switching ──
    function showView(v) {
        if (welcomeState) welcomeState.style.display = v === 'welcome' ? 'flex' : 'none';
        // Loading is now an overlay, managed separately
        if (resultsState) resultsState.style.display = v === 'results' ? 'flex' : 'none';
    }

    // ── Typing Effect ──
    function typeEffect(text, element, speed = 12) {
        return new Promise(resolve => {
            element.innerHTML = '';
            let i = 0;
            const cursor = document.createElement('span');
            cursor.className = 'typing-cursor';
            element.appendChild(cursor);

            function type() {
                if (i < text.length) {
                    element.insertBefore(document.createTextNode(text.charAt(i)), cursor);
                    i++;
                    setTimeout(type, speed);
                } else {
                    cursor.remove();
                    resolve();
                }
            }
            type();
        });
    }

    // ── Run Analysis ──
    let currentResults = null, currentSymptoms = '';

    async function runAnalysis(symptoms) {
        // 🔴 STEP 1: Check emergency FIRST — before anything else
        const isEmergency = checkRedFlags(symptoms);
        if (isEmergency && emergencyBanner) {
            emergencyBanner.classList.add('active');
        }

        // ⏳ STEP 2: Show loading overlay
        showLoading();

        try {
            const result = await callGeminiAPI(symptoms);

            // Force severity to Urgent if red flags detected
            if (isEmergency && result.severity !== 'Urgent') {
                result.severity = 'Urgent';
                result.severityDescription = 'These symptoms indicate a potentially serious condition requiring immediate medical evaluation.';
            }

            hideLoading();
            await new Promise(r => setTimeout(r, 600));

            currentSymptoms = symptoms;
            currentResults = result;
            await displayResults(symptoms, result);
            saveToHistory(symptoms, result);
            showView('results');
            showTrend();
        } catch (err) {
            console.error('API Error:', err);
            if (err.message.includes('API_KEY')) {
                if (loadingState) loadingState.classList.remove('active');
                if (apiKeyModal) apiKeyModal.classList.add('active');
                showView('welcome');
                return;
            }

            hideLoading();
            await new Promise(r => setTimeout(r, 600));

            const fb = getFallback(symptoms);
            currentSymptoms = symptoms;
            currentResults = fb;
            await displayResults(symptoms, fb);
            saveToHistory(symptoms, fb);
            showView('results');
            showTrend();
        }
    }

    // ── Gemini API ──
    async function callGeminiAPI(symptoms) {
        const key = getApiKey();
        if (!key) throw new Error('API_KEY_MISSING');

        const prompt = `Act like a professional medical assistant. Based on the symptoms given, provide:
1. Severity level (Mild / Moderate / Urgent)
2. Possible causes (max 3)
3. Recommended actions
4. Suggested care plan (general guidance only, no strict prescriptions)

Keep answers short, safe, and easy to understand. Return ONLY valid JSON:
{"severity":"Mild or Moderate or Urgent","severityDescription":"Brief 1-sentence explanation","causes":["cause1","cause2","cause3"],"recommendations":["action1","action2","action3"],"carePlan":["step1","step2","step3"]}

For carePlan: OTC guidance, lifestyle advice, monitoring tips only. No dosage instructions.
Symptoms: ${symptoms}`;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 600, responseMimeType: "application/json" }
            })
        });

        if (!res.ok) {
            if (res.status === 400 || res.status === 403) throw new Error('API_KEY_INVALID');
            throw new Error('API failed: ' + res.status);
        }

        const data = await res.json();
        const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!txt) throw new Error('Empty response');

        try { return JSON.parse(txt); }
        catch { const m = txt.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('Bad JSON'); }
    }

    // ── Fallback ──
    function getFallback(symptoms) {
        const s = symptoms.toLowerCase();
        const isUrg = checkRedFlags(s);
        const isMod = ['fever', 'vomiting', 'persistent', 'swelling', 'infection', 'pain', 'dizziness'].some(k => s.includes(k));

        if (isUrg) return {
            severity: 'Urgent',
            severityDescription: 'These symptoms indicate a potentially serious condition requiring immediate medical evaluation.',
            causes: ['Acute medical event', 'Severe respiratory distress', 'Potential cardiovascular issue'],
            recommendations: ['Seek emergency care immediately', 'Call emergency services', 'Do not drive yourself'],
            carePlan: ['Call emergency services immediately', 'Avoid taking unsupervised medication', 'Keep calm and wait for professional help']
        };

        if (isMod) return {
            severity: 'Moderate',
            severityDescription: 'These symptoms warrant monitoring and potential medical consultation.',
            causes: ['Viral or bacterial infection', 'Inflammatory condition', 'Stress-related response'],
            recommendations: ['Schedule a doctor appointment', 'Monitor temperature', 'Rest and stay hydrated'],
            carePlan: ['Take OTC fever reducers if appropriate', 'Drink adequate fluids', 'Seek care if symptoms worsen']
        };

        return {
            severity: 'Mild',
            severityDescription: 'These symptoms are typically self-limiting and resolve with supportive care.',
            causes: ['Common viral illness', 'Minor allergic reaction', 'Fatigue or stress'],
            recommendations: ['Rest adequately', 'Stay hydrated', 'Monitor for changes'],
            carePlan: ['Ensure 7-9 hours of sleep', 'Maintain fluid intake', 'Consult a doctor if symptoms persist beyond 5-7 days']
        };
    }

    // ── Display Results (with typing effect) ──
    async function displayResults(symptoms, result) {
        const tags = symptoms.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
        const rt = $('#resultsTags');
        if (rt) rt.innerHTML = tags.map(t => `<span class="tag">${t}</span>`).join('');

        const level = (result.severity || 'Mild').toLowerCase();
        const sc = $('#severityCard');
        if (sc) sc.className = `card severity-card ${level}`;

        const sb = $('#sevBadge');
        if (sb) sb.textContent = (result.severity || 'Mild').toUpperCase();

        // Typing effect on severity description
        const sd = $('#sevDesc');
        if (sd) await typeEffect(result.severityDescription || '', sd, 10);

        const sbf = $('#sevBarFill');
        if (sbf) {
            sbf.style.width = { mild: '33%', moderate: '66%', urgent: '100%' }[level] || '33%';
            sbf.style.background = { mild: 'var(--green)', moderate: 'var(--amber)', urgent: 'var(--red)' }[level] || 'var(--green)';
        }

        const cl = $('#causesList'), rl = $('#recsList'), cl2 = $('#careList');
        if (cl) cl.innerHTML = (result.causes || []).map(c => `<li>${c}</li>`).join('');
        if (rl) rl.innerHTML = (result.recommendations || []).map(r => `<li>${r}</li>`).join('');
        if (cl2) cl2.innerHTML = (result.carePlan || []).map(c => `<li>${c}</li>`).join('');

        // Add fade-in animation
        if (resultsState) {
            resultsState.style.animation = 'none';
            resultsState.offsetHeight; // trigger reflow
            resultsState.style.animation = '';
        }
    }

    // ── Trend ──
    function showTrend() {
        if (!trendCard || !trendText) return;
        const h = getHistory();
        if (h.length >= 3) {
            const syms = h.flatMap(e => e.symptoms.toLowerCase().split(/[,;]+/).map(s => s.trim())).filter(Boolean);
            const freq = {};
            syms.forEach(s => freq[s] = (freq[s] || 0) + 1);
            const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
            let msg = `${h.length} analyses on record.`;
            if (top && top[1] >= 2) msg += ` Frequently reported: "${top[0]}"`;
            trendText.textContent = msg;
            trendCard.style.display = 'flex';
        } else { trendCard.style.display = 'none'; }
    }

    // ── Navigation ──
    const nab = $('#newAnalysisBtn');
    if (nab) nab.addEventListener('click', () => {
        symptomInput.value = '';
        $$('.chip').forEach(c => c.classList.remove('active'));
        if (emergencyBanner) emergencyBanner.classList.remove('active');
        showView('welcome');
    });

    const logo = $('#logo');
    if (logo) logo.addEventListener('click', () => {
        if (emergencyBanner) emergencyBanner.classList.remove('active');
        showView('welcome');
    });

    // ── Download Report ──
    const db = $('#downloadBtn');
    if (db) {
        db.addEventListener('click', () => {
            if (!currentResults) return;
            const level = currentResults.severity || 'Mild';
            const d = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
            const c = { Mild: '#16A34A', Moderate: '#F59E0B', Urgent: '#DC2626' }[level] || '#16A34A';

            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SymptoSense Report</title><style>body{font-family:'Inter',-apple-system,sans-serif;color:#111827;line-height:1.7;max-width:700px;margin:40px auto;padding:20px}h1{font-size:22px;color:#111827;border-bottom:2px solid #E5E7EB;padding-bottom:12px;margin-bottom:6px}.meta{color:#6B7280;font-size:13px;margin-bottom:28px}.box{border:1px solid #E5E7EB;padding:20px;border-radius:8px;margin-bottom:16px}.sev{border-left:4px solid ${c}}.sev-badge{display:inline-block;padding:4px 14px;background:${c}12;color:${c};border-radius:20px;font-weight:700;font-size:12px;margin-bottom:8px;letter-spacing:0.04em}h3{font-size:14px;font-weight:600;margin-bottom:10px}ul{margin:0;padding-left:20px}li{margin-bottom:4px;font-size:14px;color:#374151}.dis{font-size:11px;color:#9CA3AF;margin-top:32px;text-align:center;border-top:1px solid #E5E7EB;padding-top:16px}</style></head><body><h1>SymptoSense Report</h1><div class="meta">${d}</div><div class="box"><h3>Symptoms Reported</h3><p>${currentSymptoms}</p></div><div class="box sev"><div class="sev-badge">${level.toUpperCase()}</div><p style="font-size:14px;color:#6B7280">${currentResults.severityDescription || ''}</p></div><div class="box"><h3>Possible Causes</h3><ul>${(currentResults.causes || []).map(x => '<li>' + x + '</li>').join('')}</ul></div><div class="box"><h3>Recommended Actions</h3><ul>${(currentResults.recommendations || []).map(x => '<li>' + x + '</li>').join('')}</ul></div><div class="box"><h3>Suggested Care Plan</h3><ul>${(currentResults.carePlan || []).map(x => '<li>' + x + '</li>').join('')}</ul></div><div class="dis">Disclaimer: This is not a medical diagnosis. Always consult a qualified healthcare professional.</div></body></html>`;

            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `SymptoSense_Report_${Date.now()}.html`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    // ── History ──
    function getHistory() {
        try { return JSON.parse(localStorage.getItem('symptosense-history') || '[]'); }
        catch { return []; }
    }

    function saveToHistory(symptoms, result) {
        const h = getHistory();
        h.unshift({ id: Date.now(), symptoms, result, date: new Date().toISOString() });
        if (h.length > 20) h.length = 20;
        localStorage.setItem('symptosense-history', JSON.stringify(h));
    }

    function renderHistory() {
        const h = getHistory();
        if (historyList) historyList.querySelectorAll('.history-item').forEach(el => el.remove());
        if (!h.length) {
            if (historyEmpty) historyEmpty.style.display = 'block';
            if (clearHistoryBtn) clearHistoryBtn.style.display = 'none';
            return;
        }
        if (historyEmpty) historyEmpty.style.display = 'none';
        if (clearHistoryBtn) clearHistoryBtn.style.display = 'inline-flex';

        h.forEach(e => {
            const item = document.createElement('div');
            item.className = 'history-item';
            const lv = (e.result.severity || 'mild').toLowerCase();
            const dt = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            item.innerHTML = `<div class="hi-top"><span class="hi-symptoms">${e.symptoms}</span><span class="hi-date">${dt}</span></div><span class="hi-badge ${lv}">${e.result.severity}</span>`;
            item.addEventListener('click', () => {
                currentSymptoms = e.symptoms;
                currentResults = e.result;
                displayResults(e.symptoms, e.result);
                showView('results');
                if (historyModal) historyModal.classList.remove('active');
            });
            if (historyList && clearHistoryBtn) historyList.insertBefore(item, clearHistoryBtn);
        });
    }

    if (historyBtn) historyBtn.addEventListener('click', () => { renderHistory(); if (historyModal) historyModal.classList.add('active'); });
    if (closeHistory) closeHistory.addEventListener('click', () => { if (historyModal) historyModal.classList.remove('active'); });
    if (historyModal) historyModal.addEventListener('click', e => { if (e.target === historyModal) historyModal.classList.remove('active'); });
    if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', () => { localStorage.removeItem('symptosense-history'); renderHistory(); });
});
