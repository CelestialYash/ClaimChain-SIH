import type { Claim, VerificationRun } from '../types.js';

/**
 * Stage 7 — plain-language decision reasoning (CLAIMCHAIN_WORKFLOW.md §2.4
 * option A): deterministic template generation from the stage logs. No LLM,
 * no network, same log in → same explanation out. The frontend can render
 * this string directly; a local/cloud LLM can later replace only this file.
 *
 * Bilingual: English (default) + Hindi (हिन्दी) via ?lang=hi. Marathi was
 * explicitly de-scoped by product decision. Hindi is rendered in Devanagari
 * with ASCII numerals — the loss-type names are transliterated loanwords
 * (बाढ़/सूखा/पशुधन) so farmers read them naturally.
 */

export type ExplanationLang = 'en' | 'hi';

const STAGE_LABELS: Record<ExplanationLang, Record<string, string>> = {
  en: {
    EXIF_INTEGRITY: 'Photo metadata',
    DUPLICATE_PHASH: 'Duplicate-image check',
    OCR_EXTRACT: 'Document reading',
    POLICY_MATCH: 'Policy cross-check',
    DOC_CROSS: 'Aadhaar–registry–policy cross-verification',
    DAMAGE_ASSESS: 'Damage assessment',
    FRAUD_RULES: 'Fraud rules',
  },
  hi: {
    EXIF_INTEGRITY: 'फ़ोटो मेटाडेटा',
    DUPLICATE_PHASH: 'डुप्लिकेट-तस्वीर जाँच',
    OCR_EXTRACT: 'दस्तावेज़ पढ़ाई',
    POLICY_MATCH: 'पॉलिसी क्रॉस-जाँच',
    DOC_CROSS: 'आधार–रजिस्ट्री–पॉलिसी क्रॉस-जाँच',
    DAMAGE_ASSESS: 'क्षति आकलन',
    FRAUD_RULES: 'फ़्रॉड नियम',
  },
};

const LOSS_LABEL: Record<Claim['lossType'], Record<ExplanationLang, string>> = {
  flood: { en: 'flood', hi: 'बाढ़' },
  drought: { en: 'drought', hi: 'सूखा' },
  livestock: { en: 'livestock', hi: 'पशुधन' },
};

/** Round ₹ amounts in the Indian lakh/thousand style for readability. */
function inr(amount: number, lang: ExplanationLang): string {
  const num = amount.toLocaleString('en-IN');
  return lang === 'hi' ? `₹${num}` : `₹${num}`;
}

const OPENERS: Record<ExplanationLang, Record<VerificationRun['verdict'], (name: string, loss: string, amt: string, problems: number) => string>> = {
  en: {
    AI_APPROVED: (name, loss, amt) =>
      `Verified automatically: all checks passed on ${name}'s ${loss} claim of ${amt}. The evidence is consistent and no fraud signal was found.`,
    AI_FLAGGED: (name, loss, amt, problems) =>
      `Held for human review: ${
        problems > 0 ? `${problems} warning sign${problems === 1 ? '' : 's'} were found` : 'the verification score fell in the grey zone'
      } on ${name}'s ${loss} claim of ${amt}.`,
    AI_REJECTED: (name, loss, amt) =>
      `Not approved automatically: the evidence submitted for ${name}'s ${loss} claim does not demonstrate the claimed loss.`,
  },
  hi: {
    AI_APPROVED: (name, loss, amt) =>
      `स्वचालित रूप से सत्यापित: ${name} के ${loss} के दावे (${amt}) की सभी जाँचें सफल रहीं। सबूत संगत हैं और कोई फ़्रॉड संकेत नहीं मिला।`,
    AI_FLAGGED: (name, loss, amt, problems) =>
      `मानव समीक्षा के लिए रोका गया: ${name} के ${loss} के दावे (${amt}) में ${
        problems > 0 ? `${problems} चेतावनी संकेत मिले` : 'सत्यापन स्कोर संदिग्ध क्षेत्र में रहा'
      }।`,
    AI_REJECTED: (name, loss, amt) =>
      `स्वचालित रूप से स्वीकृत नहीं: ${name} के ${loss} के दावे के सबूत बताई गई हानि को पुष्ट नहीं करते।`,
  },
};

