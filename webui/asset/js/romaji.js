// Lightweight kana-to-romaji conversion for search matching
// Covers hiragana, katakana, and common digraphs

var ROMAJI_MAP = {
  'あ':'a','い':'i','う':'u','え':'e','お':'o',
  'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
  'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
  'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
  'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
  'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
  'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
  'や':'ya','ゆ':'yu','よ':'yo',
  'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
  'わ':'wa','ゐ':'wi','ゑ':'we','を':'wo','ん':'n',
  'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
  'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
  'だ':'da','ぢ':'di','づ':'du','で':'de','ど':'do',
  'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
  'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
  // Digraphs
  'きゃ':'kya','きゅ':'kyu','きょ':'kyo',
  'しゃ':'sha','しゅ':'shu','しょ':'sho',
  'ちゃ':'cha','ちゅ':'chu','ちょ':'cho',
  'にゃ':'nya','にゅ':'nyu','にょ':'nyo',
  'ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo',
  'みゃ':'mya','みゅ':'myu','みょ':'myo',
  'りゃ':'rya','りゅ':'ryu','りょ':'ryo',
  'ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo',
  'じゃ':'ja','じゅ':'ju','じょ':'jo',
  'びゃ':'bya','びゅ':'byu','びょ':'byo',
  'ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
  // Small kana
  'ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o',
  'っ':'', // handled specially as double consonant
  'ゃ':'ya','ゅ':'yu','ょ':'yo',
};

// Katakana offset: katakana codepoints are hiragana + 0x60
function katakanaToHiragana(str) {
  return str.replace(/[\u30A1-\u30F6]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0x60);
  }).replace(/\u30FC/g, '-'); // long vowel mark
}

function toRomaji(str) {
  if (!str) return '';
  var s = katakanaToHiragana(str.toLowerCase());
  var result = '';
  var i = 0;
  while (i < s.length) {
    // Check for っ (double consonant)
    if (s[i] === 'っ' && i + 1 < s.length) {
      var nextChar = ROMAJI_MAP[s[i + 1]];
      if (nextChar && nextChar.length > 0) {
        result += nextChar[0]; // double the first consonant
      }
      i++;
      continue;
    }
    // Try 2-char digraph first
    if (i + 1 < s.length && ROMAJI_MAP[s[i] + s[i + 1]]) {
      result += ROMAJI_MAP[s[i] + s[i + 1]];
      i += 2;
      continue;
    }
    // Single char
    if (ROMAJI_MAP[s[i]]) {
      result += ROMAJI_MAP[s[i]];
      i++;
      continue;
    }
    // Pass through non-kana characters as-is
    result += s[i];
    i++;
  }
  return result;
}

function matchesSearch(text, query) {
  if (!text || !query) return false;
  var lowerText = text.toLowerCase();
  var lowerQuery = query.toLowerCase();
  if (lowerText.indexOf(lowerQuery) !== -1) return true;
  var romanized = toRomaji(text);
  return romanized.indexOf(lowerQuery) !== -1;
}
