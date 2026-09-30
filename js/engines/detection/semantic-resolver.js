// js/engines/detection/semantic-resolver.js
// Generic semantic property resolution and universal static text heuristics

// ============================================================================
// 1. GENERIC PATTERNS & PIPELINE CONSTANTS
// ============================================================================

// TODO(refactor-followup): GENERIC_PATTERNS precedence and duplicate pattern matching
export const GENERIC_PATTERNS = [
    // ── Dates (EN, DE, FR, ES, IT, PT, NL, NE/HI) ──
    { regex: /(?<![\p{L}])(?:due\s*date|payment\s*due|pay\s*by|f[äa]lligkeitsdatum|date\s*d['’]?[\s]*[ée]ch[ée]ance|fecha\s*de\s*vencimiento|data\s*di\s*scadenza|data\s*de\s*vencimento|vervaldatum)(?![\p{L}])/iu, id: "due_date", type: "dateField", priority: 2 },
    { regex: /(?<![\p{L}])(?:expiration\s*date|exp\s*date|expiry|ablaufdatum|g[üu]ltig\s*bis|date\s*d['’]?expiration|fecha\s*de\s*(?:expiraci[óo]n|caducidad)|data\s*di\s*scadenza|data\s*de\s*validade|verloopdatum)(?![\p{L}])/iu, id: "expiration_date", type: "dateField", priority: 2 },
    { regex: /(?<![\p{L}])(?:date\s*approved|approval\s*date|genehmigungsdatum|date\s*d['’]?approbation|fecha\s*de\s*aprobaci[óo]n|data\s*di\s*approvazione)(?![\p{L}])/iu, id: "date_approved", type: "dateField", priority: 2 },
    { regex: /(?<![\p{L}])(?:birth\s*date|dob|date\s*of\s*birth|geburtsdatum|date\s*de\s*naissance|fecha\s*de\s*nacimiento|data\s*di\s*nascita|data\s*de\s*nascimento|geboortedatum|जन्म\s*मिति)(?![\p{L}])/iu, id: "dob", type: "dateField", priority: 2 },
    { regex: /(?<![\p{L}])(?:date\s*(?:of\s*)?sign(?:ed|ature)?|sign(?:ed|ature)?\s*date|datum\s*der\s*unterschrift|date\s*(?:de\s*)?signature|fecha\s*(?:de\s*)?firma|data\s*(?:di\s*)?firma|data\s*(?:da\s*)?assinatura|हस्ताक्षर\s*मिति|दस्तखत\s*मिति)(?![\p{L}])/iu, id: "date_signed", type: "dateField", priority: 4 },
    { regex: /(?<![\p{L}])(?:date|\(yyyy-mm-dd\)|\(mm\/dd\/yyyy\)|yyyy\s*-\s*mm\s*-\s*dd|\(dd\/mm\/yyyy\)|datum|fecha|data|मिति|मितिः)(?![\p{L}])/iu, id: "date", type: "dateField", priority: 0 },
    
    // ── Signatures (EN, DE, FR, ES, IT, PT, NL, NE/HI) ──
    { regex: /(?<![\p{L}])(?:(?:e[-_]?)?sign(?:ature|ed|ing)?|sign\s*here|signed\s*by|unterschrift|unterschrieben|signatur|signé\s*par|firma|firmado\s*por|firmato\s*da|assinatura|assinado\s*por|handtekening|ondertekend|दस्तखत|हस्ताक्षर|सही\s*छाप)(?![\p{L}])/iu, id: "signature", type: "signature", priority: 2 },

    // ── Financial & Numbers (EN, DE, FR, ES, IT, PT, NL, NE/HI) ──
    { regex: /(?<![\p{L}])(?:invoice\s*(?:#|no|number|num)|rechnungs\s*(?:nr|nummer)|(?:n[°o]|num[eé]ro)\s*de\s*facture|n[úu]mero\s*de\s*factura|fattura\s*n\.?|fatura\s*n[°º]|factuurnummer|बिल\s*नं)(?![\p{L}])/iu, id: "invoice_number", type: "textField", autofill: "invoice_num", priority: 2 },
    { regex: /(?<![\p{L}])(?:po\s*(?:#|no|number|num)|purchase\s*order|contract\s*(?:#|no|number|num)|job\s*(?:#|no|number|num)|project\s*(?:#|no|number|num)|work\s*order|bestellnummer|bon\s*de\s*commande|orden\s*de\s*compra|ordine\s*d['’]?acquisto|ordem\s*de\s*compra|inkoopordernummer)(?![\p{L}])/iu, id: "po_number", type: "textField", priority: 2 },
    { regex: /(?<![\p{L}])(?:contractor\s*lic(?:ense)?|lic(?:ense)?\s*(?:#|no|number|num)|trade\s*lic(?:ense)?)(?![\p{L}])/iu, id: "license_number", type: "textField", priority: 2 },
    { regex: /(?<![\p{L}])(?:subtotal|zwischensumme|sous-total|subtotale|sub-total|subtotaal)(?![\p{L}])/iu, id: "subtotal", type: "textField", priority: 1 },
    { regex: /(?<![\p{L}])(?:retainage|retention\s*(?:amount|rate|fee)?)(?![\p{L}])/iu, id: "retainage", type: "textField", priority: 1 },
    { regex: /(?<![\p{L}])(?:tax|vat|gst|mwst|ust|tva|iva|imposto|btw|कर|भ्याट)(?![\p{L}])/iu, id: "tax", type: "textField", priority: 0 },
    { regex: /(?<![\p{L}])(?:total|balance\s*due|amount\s*due|gesamtbetrag|endbetrag|solde\s*d[uû]|importe\s*total|totale\s*dovuto|valor\s*total|totaalbedrag|कुल\s*जम्मा|जम्मा)(?![\p{L}])/iu, id: "total", type: "textField", priority: 0 },
    { regex: /(?<![\p{L}])(?:unit\s*price|hourly\s*rate|rate\s*(?:\/|\s*per\s*)hour|unit\s*cost|einzelpreis|prix\s*unitaire|precio\s*unitario|prezzo\s*unitario)(?![\p{L}])/iu, id: "unit_price", type: "textField", priority: 2 },
    { regex: /(?<![\p{L}])(?:hours?|hrs?|stunden|heures|horas|ore|uren|घण्टा)(?![\p{L}])/iu, id: "hours", type: "textField", priority: 0 },
    { regex: /(?<![\p{L}])(?:amount|price|rate|cost|fees?|charge|betrag|preis|kosten|geb[üu]hr|montant|prix|co[uû]t|tarif|importe|precio|tarifa|costo|valore|valor|pre[çc]o|prijs|bedrag|रकम|मूल्य|दर)(?![\p{L}])/iu, id: "amount", type: "textField", priority: 0 },
    { regex: /(?<![\p{L}])(?:qty|quantity|units|menge|anzahl|st[üu]ckzahl|quantit[ée]|quantit[àa]|cantidad|unidades|quantidade|aantal|परिमाण|संख्या)(?![\p{L}])/iu, id: "quantity", type: "textField", priority: 0 },
    { regex: /(?<![\p{L}])(?:payment\s*instructions|bank\s*(?:details|info|wire)|wire\s*instructions|zahlungsanweisungen)(?![\p{L}])/iu, id: "payment_instructions", type: "textField", multiline: true, priority: 2 },
    { regex: /(?<![\p{L}])(?:routing|iban|swift|bic|bsb|bankleitzahl|blz|code\s*banque|c[óo]digo\s*bancario|खाता\s*नं)(?![\p{L}])/iu, id: "routing_number", type: "textField", priority: 1 },
    { regex: /(?<![\p{L}])(?:account\s*(?:#|no|number|num)|kontonummer|konto-nr|n[°o]\s*de\s*compte|n[úu]mero\s*de\s*cuenta|numero\s*conto|n[úu]mero\s*da\s*conta|rekeningnummer)(?![\p{L}])/iu, id: "account_number", type: "textField", priority: 1 },
    { regex: /(?<![\p{L}])(?:नागरिकता\s*(?:नं|नंबर|प्रमाण))(?![\p{L}])/iu, id: "citizenship_number", type: "textField", priority: 1 },
    { regex: /(?<![\p{L}])(?:employer\s*identification\s*number(?:\s*\(?ein\)?)?|ein|social\s*security(?:\s*number)?|ssn|tax\s*id(?:\s*number)?|national\s*id|steuernummer|steuer[- ]id|sozialversicherungsnummer|n[°o]\s*s[eé]curit[eé]\s*sociale|siret|siren|nif|cif|dni|nie|codice\s*fiscale|partita\s*iva|cpf|cnpj|rg|bsn|burgerkrachtnummer|प्यान\s*नं|राष्ट्रिय\s*परिचय)(?![\p{L}])/iu, id: "ssn", type: "textField", priority: 3 },

    // ── Contact & Identity (EN, DE, FR, ES, IT, PT, NL, NE/HI) ──
    { regex: /(?<![\p{L}])(?:first\s*name|given\s*name|forename|vorname|pr[eé]nom|primer\s*nombre|nome\s*proprio|primeiro\s*nome|voornaam|पहिलो\s*नाम)(?![\p{L}])/iu, id: "first_name", type: "textField", autofill: "given-name", priority: 2 },
    { regex: /(?<![\p{L}])(?:last\s*name|surname|family\s*name|nachname|familienname|nom\s*de\s*famille|apellidos?|primer\s*apellido|segundo\s*apellido|cognome|sobrenome|achternaam|थर)(?![\p{L}])/iu, id: "last_name", type: "textField", autofill: "family-name", priority: 2 },
    { regex: /(?<![\p{L}])(?:full\s*name|complete\s*name|vollst[äa]ndiger\s*name|nom\s*complet|nombre\s*completo|nome\s*completo|volledige\s*naam|नाम\s*,?\s*थर|पूरा\s*नाम|आवेदकको\s*नाम|निवेदकको\s*नाम|^name\b|^nom\b|^nombre\b|^naam\b|^नाम\b)(?![\p{L}])/iu, id: "full_name", type: "textField", autofill: "name", priority: 1 },
    { regex: /(?<![\p{L}])(?:e-?mail|courriel|correo\s*electr[óo]nico|e-post|इमेल|ईमेल)(?![\p{L}])/iu, id: "email", type: "textField", autofill: "email", priority: 1 },
    { regex: /(?<![\p{L}])(?:phone|telephone|mobile|cell|cell\s*phone|cellular\s*phone|fax|tel|telefon|handy|mobil|t[eé]l[eé]phone|portable|tel[eé]fono|m[oó]vil|cellulare|telefone|celular|telefoon|टेलिफोन|फोन|मोबाइल|सम्पर्क\s*नं)(?![\p{L}])/iu, id: "phone", type: "textField", autofill: "tel", priority: 1 },
    { regex: /(?<![\p{L}])(?:street\s*address|address\s*line|home\s*address|stra[ßs]e(?:\s*und\s*hausnummer)?|adresse|rue|direcci[óo]n|calle|indirizzo|via|endere[çc]o|rua|straat\s*(?:en\s*huisnummer)?|ठेगाना|घर\s*ठेगाना|टोल)(?![\p{L}])/iu, id: "street_address", type: "textField", autofill: "address-line1", priority: 2 },
    { regex: /(?<![\p{L}])(?:city|ort|stadt|ville|ciudad|municipio|citt[àa]|cidade|plaats|stad|नगरपालिका|गाउँपालिका)(?![\p{L}])/iu, id: "city", type: "textField", autofill: "address-level2", priority: 1 },
    { regex: /(?<![\p{L}])(?:state|province|region|bundesland|kanton|r[eé]gion|provincia|estado|provincie|जिल्ला|प्रदेश)(?![\p{L}])/iu, id: "state", type: "textField", autofill: "address-level1", priority: 1 },
    { regex: /(?<![\p{L}])(?:zip|postal\s*code|postcode|plz|postleitzahl|code\s*postal|c[óo]digo\s*postal|cap|cep|वडा\s*नं|पिन\s*कोड)(?![\p{L}])/iu, id: "zip_code", type: "textField", autofill: "postal-code", priority: 2 },
    { regex: /(?<![\p{L}])(?:country|land|pays|pa[íi]s|nazione|paese|देश)(?![\p{L}])/iu, id: "country", type: "textField", autofill: "country-name", priority: 1 },
    { regex: /(?<![\p{L}])(?:company|organization|employer(?!\s*(?:identification|id\b|tax|no\b|number|ein\b))|institution|firma|unternehmen|arbeitgeber|entreprise|soci[eé]t[eé]|employeur|empresa|instituci[óo]n|organiza[çc][ãa]o|bedrijf|werkgever|कार्यालय|कम्पनी|संस्था)(?![\p{L}])/iu, id: "organization", type: "textField", autofill: "organization", priority: 1 },
    { regex: /(?<![\p{L}])(?:title|role|position|designation|profession|occupation|berufsbezeichnung|beruf|funktion|poste|titre|cargo|puesto|profesi[óo]n|ruolo|mansione|profiss[ãa]o|functie|beroep|पद|ओहोदा)(?![\p{L}])/iu, id: "job_title", type: "textField", autofill: "organization-title", priority: 2 },
    { regex: /(?<![\p{L}])(?:department|division|unit|abteilung|bereich|d[eé]partement|service|departamento|secci[óo]n|dipartimento|afdeling|शाखा|विभाग)(?![\p{L}])/iu, id: "department", type: "textField", priority: 1 },
    
    // ── Table Line Items & Description ──
    { regex: /(?<![\p{L}])(?:item\s*description|item\s*details|beschreibung|d[eé]signation|descripci[óo]n|descrizione|descri[çc][ãa]o|omschrijving|विवरण|^description\b)(?![\p{L}])/iu, id: "item_description", type: "textField", priority: 2 },

    // ── Notes & Multiline Freeform ──
    { regex: /(?<![\p{L}])(?:comments|notes|remarks|explanation|justification|feedback|details|bemerkungen|hinweise|anmerkungen|remarques|observations|commentaires|comentarios|observaciones|notas|note|commenti|observa[çc][õo]es|opmerkingen|notities|कैफियत|प्रतिक्रिया)(?![\p{L}])/iu, id: "comments", type: "textField", multiline: true, priority: 0 },

    // ── South Asian Identity Details ──
    { regex: /(?<![\p{L}])(?:परिचय\s*पत्र|राहदानी\s*नं)(?![\p{L}])/iu, id: "id_number", type: "textField", priority: 1 },
    { regex: /(?<![\p{L}])(?:संख्या|नं\.?\s*$|नम्बर)(?![\p{L}])/iu, id: "number", type: "textField", priority: 0 }
];

export const SEMANTIC_DIMENSIONS = {
    signature: { width: 200, height: 40, type: "signature" },
    dateField: { width: 110, height: 22, type: "dateField" },
    zip: { width: 85, height: 22, type: "textField" },
    state: { width: 65, height: 22, type: "textField" },
    phone: { width: 130, height: 22, type: "textField" },
    email: { width: 220, height: 22, type: "textField" },
    ssn: { width: 120, height: 22, type: "textField" },
    currency: { width: 100, height: 22, type: "textField" },
    multiline: { width: 340, height: 60, type: "textField", multiline: true }
};

export function resolveSemanticProps(rawLabel, defaultType = "textField", usedNames = new Set()) {
    const clean = (rawLabel || "").trim().replace(/[:_.\s-]+$/, "");
    let baseId = "";
    let type = defaultType;
    let multiline = false;
    let autofill = "";
    let dataFormat = "text";

    // 0. High-impact compound precedence rules:
    // A. Date beats Signature: Any compound date label containing "date" next to "sign" is a date field
    const hasDateTerm = /(?<![\p{L}])(?:date|datum|fecha|data|मिति)(?![\p{L}])/iu.test(clean);
    const hasSignTerm = /(?<![\p{L}])(?:sign(?:ature|ed)?|unterschrift|firma|assinatura|दस्तखत|हस्ताक्षर)(?![\p{L}])/iu.test(clean);
    const isDateSigned = hasDateTerm && hasSignTerm;

    // B. EIN beats Organization: "Employer Identification Number (EIN)" or "(EIN)" or bare "EIN" resolves to ssn
    const isEin = /(?<![\p{L}])(?:employer\s*identification\s*number(?:\s*\(?ein\)?)?|\(?ein\)?)(?![\p{L}])/iu.test(clean);

    let bestMatch = null;
    let bestScore = -1;

    for (const item of GENERIC_PATTERNS) {
        // Disqualify bare signature if label also asks for date
        if (isDateSigned && item.type === "signature") {
            continue;
        }
        // Disqualify organization if EIN is specified
        if (isEin && item.id === "organization") {
            continue;
        }

        const m = clean.match(item.regex);
        if (m) {
            const matchedTextLen = m[0].length;
            const priority = item.priority !== undefined ? item.priority : 1;
            // Specificity priority outranks raw character length
            const score = (priority * 100) + matchedTextLen;
            if (score > bestScore) {
                bestScore = score;
                bestMatch = item;
            }
        }
    }

    if (isDateSigned && (!bestMatch || bestMatch.type !== "dateField")) {
        bestMatch = { id: "date_signed", type: "dateField", priority: 4 };
    } else if (isEin && (!bestMatch || bestMatch.id !== "ssn")) {
        bestMatch = { id: "ssn", type: "textField", priority: 3 };
    }

    if (bestMatch) {
        baseId = bestMatch.id;
        if (bestMatch.type) type = bestMatch.type;
        if (bestMatch.multiline) multiline = true;
        if (bestMatch.autofill) autofill = bestMatch.autofill;
    }

    // Determine semantic data format
    if (type === "dateField" || /date|dob/i.test(baseId || clean)) {
        dataFormat = "date";
    } else if (/amount|price|subtotal|tax|total|cost|fee|rate/i.test(baseId || clean)) {
        dataFormat = "currency";
    } else if (/qty|quantity|units|hours|miles|number|num|#|ssn|zip|postal/i.test(baseId || clean)) {
        dataFormat = "number";
    } else if (/email/i.test(baseId || clean)) {
        dataFormat = "email";
    } else if (/phone|tel|mobile|cell|fax/i.test(baseId || clean)) {
        dataFormat = "phone";
    }

    if (!baseId) {
        // TODO(refactor-followup): Unicode combining mark (\p{M}) support in slugify for non-Latin scripts
        const slugify = (s) => {
            const words = s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).slice(0, 3);
            return words.length > 0 && words[0].length > 0 ? words.join("_") : "";
        };
        if (type === "signature") {
            baseId = "signature";
        } else if (type === "checkBox") {
            baseId = slugify(clean) || "checkbox";
        } else if (type === "radioGroup") {
            baseId = slugify(clean) || "option";
        } else if (type === "dateField") {
            baseId = "date";
        } else {
            baseId = slugify(clean) || "field";
        }
    }

    let finalId = baseId;
    let counter = 1;
    while (usedNames.has(finalId)) {
        counter++;
        finalId = `${baseId}_${counter}`;
    }
    usedNames.add(finalId);

    return { name: finalId, type, multiline, autofill, dataFormat };
}

/**
 * Computes dynamic confidence score for a detected field based on composite evidence signals:
 * - Geometric edge certainty (vector box/table/underline vs text guess)
 * - Matched label presence and semantic dictionary affinity
 * - Geometric alignment with sibling fields on the page
 * - Multi-stage agreement count
 * 
 * @param {Object} field 
 * @param {Array} [siblingFields=[]] 
 * @param {number} [stageAgreementCount=1] 
 * @returns {number} Float between 0.40 and 1.0 (clamped, 2 decimal places)
 */
export function computeFieldConfidence(field, siblingFields = [], stageAgreementCount = 1) {
    if (!field) return 0.5;
    if (field.sourcedFrom === "acroform" || field.detectedBy === "acroform") {
        return 1.0;
    }

    const detectedBy = field.detectedBy || "unknown";

    // Base confidence by stage type
    let base = 0.65;
    if (["lattice_tables", "table_grid"].includes(detectedBy)) {
        base = 0.82;
    } else if (["vector_geometry", "vector_fields"].includes(detectedBy)) {
        base = 0.78;
    } else if (detectedBy === "underline_fields") {
        base = 0.74;
    } else if (["onnx_neural", "layoutlmv3_sidecar"].includes(detectedBy)) {
        base = 0.68;
    } else if (["visual_affordances", "colon_prompts", "checkbox_glyphs"].includes(detectedBy)) {
        base = 0.60;
    }

    // Signal 1: Clean geometric edge
    const hasGeometricEdge = field.hasVectorEdge ||
        ["vector_geometry", "vector_fields", "lattice_tables", "table_grid", "underline_fields"].includes(detectedBy) ||
        (field.borderWidth && field.borderWidth > 0);
    if (hasGeometricEdge) base += 0.10;

    // Signal 2: Matched label
    const label = (field.label || field.tooltip || "").trim();
    const hasLabel = label.length > 1 && !/^(?:field|input|box|text)_\d+$/i.test(label);
    if (hasLabel) base += 0.06;

    // Signal 3: Semantic dictionary match
    const hasSemanticMatch = (field.dataFormat && field.dataFormat !== "text") ||
        (field.name && !/^(?:field|input|box|text)_\d+$/i.test(field.name) && field.name !== field.label);
    if (hasSemanticMatch) base += 0.06;

    // Signal 4: Alignment with sibling fields on page (X col or Y row)
    const hasAlignment = Array.isArray(siblingFields) && siblingFields.some(s => {
        if (!s || s === field || s.id === field.id) return false;
        return Math.abs((s.x || 0) - (field.x || 0)) <= 2 || Math.abs((s.y || 0) - (field.y || 0)) <= 2;
    });
    if (hasAlignment) base += 0.06;

    // Signal 5: Multi-stage agreement
    const agreements = Math.max(1, stageAgreementCount || (field.stagesAgreed ? field.stagesAgreed.length : 1));
    if (agreements > 1) {
        base += (agreements - 1) * 0.08;
    }

    // Clamp score
    const clamped = Math.max(0.40, Math.min(0.99, base));
    return Math.round(clamped * 100) / 100;
}

// ============================================================================
// 2. UNIVERSAL STATIC TEXT & BANNER HEURISTICS (Zero Hardcoded Names)
// ============================================================================
export function isUniversalStaticText(text) {
    if (!text) return true;
    const clean = text.trim();
    if (clean.length < 2) return true;

    // 0. Decorative rule lines / separator symbols (e.g. "------", "======", "******", "━━━━━")
    if (/^[_\-=\*#•·—–─━│┃┌┐└┘├┤┬┴┼░▒▓█\s]+$/.test(clean) && clean.length >= 3) {
        return true;
    }

    // 0.5 Long questions & inquiry sentences (>2 words or >15 chars) are static text, never form fields or field labels.
    // Short 1-2 word column headers (e.g. "Sick?", "Active?", "Yes?", "No?") are valid checkbox/column prompts.
    if (clean.includes("?") && (clean.split(/\s+/).length > 2 || clean.length > 15)) {
        return true;
    }

    const cleanNoColon = clean.replace(/[:ः]$/, "").trim();

    // 1. Form metadata, catalog numbers, OMB numbers, revisions, disclaimers
    if (/^(?:omb\s*no|cat(?:alog)?\.?\s*no|form\s*\d+|rev(?:ision)?\.?|irs\s*use|official\s*use|page\s*\d+|paperwork\s+reduction|privacy\s+act|see\s+instructions?|copyright|all\s+rights\s+reserved|department\s+of|internal\s+revenue|keep\s+for\s+your\s+records|for\s+(?:your\s+)?records|records?|record|voucher|receipt|tear\s+here|cut\s+here|detach\s+here|fold\s+here|do\s+not\s+detach)\b/i.test(cleanNoColon)) {
        return true;
    }

    // 2. Numbered or named section headings, banners & instructional callouts (e.g. "Section 1: General Info", "Part A: Details", "Note:", "Caution:", "Instructions:")
    if (/^(?:section|abschnitt|teil|kapitel|partie|chapitre|secci[óo]n|sezione|parte|deel|hoofdstuk|part|step|item|schedule|table|note|notice|instruction|instructions|disclaimer|summary|caution|warning|tip|important|remember|example|refer|attach|send\s+to|mail\s+to|go\s+to|website|url|http|www|for\s+details|see\s+page|direction|directions|guideline|guidelines|purpose|definition|definitions|future|general|specific|privacy|paperwork|official|requirements|overview|background|penalty|penalties|deadline)\b/i.test(cleanNoColon)) {
        // Exception: Itemized table column/prompt labels such as "Item Description", "Item 1 Description", "Item Name", "Item No."
        if (/^item\s*(?:\d+)?\s*(?:description|name|details|number|no\.?|code|price|amount|qty|quantity|rate|unit)\b/i.test(cleanNoColon)) {
            return false;
        }
        return true;
    }
    if (/^\d+[.)]\s+[\p{L}\s&()/ -]+$/iu.test(cleanNoColon) && cleanNoColon.split(/\s+/).length <= 6) {
        return true;
    }

    // 2.5 Sentences starting with question auxiliary verbs or wh-question words
    if (/^(?:are|is|was|were|do|does|did|have|has|had|can|could|will|would|should|may|might|must|shall|what|where|when|which|why|how|who|whom|whose)\b/i.test(cleanNoColon)) {
        return true;
    }

    // 2.6 Numbered questions or instructions (e.g. "1. Are you sick today?", "10. In the past year...")
    if (/^\s*\d+[\s.)-]+\s*(?:are|is|was|were|do|does|did|have|has|had|can|could|will|would|should|what|where|when|which|why|how|if|in|for|during|has|please)\b/i.test(cleanNoColon)) {
        return true;
    }

    // 2.7 Instructional conditional clauses and contact modes
    if (/^(?:if\s+you|please\s+(?:enter|print|check|indicate|select|provide|consult|refer)|for\s+(?:patients|official|healthcare|office)|in\s+the\s+past|in\s+person|en\s+español|by\s+mail|by\s+phone|online|telephone|toll-free)\b/i.test(cleanNoColon)) {
        return true;
    }

    // 2.75 Instructional list headers, directions, and report sections (e.g. "include the following", "case if it", "select one column", "check only one", "choose one", "report:", "submit to:")
    if (/\b(?:include\s+the\s+following|includes?|including|as\s+follows|such\s+as|case\s+if|select\s+one|check\s+only\s+one|choose\s+one|report|reporting|reports|submit|submitting|provide|providing)\b/i.test(cleanNoColon)) {
        return true;
    }

    // 2.8 Long sentences, paragraphs, or legal disclaimer text (high word count)
    if (clean.length > 50 || clean.split(/\s+/).length > 8 || (clean.endsWith(".") && clean.split(/\s+/).length > 4)) {
        return true;
    }

    // 3. Pure instruction in parentheses (e.g. "(Please print clearly)", "(Check all that apply)")
    if (/^\([^)]+\)$/.test(clean)) {
        return true;
    }

    // 4. Pure single numbers or list indices (e.g. "1", "2", "3")
    if (/^\d+$/.test(clean)) {
        return true;
    }

    // 5. Standalone currency symbols
    if (/^[\$\€\£\¥]$/.test(clean)) {
        return true;
    }

    return false;
}