const NEXT_STEPS: Record<ExplanationLang, Record<VerificationRun['verdict'], (amt: string) => string>> = {
  en: {
    AI_APPROVED: (amt) =>
      `Next step: this claim is payout-unlocked. Paying ${amt} via UPI will be sealed on-chain as the final record.`,
    AI_FLAGGED: () =>
      'Next step: this claim is locked — flagged claims cannot be paid until a claims officer reviews the evidence and approves or rejects it. That decision will be sealed on-chain.',
    AI_REJECTED: () =>
      'Next step: the claimant may request a human appeal. A rejected claim can only be overturned by a reviewed human decision, sealed on-chain.',
  },
  hi: {
    AI_APPROVED: (amt) =>
      `अगला कदम: यह दावा भुगतान के लिए खुला है। ${amt} का UPI भुगतान अंतिम रिकॉर्ड के रूप में चेन पर सील किया जाएगा।`,
    AI_FLAGGED: () =>
      'अगला कदम: यह दावा लॉक है — जब तक कोई अधिकारी सबूत देखकर स्वीकृत या अस्वीकृत नहीं करता, तब तक चिह्नित दावे का भुगतान नहीं हो सकता। वह निर्णय चेन पर सील किया जाएगा।',
    AI_REJECTED: () =>
      'अगला कदम: दावेदार मानव अपील मांग सकता है। अस्वीकृत दावा केवल समीक्षित मानव निर्णय से बदला जा सकता है, जो चेन पर सील होगा।',
  },
};

/**
 * Build a human-readable explanation for a verification run.
 * Deterministic: the sealed verification digest already commits the stage
 * logs, so the explanation is reproducible from the chain forever.
 * `lang='hi'` renders the same reasoning in Hindi.
 */
