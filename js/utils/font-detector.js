// ── Cross-Browser Automated System Font Detector & Custom Font Loader ──────────

export const SYSTEM_FONT_CATALOG = [
    // macOS Classic & Pro System Fonts
    "SF Pro", "SF Pro Display", "SF Pro Text", "SF Compact", "SF Mono", "New York",
    "Helvetica Neue", "Avenir", "Avenir Next", "Futura", "Gill Sans", "Optima",
    "Didot", "Baskerville", "Charter", "Cochin", "Copperplate", "American Typewriter",
    "Apple Chancery", "Big Caslon", "Chalkboard", "Chalkboard SE", "Chalkduster",
    "Geneva", "Herculanum", "Hoefler Text", "Iowan Old Style", "Marion", "Marker Felt",
    "Menlo", "Monaco", "Noteworthy", "Papyrus", "PT Sans", "PT Serif", "Savoye LET",
    "Seravek", "SignPainter", "Skia", "Snell Roundhand", "Superclarendon", "Trattatello", "Zapfino",

    // Windows & Microsoft 365 / Office Fonts
    "Aptos", "Aptos Display", "Calibri", "Calibri Light", "Cambria", "Cambria Math",
    "Candara", "Comic Sans MS", "Consolas", "Constantia", "Corbel", "Franklin Gothic Medium",
    "Gabriola", "Georgia", "Impact", "Lucida Console", "Lucida Sans Unicode",
    "Microsoft Sans Serif", "Palatino Linotype", "Segoe UI", "Segoe UI Variable",
    "Sitka", "Sylfaen", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana",

    // Linux & Modern System Standard
    "DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono", "Liberation Sans", "Liberation Serif",
    "Liberation Mono", "Ubuntu", "Ubuntu Mono", "Cantarell", "Noto Sans", "Noto Serif",

    // Designer & Coding Fonts Often Installed on Macs & Workstations
    "Fira Code", "JetBrains Mono", "Cascadia Code", "Source Code Pro", "Source Sans Pro",
    "Source Serif Pro", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins",
    "Raleway", "Oswald", "Playfair Display", "Merriweather", "Lora", "Inter", "Bebas Neue"
];

const TEST_STRING = "mmmmmmmmmmlliWWWWWW1234567890@#$";
const TEST_SIZE = "72px";

/**
 * Tests whether a specific font family is installed on the user's OS.
 * Uses canvas font metric comparison across three standard CSS generic fallbacks.
 * @param {string} fontName 
 * @param {CanvasRenderingContext2D} [ctx] 
 * @returns {boolean}
 */
export function isFontAvailable(fontName, ctx = null) {
    if (typeof document === "undefined") return false;

    let localCtx = ctx;
    if (!localCtx) {
        if (typeof document.createElement !== "function") return false;
        try {
            const canvas = document.createElement("canvas");
            localCtx = canvas.getContext("2d", { willReadFrequently: true });
        } catch (e) {
            return false;
        }
    }
    if (!localCtx) return false;

    try {
        // Measure fallback widths
        localCtx.font = `${TEST_SIZE} monospace`;
        const monoBase = localCtx.measureText(TEST_STRING).width;

        localCtx.font = `${TEST_SIZE} sans-serif`;
        const sansBase = localCtx.measureText(TEST_STRING).width;

        localCtx.font = `${TEST_SIZE} serif`;
        const serifBase = localCtx.measureText(TEST_STRING).width;

        // Measure font against fallbacks
        localCtx.font = `${TEST_SIZE} "${fontName}", monospace`;
        const monoTest = localCtx.measureText(TEST_STRING).width;

        localCtx.font = `${TEST_SIZE} "${fontName}", sans-serif`;
        const sansTest = localCtx.measureText(TEST_STRING).width;

        localCtx.font = `${TEST_SIZE} "${fontName}", serif`;
        const serifTest = localCtx.measureText(TEST_STRING).width;

        const diffMono = Math.abs(monoTest - monoBase);
        const diffSans = Math.abs(sansTest - sansBase);
        const diffSerif = Math.abs(serifTest - serifBase);

        // A genuine installed font will significantly deviate (> 1.5px) from at least two generic baselines
        const diffCount = (diffMono > 1.5 ? 1 : 0) + (diffSans > 1.5 ? 1 : 0) + (diffSerif > 1.5 ? 1 : 0);
        return diffCount >= 2;
    } catch (e) {
        return false;
    }
}

/**
 * Scans the user's system for available fonts from the catalog.
 * Safe to call on page load; completes in < 5ms.
 * @param {string[]} [customCatalog]
 * @returns {string[]} Detected font names
 */
export function detectInstalledFonts(customCatalog = SYSTEM_FONT_CATALOG) {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
        return [];
    }

    let ctx = null;
    try {
        const canvas = document.createElement("canvas");
        ctx = canvas.getContext("2d", { willReadFrequently: true });
    } catch (e) {
        return [];
    }
    if (!ctx) return [];

    const detected = [];
    for (const font of customCatalog) {
        if (isFontAvailable(font, ctx)) {
            detected.push(font);
        }
    }
    return detected;
}

