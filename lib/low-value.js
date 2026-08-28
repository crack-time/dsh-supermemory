/**
 * Low-value turn detection: skip persisting bare acknowledgments, single-
 * character choices, and continuation commands ("ok", "do it", etc.).
 *
 * The phrase table is kept explicit and readable (not a giant regex) so the
 * strict-mode list is easy to extend in either language.  Phrases are matched
 * EXACTLY (whitespace-normalized, case-folded) — a phrase inside a longer
 * sentence is never a match.
 */
const LOW_VALUE_PHRASES = [
    // English short confirms / acks / continuations
    'confirm', 'confirmed', 'ok', 'okay', 'k',
    'yes', 'yeah', 'yep', 'yup', 'sure', 'done', 'good', 'fine', 'great', 'nice',
    'cool', 'awesome', 'right', 'got it', 'roger', 'understood', 'copy',
    'affirmative', 'accepted', 'go', 'go ahead', 'go on', 'go for it',
    'start', 'begin', 'proceed', 'continue', 'keep going', 'next',
    'execute', 'run', 'run it', 'run this', 'do it', 'do that', 'do it now',
    'make it happen', "i'm on it", 'on it', 'doing it', 'will do',
    'sounds good', 'looks good', 'makes sense', "that's fine",
    'yes please', 'please', 'thanks', 'thank you', 'thx', 'ty',
    // Chinese short confirms / acks / continuations
    '确认', '可以', '好的', '好', '是', '对', '行', '嗯', '恩', '哦', '啊',
    '哦哦', '嗯嗯', '对对', '是是', '收到', '明白', '知道了',
    '同意', '认可', '我认可', '开始', '开始吧', '执行', '你执行', '你逐个执行',
    '逐个执行', '继续', '你继续', '继续吧', '去吧', '来吧', '干吧', '跑',
    '跑一次', '你现在就跑一次', '重启了', '我重启了', '重启', '算了', '算了算了',
    '没关系', '可以吧', '行吧', '好的吧', '没问题', '请继续', '就这么办',
    '好的好的', '收到收到', '谢谢', '多谢',
];
const LOW_VALUE_PHRASE_SET = new Set(LOW_VALUE_PHRASES);
/** Extract the plain real-user message texts from a composed transcript. */
function extractUserMessages(transcript) {
    const re = /(?:^|\n\n)User:\n([\s\S]*?)(?=\n\nAssistant:|\n\n\[tool\]|\n\nUser:|$)/g;
    const out = [];
    let m;
    while ((m = re.exec(transcript)) !== null) {
        const text = (m[1] ?? '').trim();
        if (text)
            out.push(text);
    }
    return out;
}
/** True when a user message carries no substance (pure choice/ack/command). */
function isLowValueUserMessage(userText) {
    const s = userText.replace(/\s+/g, ' ').trim();
    if (!s)
        return true;
    const alnum = s.replace(/[^\p{L}\p{N}]/gu, '');
    if (alnum.length === 0)
        return true;
    if (alnum.length === 1)
        return true;
    return LOW_VALUE_PHRASE_SET.has(s.toLowerCase());
}
/** Strict: skip persisting when EVERY real user message in the turn is low-value. */
export function isTurnLowValue(transcript) {
    const users = extractUserMessages(transcript);
    if (users.length === 0)
        return true;
    return users.every((u) => isLowValueUserMessage(u));
}