export function buildExplanation(run: VerificationRun, claim: Claim, lang: ExplanationLang = 'en'): string {
  const problems = run.stages.filter(
    (s) => s.stage !== 'DECISION' && (s.result === 'FAIL' || s.result === 'WARN')
  );
  const loss = LOSS_LABEL[claim.lossType][lang];
  const amt = inr(claim.amountRequested, lang);
  const labels = STAGE_LABELS[lang];

  const lines: string[] = [OPENERS[lang][run.verdict](claim.claimantName, loss, amt, problems.length)];

  // Evidence-grounded document intelligence reasoning
  if (run.docSummary) {
    const d = run.docSummary;
    const docFacts: string[] = [];

    // Registry: cite actual deed type, district, khasra, area
    if (d.registry.found) {
      const regParts: string[] = [];
      if (d.registry.deedType) regParts.push(d.registry.deedType);
      if (d.registry.district) regParts.push(lang === 'hi' ? `जिला ${d.registry.district}` : `district ${d.registry.district}`);
      if (d.registry.village) regParts.push(lang === 'hi' ? `गाँव ${d.registry.village}` : `village ${d.registry.village}`);
      if (d.registry.khasraNo) regParts.push(lang === 'hi' ? `खसरा नं० ${d.registry.khasraNo}` : `Khasra/Plot #${d.registry.khasraNo}`);
      if (d.registry.areaHectares) regParts.push(lang === 'hi' ? `रकबा ${d.registry.areaHectares}` : `area ${d.registry.areaHectares}`);
      if (d.registry.state) regParts.push(d.registry.state);
      if (regParts.length > 0) {
        docFacts.push(lang === 'hi' ? `रजिस्ट्री: ${regParts.join(', ')}` : `Registry: ${regParts.join(', ')}`);
      } else {
        docFacts.push(lang === 'hi' ? `रजिस्ट्री पठित (${d.registry.language ?? 'mixed'})` : `Registry read (${d.registry.language ?? 'mixed'})`);
      }
    }

    // Aadhaar: cite actual cardholder name and masked number
    if (d.aadhaar.found && (d.aadhaar.name || d.aadhaar.nameDevanagari)) {
      const aName = d.aadhaar.name ?? d.aadhaar.nameDevanagari ?? '';
      const maskedPart = d.aadhaar.aadhaarMasked ? ` (${d.aadhaar.aadhaarMasked})` : '';
      docFacts.push(lang === 'hi' ? `आधार: ${aName}${maskedPart}` : `Aadhaar: ${aName}${maskedPart}`);
    }

    // Identity cross-check: cite actual names, transliteration, and score
    if (d.identityCross.matched) {
      const crossParts = [
        lang === 'hi' ? `पहचान सत्यापित ${d.identityCross.score}%` : `Identity verified at ${d.identityCross.score}%`,
      ];
      if (d.identityCross.aadhaarNameClean && d.identityCross.registryNameClean) {
        crossParts.push(lang === 'hi'
          ? `"${d.identityCross.aadhaarNameClean}" ↔ "${d.identityCross.registryNameClean}"`
          : `Aadhaar "${d.identityCross.aadhaarNameClean}" matched registry "${d.identityCross.registryNameClean}"`);
      }
      if (d.identityCross.transliterated) {
        crossParts.push(lang === 'hi' ? `(लिप्यंतरण: ${d.identityCross.transliterated})` : `(transliterated: ${d.identityCross.transliterated})`);
      }
      docFacts.push(crossParts.join(' · '));
    } else if (d.identityCross.inconclusive) {
      docFacts.push(lang === 'hi' ? 'पहचान अनिर्णीत — दस्तावेज़ अपठनीय' : 'Identity check inconclusive — document unreadable');
    } else if (!d.identityCross.matched && d.identityCross.score > 0) {
      docFacts.push(lang === 'hi'
        ? `पहचान मेल नहीं खाता (${d.identityCross.score}%)`
        : `Identity mismatch (best score ${d.identityCross.score}%)`);
    }

    // Policy: cite actual policy number and sum insured
    if (d.policy.found && d.policy.policyNumber) {
      const polParts = [`Policy ${d.policy.policyNumber}`];
      if (d.policy.sumInsured) polParts.push(lang === 'hi' ? `बीमा राशि ₹${d.policy.sumInsured.toLocaleString('en-IN')}` : `sum insured ₹${d.policy.sumInsured.toLocaleString('en-IN')}`);
      if (d.policy.insuredName) polParts.push(lang === 'hi' ? `बीमाधारक ${d.policy.insuredName}` : `insured: ${d.policy.insuredName}`);
      if (d.policy.coverage && d.policy.coverage.length > 0) polParts.push(`covers: ${d.policy.coverage.join(', ')}`);
      docFacts.push(polParts.join(' · '));
    }

    // Satellite destruction assessment
    if (d.satellite.found && d.satellite.destructionPct != null) {
      const satText = lang === 'hi'
        ? `उपग्रह: ${d.satellite.destructionPct}% विनाश (स्तर: ${d.satellite.rung ?? '?'})`
        : `Satellite: ${d.satellite.destructionPct}% destruction (rung: ${d.satellite.rung ?? '?'})`;
      docFacts.push(satText);
      if (d.pctDelta != null && d.claimedPct != null) {
        docFacts.push(lang === 'hi'
          ? `दावा किया ${d.claimedPct}% बनाम मापा ${d.satellite.destructionPct}% (Δ ${d.pctDelta} pts)`
          : `Claimed ${d.claimedPct}% vs measured ${d.satellite.destructionPct}% (Δ ${d.pctDelta} pts)`);
      }
    }

    if (docFacts.length > 0) {
      lines.push(lang === 'hi' ? '• दस्तावेज़ प्रमाण:' : '• Document evidence:');
      for (const fact of docFacts) {
        lines.push(`  → ${fact}`);
      }
    }
  }

  if (problems.length > 0) {
    lines.push(lang === 'hi' ? 'AI को क्या मिला:' : 'What the AI found:');
    for (const p of problems.slice(0, 4)) {
      lines.push(`• ${labels[p.stage] ?? p.stage}: ${p.details}`);
    }
  }

  lines.push(NEXT_STEPS[lang][run.verdict](amt));
  return lines.join('\n');
}

/** Back-compat default (English) — used by persist.ts and callers without a lang. */
export function explainRun(run: VerificationRun, claim: Claim): string {
  return buildExplanation(run, claim, 'en');
}
