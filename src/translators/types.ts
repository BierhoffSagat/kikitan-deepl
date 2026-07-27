export type TranslationEngine = "deepl" | "google";

export type TranslationError = {
    engine: TranslationEngine;
    code: string;
    message: string;
    status?: number;
};