/**
 * Populates detected fonts into the given <select> dropdown under an optgroup.
 * @param {HTMLSelectElement} selectEl 
 * @param {string[]} detectedFonts 
 */
export function populateDetectedFontsInSelect(selectEl, detectedFonts) {
    if (!selectEl || !Array.isArray(detectedFonts) || detectedFonts.length === 0) return;

    let detectedGroup = document.getElementById("detectedSystemFontsGroup");
    if (!detectedGroup) {
        detectedGroup = document.createElement("optgroup");
        detectedGroup.id = "detectedSystemFontsGroup";
        detectedGroup.label = `Detected on Your Device (${detectedFonts.length})`;
        
        // Insert right after standard core fonts or at top
        const standardGroup = selectEl.querySelector('optgroup[label^="Standard"]');
        if (standardGroup && standardGroup.nextSibling) {
            selectEl.insertBefore(detectedGroup, standardGroup.nextSibling);
        } else {
            selectEl.appendChild(detectedGroup);
        }
    } else {
        detectedGroup.innerHTML = "";
        detectedGroup.label = `Detected on Your Device (${detectedFonts.length})`;
    }

    // Existing options to avoid duplicates
    const existingValues = new Set(Array.from(selectEl.options).map(o => o.value.toLowerCase()));

    detectedFonts.forEach(fontName => {
        const val = `device:${fontName}`;
        if (!existingValues.has(val.toLowerCase()) && !existingValues.has(fontName.toLowerCase())) {
            const opt = document.createElement("option");
            opt.value = val;
            opt.textContent = fontName;
            detectedGroup.appendChild(opt);
        }
    });
}

/**
 * Registers an uploaded custom font file (.ttf / .otf / .woff) in the browser,
 * caches raw binary for PDF export, and adds it to the font dropdown.
 * @param {File} file 
 * @param {HTMLSelectElement} [selectEl] 
 * @returns {Promise<string>} The registered font family name
 */
export async function loadCustomFontFile(file, selectEl) {
    if (!file) throw new Error("No file provided");

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    let familyName = file.name.replace(/\.[^/.]+$/, "").trim();

    // 1. Try reading metadata using fontkit if available
    if (typeof window !== "undefined" && window.fontkit && typeof window.fontkit.create === "function") {
        try {
            const fontObj = window.fontkit.create(bytes);
            if (fontObj && fontObj.familyName) {
                familyName = fontObj.familyName.trim();
            }
        } catch (e) {
            console.warn("Could not read font metadata via fontkit, using filename fallback:", e);
        }
    }

    // Clean familyName to alphanumeric + space
    familyName = familyName.replace(/[^\w\s-]/g, "").trim() || "CustomFont";

    // 2. Register with CSS Font Loading API in the DOM
    if (typeof FontFace !== "undefined" && typeof document !== "undefined" && document.fonts) {
        try {
            const fontFace = new FontFace(familyName, arrayBuffer);
            await fontFace.load();
            document.fonts.add(fontFace);
        } catch (e) {
            console.warn("Could not add FontFace to document.fonts:", e);
        }
    }

    // 3. Cache raw bytes for PDF-Lib / fontkit embedding
    // Always write to globalThis so it's reachable from both browser (window === globalThis)
    // and Node test environments where global.window may be a separate mock object.
    const targetGlobal = (typeof window !== "undefined") ? window : (typeof globalThis !== "undefined" ? globalThis : null);
    if (targetGlobal) {
        if (!targetGlobal._localFontBytesCache) targetGlobal._localFontBytesCache = new Map();
        targetGlobal._localFontBytesCache.set(familyName, bytes);
        if (!targetGlobal._localFontDataMap) targetGlobal._localFontDataMap = new Map();
        targetGlobal._localFontDataMap.set(familyName, { family: familyName, custom: true });
    }
    // Mirror to globalThis for test environments where window is a plain mock (Node.js)
    if (typeof globalThis !== "undefined" && targetGlobal !== globalThis) {
        if (!globalThis._localFontBytesCache) globalThis._localFontBytesCache = new Map();
        globalThis._localFontBytesCache.set(familyName, bytes);
        if (!globalThis._localFontDataMap) globalThis._localFontDataMap = new Map();
        globalThis._localFontDataMap.set(familyName, { family: familyName, custom: true });
    }

    // 4. Add to dropdown
    if (selectEl) {
        let customGroup = document.getElementById("customUploadedFontsGroup");
        if (!customGroup) {
            customGroup = document.createElement("optgroup");
            customGroup.id = "customUploadedFontsGroup";
            customGroup.label = "Custom Added Fonts";
            selectEl.prepend(customGroup);
        }

        const optionVal = `custom:${familyName}`;
        let existingOpt = Array.from(customGroup.querySelectorAll("option")).find(o => o.value === optionVal);
        if (!existingOpt) {
            const opt = document.createElement("option");
            opt.value = optionVal;
            opt.textContent = `★ ${familyName} (Uploaded)`;
            customGroup.appendChild(opt);
        }
        selectEl.value = optionVal;
    }

    return familyName;
}
