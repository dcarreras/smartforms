// js/engines/detection/semantic-resolver.js
// Generic semantic property resolution and universal static text heuristics

// ============================================================================
// 1. GENERIC PATTERNS & PIPELINE CONSTANTS
// ============================================================================

// TODO(refactor-followup): GENERIC_PATTERNS precedence and duplicate pattern matching
export const GENERIC_PATTERNS = [
    // ── Dates (EN, DE, FR, ES, IT, PT, NL, NE/HI) ──
    { regex: /due\s*date|payment\s*due|pay\s*by|f[äa]lligkeitsdatum|date\s*d['’]?[\s]*[ée]ch[ée]ance|fecha\s*de\s*vencimiento|data\s*di\s*scadenza|data\s*de\s*vencimento|vervaldatum/i, id: "due_date", type: "dateField", priority: 2 },
    { regex: /expiration\s*date|exp\s*date|expiry|ablaufdatum|g[üu]ltig\s*bis|date\s*d['’]?expiration|fecha\s*de\s*(?:expiraci[óo]n|caducidad)|data\s*di\s*scadenza|data\s*de\s*validade|verloopdatum/i, id: "expiration_date", type: "dateField", priority: 2 },
    { regex: /date\s*approved|approval\s*date|genehmigungsdatum|date\s*d['’]?approbation|fecha\s*de\s*aprobaci[óo]n|data\s*di\s*approvazione/i, id: "date_approved", type: "dateField", priority: 2 },
    { regex: /birth\s*date|\bdob\b|date\s*of\s*birth|geburtsdatum|date\s*de\s*naissance|fecha\s*de\s*nacimiento|data\s*di\s*nascita|data\s*de\s*nascimento|geboortedatum|जन्म\s*मिति/i, id: "dob", type: "dateField", priority: 2 },
    { regex: /\bdate\b|\(yyyy-mm-dd\)|\(mm\/dd\/yyyy\)|yyyy\s*-\s*mm\s*-\s*dd|\(dd\/mm\/yyyy\)|datum\b|fecha\b|data\b|मिति|मितिः/i, id: "date", type: "dateField", priority: 0 },
    
    // ── Signatures (EN, DE, FR, ES, IT, PT, NL, NE/HI) ──
    { regex: /\b(?:e[-_]?)?sign(?:ature|ed|ing)?\b|sign\s*here|signed\s*by|unterschrift|unterschrieben|signatur|signé\s*par|firma\b|firmado\s*por|firmato\s*da|assinatura|assinado\s*por|handtekening|ondertekend|दस्तखत|हस्ताक्षर|सही\s*छाप/i, id: "signature", type: "signature", priority: 2 },

    // ── Financial & Numbers (EN, DE, FR, ES, IT, PT, NL, NE/HI) ──
    { regex: /invoice\s*(?:#|no|number|num)|rechnungs\s*(?:nr|nummer)|(?:n[°o]|num[eé]ro)\s*de\s*facture|n[úu]mero\s*de\s*factura|fattura\s*n\.?|fatura\s*n[°º]|factuurnummer|बिल\s*नं/i, id: "invoice_number", type: "textField", autofill: "invoice_num", priority: 2 },
    { regex: /po\s*(?:#|no|number|num)|purchase\s*order|contract\s*(?:#|no|number|num)|job\s*(?:#|no|number|num)|project\s*(?:#|no|number|num)|work\s*order|bestellnummer|bon\s*de\s*commande|orden\s*de\s*compra|ordine\s*d['’]?acquisto|ordem\s*de\s*compra|inkoopordernummer/i, id: "po_number", type: "textField", priority: 2 },
    { regex: /contractor\s*lic(?:ense)?|lic(?:ense)?\s*(?:#|no|number|num)|trade\s*lic(?:ense)?/i, id: "license_number", type: "textField", priority: 2 },
    { regex: /subtotal|zwischensumme|sous-total|subtotale|sub-total|subtotaal/i, id: "subtotal", type: "textField", priority: 1 },
    { regex: /retainage|retention\s*(?:amount|rate|fee)?/i, id: "retainage", type: "textField", priority: 1 },
    { regex: /\b(?:tax|vat|gst|mwst|ust|tva|iva|imposto|btw)\b|कर|भ्याट/i, id: "tax", type: "textField", priority: 0 },
    { regex: /total|balance\s*due|amount\s*due|gesamtbetrag|endbetrag|solde\s*d[uû]|importe\s*total|totale\s*dovuto|valor\s*total|totaalbedrag|कुल\s*जम्मा|जम्मा/i, id: "total", type: "textField", priority: 0 },
    { regex: /unit\s*price|hourly\s*rate|rate\s*(?:\/|\s*per\s*)hour|unit\s*cost|einzelpreis|prix\s*unitaire|precio\s*unitario|prezzo\s*unitario/i, id: "unit_price", type: "textField", priority: 2 },
    { regex: /\b(?:hours?|hrs?|stunden|heures|horas|ore|uren|घण्टा)\b/i, id: "hours", type: "textField", priority: 0 },
    { regex: /amount|price|rate|cost|\bfees?\b|charge|betrag|preis|kosten|geb[üu]hr|montant|prix|co[uû]t|tarif|importe|precio|tarifa|costo|valore|valor|pre[çc]o|prijs|bedrag|kosten|रकम|मूल्य|दर/i, id: "amount", type: "textField", priority: 0 },
    { regex: /\bqty\b|quantity|units|menge|anzahl|st[üu]ckzahl|quantit[ée]|quantit[àa]|cantidad|unidades|quantidade|aantal|परिमाण|संख्या/i, id: "quantity", type: "textField", priority: 0 },
    { regex: /payment\s*instructions|bank\s*(?:details|info|wire)|wire\s*instructions|zahlungsanweisungen/i, id: "payment_instructions", type: "textField", multiline: true, priority: 2 },
    { regex: /routing|iban|swift|bic|bsb|bankleitzahl|blz|code\s*banque|c[óo]digo\s*bancario|खाता\s*नं/i, id: "routing_number", type: "textField", priority: 1 },
    { regex: /account\s*(?:#|no|number|num)|kontonummer|konto-nr|n[°o]\s*de\s*compte|n[úu]mero\s*de\s*cuenta|numero\s*conto|n[úu]mero\s*da\s*conta|rekeningnummer/i, id: "account_number", type: "textField", priority: 1 },
    { regex: /नागरिकता\s*(?:नं|नंबर|प्रमाण)/, id: "citizenship_number", type: "textField", priority: 1 },
    { regex: /ssn|social\s*security|tax\s*id|ein|national\s*id|steuernummer|steuer-id|sozialversicherungsnummer|n[°o]\s*s[eé]curit[eé]\s*sociale|siret|siren|nif|cif|dni|nie|codice\s*fiscale|partita\s*iva|cpf|cnpj|rg|bsn|burgerkrachtnummer|प्यान\s*नं|राष्ट्रिय\s*परिचय/i, id: "ssn", type: "textField", priority: 1 },

    // ── Contact & Identity (EN, DE, FR, ES, IT, PT, NL, NE/HI) ──
    { regex: /first\s*name|given\s*name|forename|vorname|pr[eé]nom|primer\s*nombre|nome\s*proprio|primeiro\s*nome|voornaam|पहिलो\s*नाम/i, id: "first_name", type: "textField", autofill: "given-name", priority: 2 },
    { regex: /last\s*name|surname|family\s*name|nachname|familienname|nom\s*de\s*famille|apellidos?|primer\s*apellido|segundo\s*apellido|cognome|sobrenome|achternaam|थर/i, id: "last_name", type: "textField", autofill: "family-name", priority: 2 },
    { regex: /full\s*name|complete\s*name|vollst[äa]ndiger\s*name|nom\s*complet|nombre\s*completo|nome\s*completo|volledige\s*naam|नाम\s*,?\s*थर|पूरा\s*नाम|आवेदकको\s*नाम|निवेदकको\s*नाम|^name\b|^nom\b|^nombre\b|^naam\b|^नाम\b/i, id: "full_name", type: "textField", autofill: "name", priority: 1 },
    { regex: /e-?mail|courriel|correo\s*electr[óo]nico|e-post|इमेल|ईमेल/i, id: "email", type: "textField", autofill: "email", priority: 1 },
    { regex: /phone|telephone|mobile|cell|fax|tel\b|telefon|handy|mobil|t[eé]l[eé]phone|portable|tel[eé]fono|m[oó]vil|cellulare|telefone|celular|telefoon|टेलिफोन|फोन|मोबाइल|सम्पर्क\s*नं/i, id: "phone", type: "textField", autofill: "tel", priority: 1 },
    { regex: /street\s*address|address\s*line|home\s*address|stra[ßs]e(?:\s*und\s*hausnummer)?|adresse|rue|direcci[óo]n|calle|indirizzo|via|endere[çc]o|rua|straat\s*(?:en\s*huisnummer)?|ठेगाना|घर\s*ठेगाना|टोल/i, id: "street_address", type: "textField", autofill: "address-line1", priority: 2 },
    { regex: /city|ort\b|stadt|ville|ciudad|municipio|citt[àa]|cidade|plaats|stad|नगरपालिका|गाउँपालिका/i, id: "city", type: "textField", autofill: "address-level2", priority: 1 },
    { regex: /state|province|region|bundesland|kanton|r[eé]gion|provincia|estado|provincie|जिल्ला|प्रदेश/i, id: "state", type: "textField", autofill: "address-level1", priority: 1 },
    { regex: /zip|postal\s*code|postcode|plz|postleitzahl|code\s*postal|c[óo]digo\s*postal|cap\b|cep\b|वडा\s*नं|पिन\s*कोड/i, id: "zip_code", type: "textField", autofill: "postal-code", priority: 2 },
    { regex: /country|land\b|pays|pa[íi]s|nazione|paese|देश/i, id: "country", type: "textField", autofill: "country-name", priority: 1 },
    { regex: /company|organization|employer|institution|firma|unternehmen|arbeitgeber|entreprise|soci[eé]t[eé]|employeur|empresa|instituci[óo]n|organiza[çc][ãa]o|bedrijf|werkgever|कार्यालय|कम्पनी|संस्था/i, id: "organization", type: "textField", autofill: "organization", priority: 1 },
    { regex: /title|role|position|designation|profession|occupation|berufsbezeichnung|beruf|funktion|poste|titre|cargo|puesto|profesi[óo]n|ruolo|mansione|profiss[ãa]o|functie|beroep|पद|ओहोदा/i, id: "job_title", type: "textField", autofill: "organization-title", priority: 2 },
    { regex: /department|division|unit|abteilung|bereich|d[eé]partement|service|departamento|secci[óo]n|dipartimento|afdeling|शाखा|विभाग/i, id: "department", type: "textField", priority: 1 },
    
    // ── Table Line Items & Description ──
    { regex: /item\s*description|item\s*details|beschreibung|d[eé]signation|descripci[óo]n|descrizione|descri[çc][ãa]o|omschrijving|विवरण|^description\b/i, id: "item_description", type: "textField", priority: 2 },

    // ── Notes & Multiline Freeform ──
    { regex: /comments|notes|remarks|explanation|justification|feedback|details|bemerkungen|hinweise|anmerkungen|remarques|observations|commentaires|comentarios|observaciones|notas|note\b|commenti|observa[çc][õo]es|opmerkingen|notities|कैफियत|प्रतिक्रिया/i, id: "comments", type: "textField", multiline: true, priority: 0 },

    // ── South Asian Identity Details ──
    { regex: /परिचय\s*पत्र|राहदानी\s*नं/, id: "id_number", type: "textField", priority: 1 },
    { regex: /संख्या|नं\.?\s*$|नम्बर/, id: "number", type: "textField", priority: 0 }
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

    let bestMatch = null;
    let bestScore = -1;

    for (const item of GENERIC_PATTERNS) {
        const m = clean.match(item.regex);
        if (m) {
            const matchedTextLen = m[0].length;
            const priorityWeight = (item.priority !== undefined ? item.priority : 1) * 15;
            const score = matchedTextLen + priorityWeight;
            if (score > bestScore) {
                bestScore = score;
                bestMatch = item;
            }
        }
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
