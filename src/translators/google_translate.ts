export type GoogleTranslateError = {
    code: string;
    message: string;
    status?: number;
};

type GoogleTranslateResponse = {
    sentences?: Array<{
        trans?: string;
    }>;
};

export default async function translateGoogle(
    text: string,
    source: string,
    target: string,
): Promise<string> {
    if (text.trim().length === 0) return "";

    const parameters = new URLSearchParams({
        client: "gtx",
        sl: source,
        tl: target,
        dt: "t",
        dj: "1",
        q: text,
    });
    const response = await fetch(
        `https://translate.googleapis.com/translate_a/single?${parameters.toString()}`,
    );

    if (!response.ok) {
        throw <GoogleTranslateError>{
            code: "google_http_error",
            message: `Google Translate returned HTTP ${response.status}.`,
            status: response.status,
        };
    }

    const data = await response.json() as GoogleTranslateResponse;
    const translation = data.sentences
        ?.map((sentence) => sentence.trans ?? "")
        .join("")
        .trim();

    if (!translation) {
        throw <GoogleTranslateError>{
            code: "google_invalid_response",
            message: "Google Translate returned an invalid or empty response.",
        };
    }

    return translation;
}
