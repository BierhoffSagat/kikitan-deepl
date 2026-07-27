import { invoke } from "@tauri-apps/api/core";

export type DeepLApiPlan = "free" | "pro";

type DeepLTranslation = {
    text: string;
    detected_source_language?: string;
};

export type DeepLError = {
    code: string;
    message: string;
    status?: number;
};

const sourceLanguageMap: Record<string, string> = {
    ar: "AR", bg: "BG", cs: "CS", da: "DA", de: "DE", el: "EL",
    en: "EN", es: "ES", et: "ET", fi: "FI", fr: "FR", he: "HE", hu: "HU",
    id: "ID", it: "IT", ja: "JA", ko: "KO", lt: "LT", lv: "LV",
    nb: "NB", nl: "NL", no: "NB", pl: "PL", pt: "PT", ro: "RO",
    ru: "RU", sk: "SK", sl: "SL", sv: "SV", th: "TH", tr: "TR",
    uk: "UK", vi: "VI", zh: "ZH",
};

const targetLanguageMap: Record<string, string> = {
    ar: "AR", bg: "BG", cs: "CS", da: "DA", de: "DE", el: "EL",
    en: "EN-US", "en-us": "EN-US", "en-uk": "EN-GB", "en-gb": "EN-GB",
    es: "ES", et: "ET", fi: "FI", fr: "FR", hu: "HU", id: "ID",
    he: "HE", it: "IT", ja: "JA", ko: "KO", lt: "LT", lv: "LV", nb: "NB",
    nl: "NL", no: "NB", pl: "PL", pt: "PT-PT", "pt-br": "PT-BR",
    "pt-pt": "PT-PT", ro: "RO", ru: "RU", sk: "SK", sl: "SL",
    sv: "SV", th: "TH", tr: "TR", uk: "UK", vi: "VI", zh: "ZH-HANS",
};

const duplicateWindowMs = 2_000;
let recentRequest: {
    key: string;
    startedAt: number;
    promise: Promise<string>;
} | null = null;

function baseLanguage(language: string): string {
    return language.trim().toLowerCase().split("-")[0];
}

export function toDeepLSourceLanguage(language: string): string {
    const code = sourceLanguageMap[baseLanguage(language)];
    if (!code) throw <DeepLError>{
        code: "unsupported_source_language",
        message: `DeepL does not support the selected source language (${language}).`,
    };
    return code;
}

export function toDeepLTargetLanguage(language: string): string {
    const normalized = language.trim().toLowerCase();
    const code = targetLanguageMap[normalized] ?? targetLanguageMap[baseLanguage(language)];
    if (!code) throw <DeepLError>{
        code: "unsupported_target_language",
        message: `DeepL does not support the selected target language (${language}).`,
    };
    return code;
}

export default async function translateDeepL(
    text: string,
    source: string,
    target: string,
    apiPlan: DeepLApiPlan,
): Promise<string> {
    if (text.trim().length === 0) return "";

    const sourceLang = toDeepLSourceLanguage(source);
    const targetLang = toDeepLTargetLanguage(target);
    const requestKey = `${apiPlan}\u0000${sourceLang}\u0000${targetLang}\u0000${text}`;
    const now = Date.now();

    if (
        recentRequest !== null &&
        recentRequest.key === requestKey &&
        now - recentRequest.startedAt < duplicateWindowMs
    ) {
        return recentRequest.promise;
    }

    const promise = invoke<DeepLTranslation>("translate_deepl", {
        text,
        sourceLang,
        targetLang,
        apiPlan,
    }).then((result) => result.text);

    recentRequest = {
        key: requestKey,
        startedAt: now,
        promise,
    };

    setTimeout(() => {
        if (recentRequest?.promise === promise) recentRequest = null;
    }, duplicateWindowMs);

    return promise;
}
